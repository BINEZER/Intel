import { describe, expect, it } from 'vitest';
import { collectAchievements, type AchievementInputs } from '../achievements.js';
import { periodContaining } from '../period.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
/** September 2026, Gregorian. */
const SEPT = periodContaining('month', 'gregorian', utc(2026, 9, 15));
const inside = utc(2026, 9, 10);
const outside = utc(2026, 7, 10);

const base = (over: Partial<AchievementInputs> = {}): AchievementInputs => ({
  period: SEPT,
  contracts: [],
  projects: [],
  stages: [],
  invoices: [],
  tasks: [],
  ...over,
});

const contract = (over = {}) => ({
  contractNo: 'AGR-2026-001',
  clientName: 'Addis Towers PLC',
  title: 'Bole Tower — four lifts',
  signedDate: inside,
  valueGrossSantim: 11_500_000_00,
  ...over,
});

const project = (over = {}) => ({
  projectNo: 'PRJ-2026-001',
  title: 'Bole Tower · LIFT-01',
  clientName: 'Addis Towers PLC',
  status: 'completed',
  actualEnd: inside,
  contractNetSantim: 4_000_000_00,
  ...over,
});

const stage = (over = {}) => ({
  stageName: 'Testing & adjustment',
  projectTitle: 'Bole Tower · LIFT-01',
  clientName: 'Addis Towers PLC',
  status: 'completed',
  actualEnd: inside,
  ...over,
});

const invoice = (over = {}) => ({
  invoiceNo: 'INV-2026-0001',
  clientName: 'Addis Towers PLC',
  status: 'issued',
  issuedAt: inside,
  grossSantim: 1_150_000_00,
  receipts: [] as { receivedAt: Date; amountGrossSantim: number }[],
  ...over,
});

const task = (over = {}) => ({ title: 'Chase the Ministry certificate', completedAt: inside, archived: false, ...over });

describe('what counts as an achievement', () => {
  it('counts a contract signed inside the period', () => {
    const r = collectAchievements(base({ contracts: [contract()] }));
    expect(r.wonSantim).toBe(11_500_000_00);
    expect(r.groups.find((g) => g.key === 'contract_won')?.items[0]?.headline)
      .toContain('Signed AGR-2026-001');
  });

  it('ignores anything dated outside the period', () => {
    const r = collectAchievements(
      base({
        contracts: [contract({ signedDate: outside })],
        projects: [project({ actualEnd: outside })],
        stages: [stage({ actualEnd: outside })],
        tasks: [task({ completedAt: outside })],
      }),
    );
    expect(r.count).toBe(0);
    expect(r.groups).toEqual([]);
  });

  it('counts a job only once it is actually handed over', () => {
    // A project still in progress is work, not an achievement — however far
    // along it is. The completion date is the claim.
    expect(collectAchievements(base({ projects: [project({ status: 'in_progress' })] })).projectsDelivered).toBe(0);
    expect(collectAchievements(base({ projects: [project({ status: 'handed_over' })] })).projectsDelivered).toBe(1);
  });

  it('never counts a job with no completion date, whatever its status says', () => {
    // A status can be set at any time; a date is the fact.
    expect(collectAchievements(base({ projects: [project({ actualEnd: null })] })).projectsDelivered).toBe(0);
  });

  it('counts only stages that actually closed', () => {
    const r = collectAchievements(base({ stages: [stage(), stage({ status: 'in_progress' })] }));
    expect(r.stagesClosed).toBe(1);
  });

  it('leaves out a task that was archived', () => {
    expect(collectAchievements(base({ tasks: [task({ archived: true })] })).tasksDone).toBe(0);
  });
});

