import { describe, expect, it } from 'vitest';
import {
  UNTRACKED_KEY,
  buildBoard,
  buildToday,
  describeToday,
  summariseToday,
  type BoardProject,
  type TodayInputs,
} from '../today.js';

const AS_OF = new Date(Date.UTC(2026, 8, 16));
const days = (n: number) => new Date(AS_OF.getTime() + n * 86_400_000);

function input(over: Partial<TodayInputs> = {}): TodayInputs {
  return {
    asOf: AS_OF,
    invoices: [],
    stages: [],
    contracts: [],
    units: [],
    vouchers: [],
    decisions: [],
    ...over,
  };
}

const invoice = (over = {}) => ({
  id: 'i1',
  invoiceNo: 'INV-0042',
  clientName: 'Adera Hospital',
  dueDate: days(-5),
  balanceGrossSantim: 250_000_00,
  status: 'overdue',
  ...over,
});

const stage = (over = {}) => ({
  projectId: 'p1',
  projectTitle: 'Bole Tower LIFT-01',
  stageName: 'Guide rails & brackets',
  plannedEnd: days(-2),
  nextCheckpoint: 'Rails plumbed and aligned to tolerance',
  done: false,
  projectStatus: 'in_progress',
  ...over,
});

describe('money owed to us', () => {
  it('raises an overdue invoice with the amount and how late it is', () => {
    const tasks = buildToday(input({ invoices: [invoice()] }));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ kind: 'collect', urgency: 'overdue' });
    expect(tasks[0]!.action).toContain('5 days overdue');
    expect(tasks[0]!.figure).toContain('250,000');
  });

  it('ignores one that is settled, a draft, or void', () => {
    expect(buildToday(input({ invoices: [invoice({ balanceGrossSantim: 0 })] }))).toHaveLength(0);
    expect(buildToday(input({ invoices: [invoice({ status: 'draft' })] }))).toHaveLength(0);
    expect(buildToday(input({ invoices: [invoice({ status: 'void' })] }))).toHaveLength(0);
  });

  it('ignores one that is not due for months', () => {
    // A list that shows everything gets read once.
    expect(buildToday(input({ invoices: [invoice({ dueDate: days(90) })] }))).toHaveLength(0);
  });

  it('says call today when it falls due today', () => {
    const tasks = buildToday(input({ invoices: [invoice({ dueDate: days(0) })] }));
    expect(tasks[0]!.urgency).toBe('today');
    expect(tasks[0]!.action).toContain('today');
  });
});

describe('work that should have happened', () => {
  it('names the next checkpoint rather than saying the stage is late', () => {
    // "The stage is late" is a description. "Rails plumbed and aligned" is
    // something somebody can go and do.
    const tasks = buildToday(input({ stages: [stage()] }));
    expect(tasks[0]!.action).toBe('Rails plumbed and aligned to tolerance');
    expect(tasks[0]!.kind).toBe('stage_overdue');
  });

  it('falls back to closing it out when every checkpoint is ticked', () => {
    const tasks = buildToday(input({ stages: [stage({ nextCheckpoint: null })] }));
    expect(tasks[0]!.action).toContain('close it out');
  });

  it('says nothing about a stage on a project that is over', () => {
    expect(buildToday(input({ stages: [stage({ projectStatus: 'completed' })] }))).toHaveLength(0);
    expect(buildToday(input({ stages: [stage({ projectStatus: 'terminated' })] }))).toHaveLength(0);
  });

  it('says nothing about a stage already done', () => {
    expect(buildToday(input({ stages: [stage({ done: true })] }))).toHaveLength(0);
  });
});

describe('contracts and certificates', () => {
  it('raises a contract inside the horizon', () => {
    const tasks = buildToday(
      input({
        contracts: [
          {
            id: 'k1', contractNo: 'AGR-2024-001', clientName: 'Ayat',
            endDate: days(7), status: 'active', renewalStatus: 'not_due',
          },
        ],
      }),
    );
    expect(tasks[0]!.action).toContain('extension letter');
  });

  it('stays quiet once somebody is already on it', () => {
    // Repeating it daily is how a person learns to scroll past the whole list.
    for (const renewalStatus of ['renewed', 'in_negotiation']) {
      const tasks = buildToday(
        input({
          contracts: [
            {
              id: 'k1', contractNo: 'AGR-2024-001', clientName: 'Ayat',
              endDate: days(7), status: 'active', renewalStatus,
            },
          ],
        }),
      );
      expect(tasks).toHaveLength(0);
    }
  });

  it('says plainly that an expired certificate means an uncertified lift', () => {
    const tasks = buildToday(
      input({
        units: [
          { id: 'u1', tag: 'LIFT-01', siteName: 'Sheger Mall', certificateExpiresOn: days(-3) },
        ],
      }),
    );
    expect(tasks[0]!.action).toContain('uncertified');
  });

  it('ignores a lift with no certificate date recorded', () => {
    expect(
      buildToday(input({ units: [{ id: 'u1', tag: 'L1', siteName: 'S', certificateExpiresOn: null }] })),
    ).toHaveLength(0);
  });
});

