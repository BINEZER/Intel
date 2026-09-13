/**
 * "What should we finish next?" — ranking unfinished stages by the cash their
 * completion releases, across the whole portfolio.
 *
 * The priority board answers *which project* deserves attention. This answers
 * the sharper question: *which single piece of work*, finished this week,
 * releases the most money — and that answer routinely crosses project
 * boundaries. Four projects each needing one more day of commissioning can beat
 * one project needing a month.
 *
 * A stage releases cash when a payment milestone is gated on it. The value is
 * discounted by how much of the stage is left and by whether the stage is even
 * ours to finish: a milestone sitting behind a customs clearance is not work the
 * crew can go and do.
 */

import { clampBps, daysBetween, rateBps } from './kpi.js';
import { isOurs, stageName, stageOwner, type StageTemplateEntry } from './stages.js';
import type { RateBps } from './schema.js';

export interface UnlockStageInput {
  projectId: string;
  projectTitle: string;
  clientName: string;
  phaseId: string;
  stageKey: string;
  stageName: string;
  /** 0-10000. */
  progressBps: number;
  status: 'not_started' | 'in_progress' | 'blocked' | 'completed';
  /** Stages that must finish first, by phase id, so blocked work is visible. */
  dependsOnPhaseIds: readonly string[];
  plannedEnd: Date | null;
}

export interface UnlockMilestoneInput {
  milestoneId: string;
  contractId: string;
  name: string;
  /** Phase id this milestone is gated on. */
  phaseId: string | null;
  grossSantim: number;
  status: 'pending' | 'ready_to_invoice' | 'invoiced' | 'paid' | 'waived';
}

export interface UnlockRow {
  projectId: string;
  projectTitle: string;
  clientName: string;
  phaseId: string;
  stageKey: string;
  stageName: string;
  owner: StageTemplateEntry['owner'];
  /** True when our own crew can act on it. */
  actionable: boolean;
  progressBps: number;
  /** Share of the stage still to do. */
  remainingBps: number;
  status: UnlockStageInput['status'];

  /** Face value of every milestone gated on this stage. */
  gatedSantim: number;
  milestones: { name: string; grossSantim: number }[];
  /**
   * Cash released per point of progress still required — the efficiency number.
   * A stage 90% done holding 2M beats one 10% done holding 3M.
   */
  santimPerRemainingBps: number;
  /** Ranking key: gated value weighted by how little is left to do. */
  unlockScoreSantim: number;
  /** Stages that must finish first and have not. */
  blockedByPhaseIds: string[];
  daysUntilPlannedEnd: number | null;
  overdue: boolean;
}

export interface UnlockReport {
  rows: UnlockRow[];
  /** Cash sitting behind work our own crew can do right now. */
  actionableSantim: number;
  /** Cash sitting behind someone else — client, supplier, authority. */
  waitingOnOthersSantim: number;
  /** Cash behind stages whose predecessors are unfinished. */
  blockedSantim: number;
  totalGatedSantim: number;
  byOwner: Record<StageTemplateEntry['owner'], number>;
}

/**
 * Rank unfinished stages by the cash they release.
 *
 * Only milestones that have not yet been invoiced count. Once a milestone is
 * invoiced the money has moved from "unlock by finishing work" to "collect by
 * chasing payment" — a different job, on the priority board, and counting it in
 * both places would double it.
 */
