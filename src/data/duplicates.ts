/**
 * Finding the records that are the same thing entered twice.
 *
 * The matching itself is in `lib/duplicates.ts`, where a test can pin it down.
 * This reads the collections and counts what points at what.
 *
 * COUNTED IN MEMORY, NOT BY QUERY
 *   `assessTarget` counts references with one aggregation query per reference
 *   per record. That is right for one delete and wrong for a scan: a hundred
 *   clients would fire several hundred queries to draw a list. Every collection
 *   that can point at something is read ONCE here instead, and the counting is
 *   arithmetic.
 *
 *   The delete itself still goes through `deleteTarget`, so a duplicate that
 *   something actually depends on is refused with the reasons named — the scan
 *   suggests, the existing policy decides.
 */

import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase.js';
import { findDuplicates, type DuplicateCandidate, type DuplicateGroup } from '../lib/duplicates.js';

/** The kinds worth scanning. Each is something people both import and type in. */
export type DuplicateKind = 'client' | 'contract' | 'project' | 'unit';

export interface DuplicateScan {
  kind: DuplicateKind;
  /** Plural, as a person would say it. */
  label: string;
  /** How many records of this kind were looked at. */
  examined: number;
  groups: DuplicateGroup[];
}

const millisOf = (value: unknown): number => {
  const at = (value as { toMillis?: () => number } | undefined)?.toMillis;
  return typeof at === 'function' ? (value as { toMillis: () => number }).toMillis() : 0;
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Count how many times each id appears under a field. */
function tally(rows: readonly Record<string, unknown>[], field: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = row[field];
    if (typeof id !== 'string' || id === '') continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

const add = (...maps: Map<string, number>[]) => (id: string) =>
  maps.reduce((sum, map) => sum + (map.get(id) ?? 0), 0);

/**
 * Scan for duplicates across the four kinds people enter twice.
 *
 * Six collection reads, whatever the size of the book.
 */
export async function scanForDuplicates(): Promise<DuplicateScan[]> {
  const [clients, contracts, projects, units, invoices, disbursements] = await Promise.all([
    getDocs(collection(db, 'clients')),
    getDocs(collection(db, 'contracts')),
    getDocs(collection(db, 'projects')),
    getDocs(collection(db, 'units')),
    getDocs(collection(db, 'invoices')),
    getDocs(collection(db, 'disbursements')),
  ]);

  type Row = Record<string, unknown> & { id: string };
  const rowsOf = (snap: typeof clients): Row[] =>
    snap.docs.map((d) => ({ ...(d.data() as Record<string, unknown>), id: d.id }));

  const clientRows = rowsOf(clients);
  const contractRows = rowsOf(contracts);
  const projectRows = rowsOf(projects);
  const unitRows = rowsOf(units);
  const invoiceRows = rowsOf(invoices);
  const disbursementRows = rowsOf(disbursements);

  const clientRefs = add(
    tally(contractRows, 'clientId'),
    tally(projectRows, 'clientId'),
    tally(invoiceRows, 'clientId'),
  );
  const contractRefs = add(
    tally(projectRows, 'contractId'),
    tally(invoiceRows, 'contractId'),
    tally(unitRows, 'maintenanceContractId'),
  );
  const projectRefs = add(
    tally(unitRows, 'installedByProjectId'),
    tally(invoiceRows, 'projectId'),
    tally(disbursementRows, 'projectId'),
  );

  const candidate = (
    row: Row,
    code: string | null,
    name: string,
    references: number,
  ): DuplicateCandidate => ({
    id: row.id,
    code,
    name,
    createdAtMillis: millisOf(row['createdAt']),
    references,
  });

  return [
    {
      kind: 'client',
      label: 'Clients',
      examined: clients.size,
      // A client has no code that is meant to be unique — a TIN is, but plenty
      // are blank, and an empty code matches nothing by design.
      groups: findDuplicates(
        clientRows.map((row) =>
          candidate(row, text(row['tin']) || null, text(row['name']), clientRefs(row.id)),
        ),
      ),
    },
    {
      kind: 'contract',
      label: 'Contracts',
      examined: contracts.size,
      groups: findDuplicates(
        contractRows.map((row) =>
          candidate(row, text(row['contractNo']), text(row['title']), contractRefs(row.id)),
        ),
      ),
    },
    {
      kind: 'project',
      label: 'Projects',
      examined: projects.size,
      groups: findDuplicates(
        projectRows.map((row) =>
          candidate(row, text(row['projectNo']), text(row['title']), projectRefs(row.id)),
        ),
      ),
    },
    {
      kind: 'unit',
      label: 'Lifts',
      examined: units.size,
      groups: findDuplicates(
        unitRows.map((row) =>
          // A lift's identity is its code; two lifts on one site share a tag
          // legitimately, so the tag is never the thing matched on.
          candidate(row, text(row['unitCode']), text(row['unitCode']), 0),
        ),
      ),
    },
  ];
}
