import { describe, expect, it } from 'vitest';
import {
  derivePhaseStatus,
  ELEVATOR_PHASE_TEMPLATE,
  firstPassRate,
  nextActionablePhase,
  recordInspection,
  rollUpProgress,
  sequenceWarnings,
  summariseCertification,
  validatePhaseWeights,
  type CertificationState,
  type PhaseProgress,
} from '../phases.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const phase = (
  key: string,
  weightBps: number,
  progressBps: number,
  dependsOn: string[] = [],
): PhaseProgress & { dependsOn: string[] } => ({
  key,
  weightBps,
  progressBps,
  status: derivePhaseStatus(progressBps, 'not_started'),
  dependsOn,
});

describe('the standard elevator template', () => {
  it('has the five phases in build order', () => {
    expect(ELEVATOR_PHASE_TEMPLATE.map((p) => p.key)).toEqual([
      'shaft_prep', 'rail_installation', 'cab_assembly', 'testing', 'authority_inspection',
    ]);
  });

  it('has weights that sum to exactly 100%', () => {
    expect(validatePhaseWeights([...ELEVATOR_PHASE_TEMPLATE])).toEqual({ ok: true });
  });

  it('chains each phase to its predecessor', () => {
    expect(ELEVATOR_PHASE_TEMPLATE[0]!.dependsOn).toEqual([]);
    expect(ELEVATOR_PHASE_TEMPLATE[2]!.dependsOn).toEqual(['rail_installation']);
    expect(ELEVATOR_PHASE_TEMPLATE[4]!.dependsOn).toEqual(['testing']);
  });
});

