/**
 * Elevator project phases: the standard template, progress roll-up, sequencing,
 * and authority certification.
 *
 * Project progress is a WEIGHTED roll-up of its phases, never a number someone
 * types. A project manager reporting "60% done" with no phase behind it is an
 * opinion; a roll-up is a claim you can interrogate phase by phase.
 */

import { clampBps, daysBetween, rateBps } from './kpi.js';
import type { ElevatorPhaseKey, RateBps } from './schema.js';

// ---------------------------------------------------------------------------
// The standard elevator template
// ---------------------------------------------------------------------------

export interface PhaseTemplateEntry {
  key: ElevatorPhaseKey;
  name: string;
  /** Share of project progress, in bps. The template sums to 10000. */
  weightBps: number;
  /** Phases that should finish before this one starts. */
  dependsOn: readonly ElevatorPhaseKey[];
  description: string;
}

/**
 * Weights reflect effort, not calendar time. Shaft preparation is slow but
 * mostly other trades' work; cab assembly is where our crew actually lives.
 * Adjustable per project — these are a starting point, not a rule.
 */
export const ELEVATOR_PHASE_TEMPLATE: readonly PhaseTemplateEntry[] = [
  {
    key: 'shaft_prep',
    name: 'Shaft preparation',
    weightBps: 2000,
    dependsOn: [],
    description: 'Shaft survey, civil works sign-off, scaffolding, machine room readiness.',
  },
  {
    key: 'rail_installation',
    name: 'Rail installation',
    weightBps: 2500,
    dependsOn: ['shaft_prep'],
    description: 'Guide rails, brackets, alignment and plumbing of the shaft.',
  },
  {
    key: 'cab_assembly',
    name: 'Cab assembly',
    weightBps: 3000,
    dependsOn: ['rail_installation'],
    description: 'Car frame, cab, doors, counterweight, ropes, machine and controller.',
  },
  {
    key: 'testing',
    name: 'Testing & commissioning',
    weightBps: 1500,
    dependsOn: ['cab_assembly'],
    description: 'Load tests, safety gear, overspeed governor, levelling, snag list.',
  },
  {
    key: 'authority_inspection',
    name: 'Authority inspection & certification',
    weightBps: 1000,
    dependsOn: ['testing'],
    description: 'Regulatory inspection and the certificate that gates handover.',
  },
];

export interface PhaseWeight {
  key: string;
  weightBps: number;
}

/**
 * Phase weights must sum to 100%, or "project progress" means something other
 * than it claims.
 */
