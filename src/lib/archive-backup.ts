/**
 * The backup taken before a job is removed.
 *
 * TWO FILES, BECAUSE THEY ARE FOR TWO READERS
 *   The JSON file is the complete record: every field of every document, exactly
 *   as it was stored, so that nothing about the job is lost and a restore tool
 *   could rebuild it. Nobody is expected to read it.
 *   The Excel workbook is for people — an accountant, an auditor, the person
 *   who needs to know in two years what the last payment on that job was. It
 *   carries the figures in birr, dates in both calendars, one sheet per kind of
 *   record.
 *
 * THE FINGERPRINT
 *   The JSON content is hashed. The hash is shown, written to the archive
 *   record and kept inside the file. Just before anything is deleted the job is
 *   read again and hashed again: if the two differ, somebody changed the job
 *   after the backup was taken and the backup no longer describes what is about
 *   to be removed. That is the one check that makes "backed up" mean something.
 *
 *   The hash covers the job only — not the time of export or who exported it,
 *   which differ every time and would make every comparison fail.
 */

import { formatDual } from './ethiopic.js';
import type { ArchiveJob, ArchiveVerdict } from './archive.js';

export const BACKUP_FORMAT = 'intelmotion-job-archive';
export const BACKUP_VERSION = 1;

// ---------------------------------------------------------------------------
// Making Firestore data plain
// ---------------------------------------------------------------------------

function isTimestampLike(value: unknown): value is { toMillis(): number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function' &&
    typeof (value as { seconds?: unknown }).seconds === 'number'
  );
}

/**
 * Turn anything Firestore returns into plain JSON, deterministically.
 *
 * Timestamps become `{ "__timestamp": "<ISO>" }` so they survive the round trip
 * as what they are rather than as an anonymous pair of numbers. Keys are sorted
 * so the same data always produces the same text — the hash depends on it.
 */
export function toPlain(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (isTimestampLike(value)) return { __timestamp: new Date(value.toMillis()).toISOString() };
  if (value instanceof Date) return { __timestamp: value.toISOString() };
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const inner = (value as Record<string, unknown>)[key];
      if (inner !== undefined) out[key] = toPlain(inner);
    }
    return out;
  }
  return value;
}

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

/** The job as plain, ordered data. This — and only this — is what is hashed. */
export function backupContent(job: ArchiveJob): Record<string, unknown> {
  const docs = <T extends { id: string }>(list: readonly T[]) =>
    [...list].sort(byId).map((entry) => toPlain(entry));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    contract: toPlain(job.contract),
    paymentTerms: docs(job.terms),
    projects: docs(job.projects),
    stages: docs(job.stages),
    invoices: docs(job.invoices),
    receipts: docs(job.receipts),
    collectionNotes: docs(job.chaseSteps),
    paymentVouchers: docs(job.vouchers),
    crewAssignments: docs(job.assignments),
    tasks: docs(job.tasks),
    liftsLinked: docs(job.units),
    maintenanceAgreement: toPlain(job.successor),
  };
}

export function contentText(job: ArchiveJob): string {
  return JSON.stringify(backupContent(job));
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface BackupMeta {
  exportedAt: string;
  exportedBy: string;
  contentSha256: string;
}

/** The text of the JSON file: who and when, the fingerprint, then the job. */
export function backupFileText(job: ArchiveJob, meta: BackupMeta): string {
  return JSON.stringify({ meta, ...backupContent(job) }, null, 1);
}

/** A file name a person can recognise in a folder of fifty. */
export function backupFileStem(job: ArchiveJob): string {
  const safe = (text: string) => text.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `IntelMotion-archive-${safe(job.contract.data.contractNo)}-${safe(job.contract.data.clientName)}`;
}

// ---------------------------------------------------------------------------
// The workbook
// ---------------------------------------------------------------------------

export type Cell = string | number | null;
export interface Sheet {
  name: string;
  /** First row is the header. */
  rows: Cell[][];
}

type Loose = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value));
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
/**
 * Santim to birr for display — deliberately NOT the strict converter used for
 * calculation. That one throws on a fractional santim, which is right when
 * money is being computed and wrong here: a backup that refuses to be written
 * because one stored figure is odd is a backup nobody gets to take.
 */
const toBirr = (santim: number): number => Math.round(santim) / 100;
const birr = (value: unknown): number | null => (typeof value === 'number' ? toBirr(value) : null);
const pct = (bps: unknown): number | null => (typeof bps === 'number' ? bps / 100 : null);