export function buildUnlockReport(
  stages: readonly UnlockStageInput[],
  milestones: readonly UnlockMilestoneInput[],
  asOf: Date,
): UnlockReport {
  const gatedByPhase = new Map<string, UnlockMilestoneInput[]>();
  for (const milestone of milestones) {
    if (milestone.phaseId === null) continue;
    if (milestone.status !== 'pending' && milestone.status !== 'ready_to_invoice') continue;
    const existing = gatedByPhase.get(milestone.phaseId);
    if (existing === undefined) gatedByPhase.set(milestone.phaseId, [milestone]);
    else existing.push(milestone);
  }

  const completeness = new Map(stages.map((s) => [s.phaseId, s.progressBps >= 10_000]));

  const rows: UnlockRow[] = [];
  for (const stage of stages) {
    if (stage.progressBps >= 10_000) continue; // nothing left to unlock
    const gated = gatedByPhase.get(stage.phaseId) ?? [];
    if (gated.length === 0) continue; // no money behind it

    const gatedSantim = gated.reduce((a, m) => a + m.grossSantim, 0);
    const remainingBps = Math.max(1, 10_000 - clampBps(stage.progressBps));

    const blockedByPhaseIds = stage.dependsOnPhaseIds.filter(
      (id) => completeness.get(id) === false,
    );

    const owner = stageOwner(stage.stageKey);
    const actionable = isOurs(stage.stageKey) && blockedByPhaseIds.length === 0 && stage.status !== 'blocked';

    // Weighting by what is LEFT rather than by size alone is the whole point:
    // finishing the last tenth of a stage releases the same money as finishing
    // all of it, for a tenth of the work.
    const unlockScoreSantim = Math.round((gatedSantim * (10_000 - remainingBps / 2)) / 10_000);

    const daysUntilPlannedEnd = stage.plannedEnd === null ? null : daysBetween(asOf, stage.plannedEnd);

    rows.push({
      projectId: stage.projectId,
      projectTitle: stage.projectTitle,
      clientName: stage.clientName,
      phaseId: stage.phaseId,
      stageKey: stage.stageKey,
      stageName: stage.stageName || stageName(stage.stageKey),
      owner,
      actionable,
      progressBps: stage.progressBps,
      remainingBps,
      status: stage.status,
      gatedSantim,
      milestones: gated.map((m) => ({ name: m.name, grossSantim: m.grossSantim })),
      santimPerRemainingBps: Math.round(gatedSantim / remainingBps),
      unlockScoreSantim,
      blockedByPhaseIds,
      daysUntilPlannedEnd,
      overdue: daysUntilPlannedEnd !== null && daysUntilPlannedEnd < 0,
    });
  }

  // Work we can actually do comes first — a list led by items nobody can action
  // is a list that gets ignored.
  rows.sort(
    (a, b) =>
      Number(b.actionable) - Number(a.actionable) ||
      b.unlockScoreSantim - a.unlockScoreSantim ||
      b.gatedSantim - a.gatedSantim,
  );

  const byOwner: UnlockReport['byOwner'] = { us: 0, client: 0, supplier: 0, authority: 0 };
  for (const row of rows) byOwner[row.owner] += row.gatedSantim;

  return {
    rows,
    actionableSantim: rows.filter((r) => r.actionable).reduce((a, r) => a + r.gatedSantim, 0),
    waitingOnOthersSantim: rows
      .filter((r) => !r.actionable && r.blockedByPhaseIds.length === 0 && r.owner !== 'us')
      .reduce((a, r) => a + r.gatedSantim, 0),
    blockedSantim: rows
      .filter((r) => r.blockedByPhaseIds.length > 0 || r.status === 'blocked')
      .reduce((a, r) => a + r.gatedSantim, 0),
    totalGatedSantim: rows.reduce((a, r) => a + r.gatedSantim, 0),
    byOwner,
  };
}

// ---------------------------------------------------------------------------
// Stage-based project standing
// ---------------------------------------------------------------------------

export interface ProjectStanding {
  projectId: string;
  title: string;
  clientName: string;
  /** The furthest stage actually under way — where the project "is". */
  currentStageKey: string;
  currentStageName: string;
  currentStageProgressBps: number;
  stagesComplete: number;
  stagesTotal: number;
  progressBps: number;

  contractGrossSantim: number;
  invoicedGrossSantim: number;
  collectedGrossSantim: number;
  /** Contract value not yet invoiced — the headline the manager asked for. */
  remainingContractSantim: number;
  remainingBps: RateBps;
  /** Of what remains, how much is gated on work rather than waiting on a client. */
  unlockableSantim: number;
}

/**
 * Where a project stands, by stage and by money left on the contract.
 *
 * The current stage is the LAST one with any progress, not the first unfinished
 * one. Real sites overlap — cab assembly starts while the machine room is still
 * being finished — and reporting the earliest incomplete stage would peg a
 * project to whatever small thing got left behind.
 */
export function projectStanding(
  project: {
    projectId: string;
    title: string;
    clientName: string;
    contractGrossSantim: number;
    invoicedGrossSantim: number;
    collectedGrossSantim: number;
  },
  stages: readonly UnlockStageInput[],
  unlockRows: readonly UnlockRow[],
): ProjectStanding {
  const ordered = [...stages];
  const started = ordered.filter((s) => s.progressBps > 0);
  const current = started.length > 0 ? (started[started.length - 1] as UnlockStageInput) : ordered[0];

  const remainingContractSantim = Math.max(
    0,
    project.contractGrossSantim - project.invoicedGrossSantim,
  );

  return {
    projectId: project.projectId,
    title: project.title,
    clientName: project.clientName,
    currentStageKey: current?.stageKey ?? '',
    currentStageName: current === undefined ? '—' : current.stageName || stageName(current.stageKey),
    currentStageProgressBps: current?.progressBps ?? 0,
    stagesComplete: ordered.filter((s) => s.progressBps >= 10_000).length,
    stagesTotal: ordered.length,
    progressBps:
      ordered.length === 0
        ? 0
        : clampBps(Math.round(ordered.reduce((a, s) => a + clampBps(s.progressBps), 0) / ordered.length)),
    contractGrossSantim: project.contractGrossSantim,
    invoicedGrossSantim: project.invoicedGrossSantim,
    collectedGrossSantim: project.collectedGrossSantim,
    remainingContractSantim,
    remainingBps: rateBps(remainingContractSantim, project.contractGrossSantim),
    unlockableSantim: unlockRows
      .filter((r) => r.projectId === project.projectId && r.actionable)
      .reduce((a, r) => a + r.gatedSantim, 0),
  };
}