export function validatePhaseWeights(
  phases: readonly PhaseWeight[],
): { ok: true } | { ok: false; error: string; totalBps: number } {
  if (phases.length === 0) {
    return { ok: false, error: 'A project needs at least one phase.', totalBps: 0 };
  }
  for (const phase of phases) {
    if (!Number.isInteger(phase.weightBps) || phase.weightBps <= 0) {
      return {
        ok: false,
        error: `Phase '${phase.key}' must carry a positive whole-basis-point weight.`,
        totalBps: phase.weightBps,
      };
    }
  }
  const total = phases.reduce((a, p) => a + p.weightBps, 0);
  if (total !== 10_000) {
    return {
      ok: false,
      error: `Phase weights must sum to 100%, got ${(total / 100).toFixed(2)}%.`,
      totalBps: total,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Progress roll-up
// ---------------------------------------------------------------------------

export type PhaseStatus = 'not_started' | 'in_progress' | 'blocked' | 'completed';

export interface PhaseProgress {
  key: string;
  weightBps: number;
  progressBps: number;
  status: PhaseStatus;
}

/**
 * Weighted project progress.
 *
 * Divides by the ACTUAL weight total rather than assuming 10000, so a project
 * whose weights have drifted still reports a sane 0-100% instead of a number
 * above 100 or a silent underestimate. `validatePhaseWeights` is what stops the
 * drift; this just refuses to compound it.
 */
export function rollUpProgress(phases: readonly PhaseProgress[]): number {
  const totalWeight = phases.reduce((a, p) => a + p.weightBps, 0);
  if (totalWeight === 0) return 0;
  const weighted = phases.reduce((a, p) => a + clampBps(p.progressBps) * p.weightBps, 0);
  return clampBps(Math.round(weighted / totalWeight));
}

/**
 * Derive a phase's status from its progress.
 *
 * `blocked` is a human judgement — something off-site is holding the phase up —
 * so it is never overwritten by an automatic pass, exactly like a renewal status
 * someone set by hand.
 */
export function derivePhaseStatus(progressBps: number, currentStatus: PhaseStatus): PhaseStatus {
  if (currentStatus === 'blocked') return 'blocked';
  if (progressBps >= 10_000) return 'completed';
  if (progressBps <= 0) return 'not_started';
  return 'in_progress';
}

// ---------------------------------------------------------------------------
// Sequencing
// ---------------------------------------------------------------------------

export interface SequenceWarning {
  key: string;
  blockedBy: string[];
  message: string;
}

/**
 * Phases started before their predecessors finished.
 *
 * Deliberately a WARNING, not a block. Real sites overlap — a crew will start
 * hanging rails while the last of the shaft sign-off is chased — and software
 * that refuses to record what is actually happening just gets worked around.
 * Flag it, name what is outstanding, and let the manager decide.
 */
export function sequenceWarnings(
  phases: readonly (PhaseProgress & { dependsOn?: readonly string[] | undefined })[],
): SequenceWarning[] {
  const byKey = new Map(phases.map((p) => [p.key, p]));
  const warnings: SequenceWarning[] = [];

  for (const phase of phases) {
    if (phase.progressBps <= 0) continue;
    const blockedBy = (phase.dependsOn ?? []).filter((key) => {
      const predecessor = byKey.get(key);
      return predecessor !== undefined && predecessor.progressBps < 10_000;
    });
    if (blockedBy.length > 0) {
      warnings.push({
        key: phase.key,
        blockedBy: [...blockedBy],
        message: `Started before ${blockedBy.join(' and ')} finished.`,
      });
    }
  }

  return warnings;
}

/** The phase a crew should be working on next: first incomplete, unblocked phase. */
export function nextActionablePhase<T extends PhaseProgress & { dependsOn?: readonly string[] | undefined }>(
  phases: readonly T[],
): T | null {
  const byKey = new Map(phases.map((p) => [p.key, p]));
  for (const phase of phases) {
    if (phase.progressBps >= 10_000 || phase.status === 'blocked') continue;
    const ready = (phase.dependsOn ?? []).every((key) => (byKey.get(key)?.progressBps ?? 10_000) >= 10_000);
    if (ready) return phase;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Authority certification
// ---------------------------------------------------------------------------

export type CertificationResult = 'pending' | 'passed' | 'failed_rework' | 'not_applicable';

export interface CertificationState {
  result: CertificationResult;
  /** How many times the authority has inspected. */
  attempts: number;
  certificateExpiryDate: Date | null;
}

export interface CertificationSummary {
  result: CertificationResult;
  attempts: number;
  /** Null until an inspection has actually happened — pending is not a failure. */
  firstPass: boolean | null;
  /** Handover is gated on certification. */
  blocksHandover: boolean;
  daysUntilExpiry: number | null;
  expiryState: 'valid' | 'expiring_soon' | 'expired' | 'not_applicable';
}

export function summariseCertification(
  state: CertificationState,
  asOf: Date,
  warningDays = 60,
): CertificationSummary {
  const judged = state.result === 'passed' || state.result === 'failed_rework';

  const daysUntilExpiry =
    state.certificateExpiryDate === null ? null : daysBetween(asOf, state.certificateExpiryDate);

  const expiryState: CertificationSummary['expiryState'] =
    state.result !== 'passed' || daysUntilExpiry === null
      ? 'not_applicable'
      : daysUntilExpiry < 0
        ? 'expired'
        : daysUntilExpiry <= warningDays
          ? 'expiring_soon'
          : 'valid';

  return {
    result: state.result,
    attempts: state.attempts,
    firstPass: judged ? state.result === 'passed' && state.attempts <= 1 : null,
    blocksHandover: state.result !== 'passed' && state.result !== 'not_applicable',
    daysUntilExpiry,
    expiryState,
  };
}

/**
 * Record an inspection outcome.
 *
 * Attempts only increment on a real verdict. Re-saving a pending record — which
 * happens whenever someone edits the inspection date — must not inflate the
 * count, or first-pass rate quietly decays every time the form is touched.
 */
export function recordInspection(
  current: CertificationState,
  result: Exclude<CertificationResult, 'pending'>,
): CertificationState {
  if (result === 'not_applicable') {
    return { ...current, result, attempts: current.attempts };
  }
  return { ...current, result, attempts: current.attempts + 1 };
}

// ---------------------------------------------------------------------------
// Portfolio view
// ---------------------------------------------------------------------------

/** First-pass inspection rate across finished inspections — the estimating input. */
export function firstPassRate(summaries: readonly CertificationSummary[]): RateBps {
  const judged = summaries.filter((s) => s.firstPass !== null);
  return rateBps(judged.filter((s) => s.firstPass === true).length, judged.length);
}