function dateText(value: unknown): string {
  const at = (value as { at?: { toDate?: () => Date } } | null | undefined)?.at;
  return at?.toDate === undefined ? '' : formatDual(at.toDate());
}

/**
 * One sheet per kind of record, readable without knowing the database.
 *
 * Money is decimal birr and dates carry both calendars, because the person
 * opening this has no use for santim or for a timestamp.
 */
export function workbookSheets(
  job: ArchiveJob,
  verdict: ArchiveVerdict,
  meta: { exportedAt: string; contentSha256: string },
): Sheet[] {
  const c = job.contract.data as unknown as Loose;
  const invoiceNo = new Map(job.invoices.map((i) => [i.id, text((i.data as unknown as Loose)['invoiceNo'])]));
  const projectNo = new Map(job.projects.map((p) => [p.id, text((p.data as unknown as Loose)['projectNo'])]));

  const summary: Cell[][] = [
    ['Item', 'Value'],
    ['Contract number', text(c['contractNo'])],
    ['Title', text(c['title'])],
    ['Client', text(c['clientName'])],
    ['Type', text(c['type']).replace(/_/g, ' ')],
    ['Status when archived', text(c['status'])],
    ['Signed', dateText(c['signedDate'])],
    ['Start', dateText(c['startDate'])],
    ['End', dateText(c['endDate'])],
    ['Value before VAT (ETB)', birr(c['valueNetSantim'])],
    ['VAT (ETB)', birr(c['vatSantim'])],
    ['Value with VAT (ETB)', birr(c['valueGrossSantim'])],
    ['Followed by maintenance agreement', job.successor?.contractNo ?? (c['serviceDeclined'] === true ? 'Client declined service' : '')],
    ['Invoiced before VAT (ETB)', toBirr(verdict.totals.invoicedNetSantim)],
    ['Invoiced VAT (ETB)', toBirr(verdict.totals.invoicedVatSantim)],
    ['Invoiced with VAT (ETB)', toBirr(verdict.totals.invoicedGrossSantim)],
    ['Received (ETB)', toBirr(verdict.totals.receivedGrossSantim)],
    ['Invoice numbers in this archive', verdict.invoiceNumbers.join(', ')],
    ['Backup taken', meta.exportedAt],
    ['Backup fingerprint (SHA-256)', meta.contentSha256],
  ];

  const terms: Cell[][] = [
    ['#', 'Payment term', 'Share %', 'Before VAT', 'VAT', 'With VAT', 'Due', 'Status', 'Received', 'Paid on'],
    ...[...job.terms]
      .sort((a, b) => (num((a.data as unknown as Loose)['seq']) ?? 0) - (num((b.data as unknown as Loose)['seq']) ?? 0))
      .map((t) => {
        const d = t.data as unknown as Loose;
        return [
          num(d['seq']), text(d['name']), pct(d['shareBps']), birr(d['netSantim']), birr(d['vatSantim']),
          birr(d['grossSantim']), dateText(d['dueDate']), text(d['status']).replace(/_/g, ' '),
          birr(d['receivedGrossSantim'] ?? (d['status'] === 'paid' ? d['grossSantim'] : null)), dateText(d['paidOn']),
        ] as Cell[];
      }),
  ];

  const projects: Cell[][] = [
    ['Project', 'Title', 'Status', 'Progress %', 'Planned start', 'Planned end', 'Site'],
    ...job.projects.map((p) => {
      const d = p.data as unknown as Loose;
      return [
        text(d['projectNo']), text(d['title']), text(d['status']).replace(/_/g, ' '), pct(d['progressBps']),
        dateText(d['plannedStart']), dateText(d['plannedEnd']), text((d['site'] as Loose | undefined)?.['name']),
      ] as Cell[];
    }),
  ];

  const stages: Cell[][] = [
    ['Project', '#', 'Stage', 'Weight %', 'Status', 'Progress %', 'Planned start', 'Planned end', 'Actual start', 'Actual end', 'Checkpoints'],
    ...[...job.stages]
      .sort((a, b) => a.projectId.localeCompare(b.projectId) || (num((a.data as Loose)['seq']) ?? 0) - (num((b.data as Loose)['seq']) ?? 0))
      .map((s) => {
        const d = s.data as Loose;
        const checkpoints = Array.isArray(d['checkpoints']) ? (d['checkpoints'] as Loose[]) : [];
        const done = (cp: Loose) => {
          const at = cp['doneAt'];
          return isTimestampLike(at) ? ` ✓ ${formatDual(new Date(at.toMillis()))}` : '';
        };
        return [
          projectNo.get(s.projectId) ?? s.projectId, num(d['seq']), text(d['name']), pct(d['weightBps']),
          text(d['status']).replace(/_/g, ' '), pct(d['progressBps']), dateText(d['plannedStart']), dateText(d['plannedEnd']),
          dateText(d['actualStart']), dateText(d['actualEnd']),
          checkpoints.map((cp) => `${text(cp['label'])}${done(cp)}`).join('; '),
        ] as Cell[];
      }),
  ];

  const invoices: Cell[][] = [
    ['Invoice', 'Fiscal no.', 'Issued', 'Due', 'Before VAT', 'VAT', 'With VAT', 'Paid', 'Balance', 'Status', 'Project', 'VAT period (EC)'],
    ...[...job.invoices]
      .sort((a, b) => text((a.data as unknown as Loose)['invoiceNo']).localeCompare(text((b.data as unknown as Loose)['invoiceNo']), undefined, { numeric: true }))
      .map((i) => {
        const d = i.data as unknown as Loose;
        return [
          text(d['invoiceNo']), text(d['fsNo']), dateText(d['issueDate']), dateText(d['dueDate']), birr(d['netSantim']),
          birr(d['vatSantim']), birr(d['grossSantim']), birr(d['paidGrossSantim']), birr(d['balanceGrossSantim']),
          text(d['status']).replace(/_/g, ' '), projectNo.get(text(d['projectId'])) ?? '', text(d['vatPeriodEc']),
        ] as Cell[];
      }),
  ];

  const receipts: Cell[][] = [
    ['Invoice', 'Received', 'Amount', 'Method', 'Bank reference', 'Tax withheld by client', 'Withholding certificate'],
    ...job.receipts.map((r) => {
      const d = r.data as Loose;
      return [
        invoiceNo.get(r.invoiceId) ?? r.invoiceId, dateText(d['receivedDate']), birr(d['amountGrossSantim']),
        text(d['method']).replace(/_/g, ' '), text(d['bankRef']), birr(d['clientWhtSantim']), text(d['clientWhtCertificateNo']),
      ] as Cell[];
    }),
  ];

  const notes: Cell[][] = [
    ['Invoice', 'When', 'What', 'By', 'Spoke to', 'Note'],
    ...job.chaseSteps.map((s) => {
      const d = s.data as Loose;
      return [
        invoiceNo.get(s.invoiceId) ?? s.invoiceId, dateText(d['at']), text(d['action']).replace(/_/g, ' '),
        text(d['byName']), text(d['contactName']), text(d['note']),
      ] as Cell[];
    }),
  ];

  const vouchers: Cell[][] = [
    ['Voucher', 'Subcontractor', 'Their invoice', 'Project', 'Stage', 'Before VAT', 'VAT', 'With VAT', 'Tax withheld', 'Paid out', 'Status', 'Paid on'],
    ...job.vouchers.map((v) => {
      const d = v.data as unknown as Loose;
      return [
        text(d['voucherNo']), text(d['subcontractorName']), text(d['supplierInvoiceNo']), projectNo.get(text(d['projectId'])) ?? '',
        text(d['phaseName']), birr(d['netSantim']), birr(d['supplierVatSantim']), birr(d['grossSantim']), birr(d['whtSantim']),
        birr(d['netPayableSantim']), text(d['status']).replace(/_/g, ' '), dateText(d['paymentDate']),
      ] as Cell[];
    }),
  ];

  const crew: Cell[][] = [
    ['Project', 'Technician', 'Role', 'Share of their time %', 'From', 'To', 'Still active'],
    ...job.assignments.map((a) => {
      const d = a.data as Loose;
      return [
        projectNo.get(text(d['projectId'])) ?? text(d['projectId']), text(d['technicianName']), text(d['role']),
        pct(d['allocationBps']), dateText(d['startDate']), dateText(d['endDate']), d['active'] === true ? 'yes' : 'no',
      ] as Cell[];
    }),
  ];

  return [
    { name: 'Summary', rows: summary },
    { name: 'Payment terms', rows: terms },
    { name: 'Projects', rows: projects },
    { name: 'Stages', rows: stages },
    { name: 'Invoices', rows: invoices },
    { name: 'Receipts', rows: receipts },
    { name: 'Collection notes', rows: notes },
    { name: 'Payment vouchers', rows: vouchers },
    { name: 'Crew', rows: crew },
  ];
}