describe('money', () => {
  it('counts cash at the receipt, not at the invoice', () => {
    // Billing and being paid are two achievements on two different days.
    const r = collectAchievements(
      base({
        invoices: [
          invoice({
            issuedAt: outside,
            receipts: [{ receivedAt: inside, amountGrossSantim: 400_000_00 }],
          }),
        ],
      }),
    );
    expect(r.collectedSantim).toBe(400_000_00);
    expect(r.invoicedSantim).toBe(0);
  });

  it('counts both when an invoice is raised and paid in the same period', () => {
    const r = collectAchievements(
      base({ invoices: [invoice({ receipts: [{ receivedAt: inside, amountGrossSantim: 1_150_000_00 }] })] }),
    );
    expect(r.invoicedSantim).toBe(1_150_000_00);
    expect(r.collectedSantim).toBe(1_150_000_00);
  });

  it('ignores a draft or void invoice entirely', () => {
    const r = collectAchievements(
      base({
        invoices: [
          invoice({ status: 'draft', receipts: [{ receivedAt: inside, amountGrossSantim: 5_00 }] }),
          invoice({ status: 'void', invoiceNo: 'INV-X' }),
        ],
      }),
    );
    expect(r.invoicedSantim).toBe(0);
    expect(r.collectedSantim).toBe(0);
  });

  it('lists a receipt separately from the invoice it settles', () => {
    const r = collectAchievements(
      base({ invoices: [invoice({ receipts: [{ receivedAt: inside, amountGrossSantim: 400_000_00 }] })] }),
    );
    expect(r.groups.map((g) => g.key)).toContain('cash_collected');
    expect(r.groups.map((g) => g.key)).toContain('invoice_raised');
  });
});

describe('how it reads', () => {
  it('puts the biggest money item first inside a group', () => {
    const r = collectAchievements(
      base({
        contracts: [
          contract({ contractNo: 'SMALL', valueGrossSantim: 1_000_00 }),
          contract({ contractNo: 'BIG', valueGrossSantim: 90_000_00 }),
        ],
      }),
    );
    expect(r.groups[0]?.items[0]?.headline).toContain('BIG');
  });

  it('puts the newest first where there is no money to rank by', () => {
    const r = collectAchievements(
      base({
        stages: [
          stage({ stageName: 'Older', actualEnd: utc(2026, 9, 2) }),
          stage({ stageName: 'Newer', actualEnd: utc(2026, 9, 20) }),
        ],
      }),
    );
    expect(r.groups[0]?.items[0]?.headline).toContain('Newer');
  });

  it('opens by naming what was done, not by naming what was not', () => {
    const r = collectAchievements(
      base({ contracts: [contract()], projects: [project()], stages: [stage()] }),
    );
    const said = r.opening.join(' ');
    expect(said).toContain('won ETB');
    expect(said).toContain('handed over 1 job');
    // Never "0 contracts signed" — a clause with nothing behind it is left out.
    expect(said).not.toMatch(/\b0 (contract|job|stage|task|payment|invoice)/);
  });

  it('joins the opening clauses with "and", never as a bare comma list', () => {
    const r = collectAchievements(base({ contracts: [contract()], projects: [project()] }));
    expect(r.opening[0]).toMatch(/ and /);
  });

  it('says plainly when nothing finished, rather than inventing a positive', () => {
    // A brag list that always finds something to brag about is one nobody
    // believes twice.
    const r = collectAchievements(base());
    expect(r.count).toBe(0);
    expect(r.opening[0]).toContain('Nothing was recorded as finished');
    expect(r.opening.join(' ')).toContain('records have not caught up');
  });

  it('notes billed-but-not-collected rather than letting it read as cash', () => {
    const r = collectAchievements(base({ invoices: [invoice()] }));
    expect(r.opening.join(' ')).toContain('none of it had been received');
  });

  it('drops a group entirely when it has nothing in it', () => {
    const r = collectAchievements(base({ tasks: [task()] }));
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]?.key).toBe('task_done');
  });

  it('summarises each group with its own number', () => {
    const r = collectAchievements(base({ contracts: [contract(), contract({ contractNo: 'B' })] }));
    expect(r.groups[0]?.summary).toContain('2 new contracts');
    expect(r.groups[0]?.summary).toContain('ETB');
  });
});
