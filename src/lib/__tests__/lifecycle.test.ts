import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WARRANTY_MONTHS,
  findConsequences,
  summariseConsequences,
  warrantyEnd,
  type LifecycleInput,
} from '../lifecycle.js';

const AS_OF = new Date(Date.UTC(2026, 8, 15));
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

function input(over: Partial<LifecycleInput> = {}): LifecycleInput {
  return {
    clients: [],
    contracts: [],
    projects: [],
    units: [],
    asOf: AS_OF,
    ...over,
  };
}

function contract(over: Partial<LifecycleInput['contracts'][number]> = {}) {
  return {
    id: 'k1',
    contractNo: 'AGR-2024-001',
    clientId: 'c1',
    clientName: 'Adera Hospital',
    type: 'supply_install',
    status: 'active',
    endDate: day(2027, 1, 1),
    warranty: { months: 12, startsOn: null, endsOn: null, alertDays: 90 },
    succeededByContractId: null,
    serviceDeclined: false,
    ...over,
  };
}

function project(over: Partial<LifecycleInput['projects'][number]> = {}) {
  return {
    id: 'p1',
    projectNo: 'PRJ-2024-001',
    title: 'Lift 1',
    clientId: 'c1',
    contractId: 'k1',
    status: 'in_progress',
    progressBps: 5000,
    handoverSigned: false,
    ...over,
  };
}

describe('warranty dates', () => {
  it('runs whole months from the start', () => {
    expect(warrantyEnd(day(2025, 3, 10), 12)).toEqual(day(2026, 3, 10));
    expect(warrantyEnd(day(2025, 3, 10), 24)).toEqual(day(2027, 3, 10));
  });

  it('does not gain days when the start day does not exist in the end month', () => {
    // 31 Jan + 1 month is 28 Feb, not 3 March. Rolling forward would quietly
    // extend every warranty that started on a 29th, 30th or 31st.
    expect(warrantyEnd(day(2025, 1, 31), 1)).toEqual(day(2025, 2, 28));
    expect(warrantyEnd(day(2024, 1, 31), 1)).toEqual(day(2024, 2, 29));
  });
});

describe('finished work that nobody closed', () => {
  it('spots a project at 100% still marked in progress', () => {
    const found = findConsequences(
      input({ projects: [project({ progressBps: 10_000 })] }),
    );
    const done = found.find((c) => c.kind === 'project_complete');
    expect(done).toBeDefined();
    expect(done!.action?.kind).toBe('set_project_status');
    expect(done!.action?.value).toBe('completed');
  });

  it('says nothing about a project already closed', () => {
    const found = findConsequences(
      input({ projects: [project({ progressBps: 10_000, status: 'completed' })] }),
    );
    expect(found.some((c) => c.kind === 'project_complete')).toBe(false);
  });

  it('says nothing about a project still being built', () => {
    const found = findConsequences(input({ projects: [project({ progressBps: 9_000 })] }));
    expect(found.some((c) => c.kind === 'project_complete')).toBe(false);
  });
});

describe('starting the warranty', () => {
  it('raises it once handover is signed and the clock has not started', () => {
    const found = findConsequences(
      input({
        contracts: [contract()],
        projects: [project({ handoverSigned: true, progressBps: 10_000 })],
      }),
    );
    const start = found.find((c) => c.kind === 'start_warranty');
    expect(start).toBeDefined();
    expect(start!.action?.kind).toBe('start_warranty');
    expect(start!.detail).toContain('not been started');
  });

  it('says nothing before handover', () => {
    const found = findConsequences(
      input({ contracts: [contract()], projects: [project({ handoverSigned: false })] }),
    );
    expect(found.some((c) => c.kind === 'start_warranty')).toBe(false);
  });

  it('says nothing once the clock is running', () => {
    const found = findConsequences(
      input({
        contracts: [
          contract({ warranty: { months: 12, startsOn: day(2026, 9, 1), endsOn: day(2027, 9, 1), alertDays: 90 } }),
        ],
        projects: [project({ handoverSigned: true })],
      }),
    );
    expect(found.some((c) => c.kind === 'start_warranty')).toBe(false);
  });
});