describe('money waiting on us', () => {
  it('raises a voucher somebody has to approve, and says who it hurts', () => {
    const tasks = buildToday(
      input({
        vouchers: [
          {
            id: 'v1', voucherNo: 'PV-0007', subcontractorName: 'Merkebu',
            netPayableSantim: 204_000_00, status: 'requested',
          },
        ],
      }),
    );
    expect(tasks[0]!.action).toContain('crew is not being paid');
    expect(tasks[0]!.figure).toContain('204,000');
  });

  it('ignores one already approved or paid', () => {
    for (const status of ['approved', 'paid', 'draft']) {
      expect(
        buildToday(
          input({
            vouchers: [
              { id: 'v1', voucherNo: 'PV', subcontractorName: 'X', netPayableSantim: 1, status },
            ],
          }),
        ),
      ).toHaveLength(0);
    }
  });
});

describe('ordering', () => {
  it('puts overdue first, and the longest-waiting at the top of those', () => {
    const tasks = buildToday(
      input({
        invoices: [
          invoice({ id: 'a', invoiceNo: 'A', dueDate: days(-1) }),
          invoice({ id: 'b', invoiceNo: 'B', dueDate: days(-30) }),
          invoice({ id: 'c', invoiceNo: 'C', dueDate: days(5), status: 'issued' }),
        ],
      }),
    );
    expect(tasks.map((t) => t.subject.slice(0, 1))).toEqual(['B', 'A', 'C']);
  });
});

describe('the summary line', () => {
  it('leads with what is overdue and names where to start', () => {
    const tasks = buildToday(input({ invoices: [invoice()] }));
    expect(describeToday(tasks)).toContain('1 already overdue');
    expect(describeToday(tasks)).toContain('INV-0042');
  });

  it('says so plainly when there is nothing to do', () => {
    expect(describeToday([])).toContain('Nothing is overdue');
    expect(summariseToday([])).toEqual({ total: 0, overdue: 0, today: 0, money: 0 });
  });

  it('counts each kind of pressure separately', () => {
    const tasks = buildToday(
      input({
        invoices: [invoice(), invoice({ id: 'i2', invoiceNo: 'B', dueDate: days(3), status: 'issued' })],
        stages: [stage()],
      }),
    );
    const summary = summariseToday(tasks);
    expect(summary).toMatchObject({ total: 3, overdue: 2, money: 2 });
  });
});

// ---------------------------------------------------------------------------

const STAGES = [
  { key: 'manufacturing', label: 'Order & manufacturing' },
  { key: 'shipping_customs', label: 'Shipping & customs clearance' },
  { key: 'rail_installation', label: 'Guide rails & brackets' },
];

const job = (over: Partial<BoardProject> = {}): BoardProject => ({
  id: 'p1',
  projectNo: 'PRJ-1',
  title: 'Bole Tower',
  clientName: 'Bole',
  progressBps: 3000,
  plannedEnd: days(10),
  status: 'in_progress',
  inDanger: false,
  currentStage: 'Guide rails & brackets',
  ...over,
});

describe('the job board', () => {
  it('puts each job under the stage it is at', () => {
    const board = buildBoard([job()], STAGES, AS_OF);
    expect(board.find((c) => c.key === 'rail_installation')!.projects).toHaveLength(1);
  });

  it('keeps empty columns, because a gap in the pipeline is the message', () => {
    // Nothing in shipping for two months is a supply problem arriving in six
    // weeks. A board that hides empty columns hides exactly that.
    const board = buildBoard([job()], STAGES, AS_OF);
    expect(board).toHaveLength(3);
    expect(board.find((c) => c.key === 'shipping_customs')!.projects).toEqual([]);
  });

  it('counts what is past its date in each column', () => {
    const board = buildBoard(
      [job({ id: 'a', plannedEnd: days(-4) }), job({ id: 'b', plannedEnd: days(4) })],
      STAGES,
      AS_OF,
    );
    expect(board.find((c) => c.key === 'rail_installation')!.overdue).toBe(1);
  });

  it('puts the job in trouble at the top of its column', () => {
    const board = buildBoard(
      [
        job({ id: 'ok', plannedEnd: days(1) }),
        job({ id: 'bad', plannedEnd: days(20), inDanger: true }),
      ],
      STAGES,
      AS_OF,
    );
    expect(board.find((c) => c.key === 'rail_installation')!.projects[0]!.id).toBe('bad');
  });

  it('holds a job whose stage nobody has set rather than dropping it', () => {
    // Every imported job arrives without a stage. A board that silently omits a
    // hundred and sixty live jobs is worse than one that says it cannot place
    // them.
    const board = buildBoard([job({ currentStage: null })], STAGES, AS_OF);
    const first = board[0]!;
    expect(first.key).toBe(UNTRACKED_KEY);
    expect(first.untracked).toBe(true);
    expect(first.projects).toHaveLength(1);
    expect(board).toHaveLength(STAGES.length + 1);
  });

  it('adds no such column when every job has a stage', () => {
    const board = buildBoard([job()], STAGES, AS_OF);
    expect(board.some((c) => c.key === UNTRACKED_KEY)).toBe(false);
  });

  it('counts a late job in that column too', () => {
    const board = buildBoard([job({ currentStage: null, plannedEnd: days(-3) })], STAGES, AS_OF);
    expect(board[0]!.overdue).toBe(1);
  });

  it('leaves finished and cancelled jobs off the board entirely', () => {
    const board = buildBoard(
      [job({ status: 'completed' }), job({ id: 'x', status: 'cancelled', currentStage: null })],
      STAGES,
      AS_OF,
    );
    expect(board.every((c) => c.projects.length === 0)).toBe(true);
    expect(board.some((c) => c.key === UNTRACKED_KEY)).toBe(false);
  });
});
