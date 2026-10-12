/**
 * Gathering the whole portfolio's detail in one place.
 *
 * Stages, payment milestones and receipts all live in SUBCOLLECTIONS — under a
 * project, a contract and an invoice respectively. That is the right shape for
 * writing, and the wrong shape for any question asked across the portfolio:
 * "which unfinished work releases the most cash" and "how much came in last
 * month" both need every subcollection at once, and Firestore has no query that
 * spans them.
 *
 * So they are fanned out and read in parallel. For a company running tens of
 * projects this is tens of small reads, which is cheap and, more to the point,
 * correct — the alternative that was here before was a page that quietly
 * rendered from an empty array and looked like a business with no work in it.
 *
 * A Cloud Function denormalising these onto the parent documents would make it
 * one read; until then this is honest about what it costs.
 */

import { useEffect, useState } from 'react';
import { getMilestones } from './contracts.js';
import { getPhases } from './projects.js';
import { getReceipts } from './invoices.js';
import type { WithId } from './repository.js';
import type { Contract, Invoice, PaymentMilestone, Project, ProjectPhase, Receipt } from '../lib/schema.js';

export interface PortfolioDetail {
  /** Every project's stages, tagged with the project they came from. */
  stages: (WithId<ProjectPhase> & { projectId: string })[];
  milestones: (WithId<PaymentMilestone> & { contractId: string })[];
  receipts: Map<string, WithId<Receipt>[]>;
}

const EMPTY: PortfolioDetail = { stages: [], milestones: [], receipts: new Map() };

/**
 * Fan out with a concurrency cap.
 *
 * Firing four hundred reads at once is how a browser's connection pool starts
 * queueing them anyway, only with less predictable failure. Ten at a time
 * finishes a hundred documents in ten round trips.
 */
async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await fn(items[index] as T);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * A short memory of what was just read.
 *
 * Priority, the cash forecast and the dashboard all want the same hundreds of
 * small reads, and somebody moving between them would pay for them three times in
 * a minute. Thirty seconds is long enough to cover that and short enough that a
 * receipt recorded a moment ago shows up on the next page.
 */
const CACHE_MS = 30_000;
const recent = new Map<string, { at: number; detail: Promise<PortfolioDetail> }>();

export function loadPortfolioDetail(
  projects: readonly WithId<Project>[],
  contracts: readonly WithId<Contract>[],
  invoices: readonly WithId<Invoice>[],
): Promise<PortfolioDetail> {
  const key = [
    projects.map((p) => p.id).join(','),
    contracts.map((c) => c.id).join(','),
    invoices.filter((i) => i.status !== 'draft' && i.status !== 'void').map((i) => `${i.id}:${i.status}`).join(','),
  ].join('|');
  const hit = recent.get(key);
  if (hit !== undefined && Date.now() - hit.at < CACHE_MS) return hit.detail;
  const detail = readPortfolioDetail(projects, contracts, invoices);
  recent.set(key, { at: Date.now(), detail });
  // A failed read must not be served from memory for the next thirty seconds.
  detail.catch(() => recent.delete(key));
  return detail;
}

async function readPortfolioDetail(
  projects: readonly WithId<Project>[],
  contracts: readonly WithId<Contract>[],
  invoices: readonly WithId<Invoice>[],
): Promise<PortfolioDetail> {
  const [stageGroups, milestoneGroups, receiptGroups] = await Promise.all([
    mapLimited(projects, 10, async (project) =>
      (await getPhases(project.id)).map((phase) => ({ ...phase, projectId: project.id })),
    ),
    mapLimited(contracts, 10, async (contract) =>
      (await getMilestones(contract.id)).map((milestone) => ({ ...milestone, contractId: contract.id })),
    ),
    // Only invoices that could have been paid. A draft has no receipts and a
    // void one's are irrelevant, so neither is worth a round trip.
    mapLimited(
      invoices.filter((i) => i.status !== 'draft' && i.status !== 'void'),
      10,
      async (invoice) => [invoice.id, await getReceipts(invoice.id)] as const,
    ),
  ]);

  return {
    stages: stageGroups.flat(),
    milestones: milestoneGroups.flat(),
    receipts: new Map(receiptGroups),
  };
}

export interface PortfolioDetailState extends PortfolioDetail {
  loading: boolean;
  error: string | null;
}

/**
 * Load the portfolio's subcollections whenever the parent lists change.
 *
 * Keyed on the ids rather than the arrays: a live subscription hands back a new
 * array object on every snapshot, and re-fanning out a hundred reads because a
 * single invoice's `updatedAt` moved would be indefensible.
 */
export function usePortfolioDetail(
  projects: readonly WithId<Project>[],
  contracts: readonly WithId<Contract>[],
  invoices: readonly WithId<Invoice>[],
): PortfolioDetailState {
  const [state, setState] = useState<PortfolioDetail>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = [
    projects.map((p) => p.id).join(','),
    contracts.map((c) => c.id).join(','),
    invoices.filter((i) => i.status !== 'draft' && i.status !== 'void').map((i) => i.id).join(','),
  ].join('|');

  useEffect(() => {
    if (projects.length === 0 && contracts.length === 0 && invoices.length === 0) {
      setState(EMPTY);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    loadPortfolioDetail(projects, contracts, invoices)
      .then((detail) => {
        if (!cancelled) setState(detail);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the project stages and payment milestones.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // The id list is the real dependency; the arrays themselves are new objects
    // on every snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { ...state, loading, error };
}