describe('the service decision', () => {
  const ending = contract({
    warranty: { months: 12, startsOn: day(2025, 11, 1), endsOn: day(2026, 11, 1), alertDays: 90 },
  });

  it('comes up inside the alert window, with both routes and no default', () => {
    // 15 Sep to 1 Nov is 47 days — inside the 90-day window.
    const found = findConsequences(input({ contracts: [ending] }));
    const decision = found.find((c) => c.kind === 'warranty_decision_due');
    expect(decision).toBeDefined();
    expect(decision!.severity).toBe('decision');
    // Never picked for them: this one is commercial, not mechanical.
    expect(decision!.action).toBeNull();
    expect(decision!.choices.map((c) => c.kind)).toEqual([
      'convert_to_service',
      'close_after_warranty',
    ]);
  });

  it('stays quiet while the warranty has a long way to run', () => {
    const found = findConsequences(
      input({
        contracts: [
          contract({ warranty: { months: 24, startsOn: day(2026, 9, 1), endsOn: day(2028, 9, 1), alertDays: 90 } }),
        ],
      }),
    );
    expect(found.some((c) => c.kind === 'warranty_decision_due')).toBe(false);
  });

  it('escalates once the warranty has run out undecided', () => {
    const found = findConsequences(
      input({
        contracts: [
          contract({ warranty: { months: 12, startsOn: day(2025, 1, 1), endsOn: day(2026, 1, 1), alertDays: 90 } }),
        ],
      }),
    );
    const lapsed = found.find((c) => c.kind === 'warranty_lapsed_undecided');
    expect(lapsed).toBeDefined();
    // The point that gets it acted on: unpaid work is being done right now.
    expect(lapsed!.detail).toContain('for nothing');
  });

  it('stops asking once a service agreement has taken over', () => {
    const found = findConsequences(
      input({ contracts: [contract({ ...ending, succeededByContractId: 'k2' })] }),
    );
    expect(found.some((c) => c.kind.startsWith('warranty'))).toBe(false);
  });

  it('stops asking once the client has declined', () => {
    const found = findConsequences(
      input({ contracts: [contract({ ...ending, serviceDeclined: true })] }),
    );
    expect(found.some((c) => c.kind.startsWith('warranty'))).toBe(false);
  });
});

describe('lifts', () => {
  it('spots one still under installation after its project handed over', () => {
    const found = findConsequences(
      input({
        projects: [project({ handoverSigned: true })],
        units: [
          {
            id: 'u1', tag: 'LIFT-01', siteName: 'Adera', clientId: 'c1',
            installedByProjectId: 'p1', maintenanceContractId: null, status: 'under_installation',
          },
        ],
      }),
    );
    const unit = found.find((c) => c.kind === 'unit_in_service');
    expect(unit?.action?.value).toBe('in_service');
  });
});

describe('clients', () => {
  it('spots one marked active with nothing live', () => {
    const found = findConsequences(
      input({ clients: [{ id: 'c1', name: 'Dormant Ltd', status: 'active' }] }),
    );
    const dormant = found.find((c) => c.kind === 'client_dormant');
    expect(dormant?.action?.value).toBe('inactive');
    // Deactivating must never read as losing the history.
    expect(dormant?.action?.effect).toContain('Every record stays');
  });

  it('spots a prospect who has actually signed', () => {
    const found = findConsequences(
      input({
        clients: [{ id: 'c1', name: 'Adera Hospital', status: 'prospect' }],
        contracts: [contract()],
      }),
    );
    expect(found.find((c) => c.kind === 'client_should_be_active')?.action?.value).toBe('active');
  });

  it('leaves an active client with a live contract alone', () => {
    const found = findConsequences(
      input({
        clients: [{ id: 'c1', name: 'Adera Hospital', status: 'active' }],
        contracts: [contract()],
      }),
    );
    expect(found.some((c) => c.kind.startsWith('client'))).toBe(false);
  });

  it('does not count a draft contract as live', () => {
    // A draft is not a commitment; a client with only drafts is a prospect.
    const found = findConsequences(
      input({
        clients: [{ id: 'c1', name: 'Maybe Ltd', status: 'active' }],
        contracts: [contract({ status: 'draft' })],
      }),
    );
    expect(found.some((c) => c.kind === 'client_dormant')).toBe(true);
  });
});

describe('ordering and counting', () => {
  it('puts the commercial decision above the tidying', () => {
    const found = findConsequences(
      input({
        clients: [{ id: 'c1', name: 'Dormant Ltd', status: 'active' }],
        contracts: [
          contract({
            id: 'k9',
            warranty: { months: 12, startsOn: day(2025, 11, 1), endsOn: day(2026, 11, 1), alertDays: 90 },
          }),
        ],
      }),
    );
    expect(found[0]?.severity).toBe('decision');
  });

  it('separates what can be applied in one click from what cannot', () => {
    const found = findConsequences(
      input({
        clients: [{ id: 'c1', name: 'Dormant Ltd', status: 'active' }],
        projects: [project({ progressBps: 10_000 })],
        contracts: [
          contract({
            warranty: { months: 12, startsOn: day(2025, 11, 1), endsOn: day(2026, 11, 1), alertDays: 90 },
          }),
        ],
      }),
    );
    const summary = summariseConsequences(found);
    expect(summary.decisions).toBe(1);
    expect(summary.oneClick).toBe(summary.total - 1);
  });

  it('finds nothing to say about an empty business', () => {
    expect(findConsequences(input())).toEqual([]);
  });
});

describe('the default warranty', () => {
  it('is a year, which is what these contracts usually carry', () => {
    expect(DEFAULT_WARRANTY_MONTHS).toBe(12);
  });
});