describe('weight validation', () => {
  it('rejects weights that do not sum to 100%', () => {
    const r = validatePhaseWeights([phase('a', 5000, 0), phase('b', 4000, 0)]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('90.00%');
  });

  it('rejects a zero or negative weight', () => {
    expect(validatePhaseWeights([phase('a', 10_000, 0), phase('b', 0, 0)]).ok).toBe(false);
  });

  it('rejects a project with no phases', () => {
    expect(validatePhaseWeights([]).ok).toBe(false);
  });
});

describe('weighted progress roll-up', () => {
  it('is zero when nothing has started', () => {
    expect(rollUpProgress(ELEVATOR_PHASE_TEMPLATE.map((p) => phase(p.key, p.weightBps, 0)))).toBe(0);
  });

  it('is 100% when every phase is done', () => {
    expect(rollUpProgress(ELEVATOR_PHASE_TEMPLATE.map((p) => phase(p.key, p.weightBps, 10_000)))).toBe(10_000);
  });

  it('weights heavy phases more than light ones', () => {
    // Cab assembly is 30% of the project; authority inspection is 10%.
    const cabDone = rollUpProgress([
      phase('cab_assembly', 3000, 10_000),
      phase('authority_inspection', 1000, 0),
    ]);
    const inspectionDone = rollUpProgress([
      phase('cab_assembly', 3000, 0),
      phase('authority_inspection', 1000, 10_000),
    ]);
    expect(cabDone).toBeGreaterThan(inspectionDone);
  });

  it('computes a realistic mid-build figure', () => {
    // Shaft and rails complete, cab half done, nothing else.
    const progress = rollUpProgress([
      phase('shaft_prep', 2000, 10_000),
      phase('rail_installation', 2500, 10_000),
      phase('cab_assembly', 3000, 5_000),
      phase('testing', 1500, 0),
      phase('authority_inspection', 1000, 0),
    ]);
    expect(progress).toBe(6000); // 20 + 25 + 15
  });

  it('normalises against the real weight total rather than compounding drift', () => {
    // Weights sum to 5000, not 10000 — still reports a sane 0-100%.
    expect(rollUpProgress([phase('a', 2500, 10_000), phase('b', 2500, 0)])).toBe(5000);
  });

  it('clamps a phase reporting over 100%', () => {
    expect(rollUpProgress([phase('a', 10_000, 15_000)])).toBe(10_000);
  });

  it('does not divide by zero on a weightless project', () => {
    expect(rollUpProgress([phase('a', 0, 10_000)])).toBe(0);
    expect(rollUpProgress([])).toBe(0);
  });
});

describe('phase status derivation', () => {
  it('maps progress onto a status', () => {
    expect(derivePhaseStatus(0, 'not_started')).toBe('not_started');
    expect(derivePhaseStatus(4000, 'not_started')).toBe('in_progress');
    expect(derivePhaseStatus(10_000, 'in_progress')).toBe('completed');
  });

  it('never overwrites a blocked status set by a person', () => {
    // Something off-site is holding it up; an automatic pass must not paper over it.
    expect(derivePhaseStatus(4000, 'blocked')).toBe('blocked');
    expect(derivePhaseStatus(10_000, 'blocked')).toBe('blocked');
  });
});

describe('sequencing is a warning, not a block', () => {
  it('flags a phase started before its predecessor finished', () => {
    const warnings = sequenceWarnings([
      phase('shaft_prep', 2000, 6000),
      phase('rail_installation', 2500, 2000, ['shaft_prep']),
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.key).toBe('rail_installation');
    expect(warnings[0]!.blockedBy).toEqual(['shaft_prep']);
  });

  it('says nothing when work runs in order', () => {
    expect(
      sequenceWarnings([
        phase('shaft_prep', 2000, 10_000),
        phase('rail_installation', 2500, 4000, ['shaft_prep']),
      ]),
    ).toEqual([]);
  });

  it('says nothing about a phase that has not started', () => {
    expect(
      sequenceWarnings([
        phase('shaft_prep', 2000, 1000),
        phase('rail_installation', 2500, 0, ['shaft_prep']),
      ]),
    ).toEqual([]);
  });

  it('names every outstanding predecessor', () => {
    const warnings = sequenceWarnings([
      phase('a', 3000, 5000),
      phase('b', 3000, 5000),
      phase('c', 4000, 1000, ['a', 'b']),
    ]);
    expect(warnings[0]!.blockedBy).toEqual(['a', 'b']);
  });
});

describe('nextActionablePhase', () => {
  it('picks the first incomplete phase whose predecessors are done', () => {
    const next = nextActionablePhase([
      phase('shaft_prep', 2000, 10_000),
      phase('rail_installation', 2500, 4000, ['shaft_prep']),
      phase('cab_assembly', 3000, 0, ['rail_installation']),
    ]);
    expect(next?.key).toBe('rail_installation');
  });

  it('skips a blocked phase and moves to the next workable one', () => {
    const phases = [
      { ...phase('shaft_prep', 2000, 10_000), status: 'completed' as const },
      { ...phase('rail_installation', 2500, 3000, ['shaft_prep']), status: 'blocked' as const },
      { ...phase('cab_assembly', 3000, 0, []), status: 'not_started' as const },
    ];
    expect(nextActionablePhase(phases)?.key).toBe('cab_assembly');
  });

  it('returns null when everything is finished', () => {
    expect(nextActionablePhase([phase('a', 10_000, 10_000)])).toBeNull();
  });
});

describe('certification', () => {
  const state = (over: Partial<CertificationState> = {}): CertificationState => ({
    result: 'pending',
    attempts: 0,
    certificateExpiryDate: null,
    ...over,
  });

  it('withholds a first-pass verdict while the inspection is pending', () => {
    const s = summariseCertification(state(), utc(2025, 9, 12));
    expect(s.firstPass).toBeNull();      // pending is not a failure
    expect(s.blocksHandover).toBe(true); // but handover is still gated
  });

  it('credits a first-time pass', () => {
    const s = summariseCertification(state({ result: 'passed', attempts: 1 }), utc(2025, 9, 12));
    expect(s.firstPass).toBe(true);
    expect(s.blocksHandover).toBe(false);
  });

  it('does not credit a pass that needed rework', () => {
    const s = summariseCertification(state({ result: 'passed', attempts: 2 }), utc(2025, 9, 12));
    expect(s.firstPass).toBe(false);
  });

  it('treats a failed inspection as blocking handover', () => {
    const s = summariseCertification(state({ result: 'failed_rework', attempts: 1 }), utc(2025, 9, 12));
    expect(s.firstPass).toBe(false);
    expect(s.blocksHandover).toBe(true);
  });

  it('does not gate handover on an inspection that does not apply', () => {
    const s = summariseCertification(state({ result: 'not_applicable' }), utc(2025, 9, 12));
    expect(s.blocksHandover).toBe(false);
    expect(s.firstPass).toBeNull();
  });

  it('tracks certificate expiry once passed', () => {
    const asOf = utc(2025, 9, 12);
    const valid = summariseCertification(
      state({ result: 'passed', attempts: 1, certificateExpiryDate: utc(2026, 9, 1) }), asOf);
    const soon = summariseCertification(
      state({ result: 'passed', attempts: 1, certificateExpiryDate: utc(2025, 10, 20) }), asOf);
    const gone = summariseCertification(
      state({ result: 'passed', attempts: 1, certificateExpiryDate: utc(2025, 8, 1) }), asOf);

    expect(valid.expiryState).toBe('valid');
    expect(soon.expiryState).toBe('expiring_soon');
    expect(gone.expiryState).toBe('expired');
    expect(gone.daysUntilExpiry).toBe(-42);
  });

  it('does not track expiry for an inspection that has not passed', () => {
    const s = summariseCertification(
      state({ result: 'failed_rework', attempts: 1, certificateExpiryDate: utc(2026, 1, 1) }),
      utc(2025, 9, 12),
    );
    expect(s.expiryState).toBe('not_applicable');
  });
});

describe('recordInspection', () => {
  it('increments attempts on a real verdict', () => {
    const first = recordInspection({ result: 'pending', attempts: 0, certificateExpiryDate: null }, 'failed_rework');
    expect(first).toMatchObject({ result: 'failed_rework', attempts: 1 });

    const second = recordInspection(first, 'passed');
    expect(second).toMatchObject({ result: 'passed', attempts: 2 });
    expect(summariseCertification(second, utc(2025, 9, 12)).firstPass).toBe(false);
  });

  it('does NOT inflate attempts when marking an inspection not applicable', () => {
    // Otherwise first-pass rate quietly decays every time someone edits the form.
    const s = recordInspection({ result: 'pending', attempts: 0, certificateExpiryDate: null }, 'not_applicable');
    expect(s.attempts).toBe(0);
  });
});

describe('firstPassRate', () => {
  it('counts only inspections that actually happened', () => {
    const asOf = utc(2025, 9, 12);
    const summaries = [
      summariseCertification({ result: 'passed', attempts: 1, certificateExpiryDate: null }, asOf),
      summariseCertification({ result: 'passed', attempts: 3, certificateExpiryDate: null }, asOf),
      summariseCertification({ result: 'pending', attempts: 0, certificateExpiryDate: null }, asOf),
    ];
    expect(firstPassRate(summaries)).toBe(5000); // 1 of 2 judged, pending excluded
  });

  it('is null rather than zero when nothing has been inspected', () => {
    const pending = summariseCertification(
      { result: 'pending', attempts: 0, certificateExpiryDate: null }, utc(2025, 9, 12));
    expect(firstPassRate([pending])).toBeNull();
  });
});
