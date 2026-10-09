import { describe, expect, it } from 'vitest';
import { assessDeletion, listReferences } from '../deletion.js';

describe('listing references', () => {
  it('reads as a sentence, and singularises a count of one', () => {
    expect(listReferences([{ label: 'contracts', count: 1 }])).toBe('1 contract');
    expect(
      listReferences([
        { label: 'contracts', count: 3 },
        { label: 'projects', count: 1 },
      ]),
    ).toBe('3 contracts and 1 project');
    expect(
      listReferences([
        { label: 'lifts', count: 2 },
        { label: 'invoices', count: 4 },
        { label: 'projects', count: 1 },
      ]),
    ).toBe('2 lifts, 4 invoices and 1 project');
  });

  it('ignores anything with a count of zero', () => {
    expect(
      listReferences([
        { label: 'contracts', count: 0 },
        { label: 'projects', count: 2 },
      ]),
    ).toBe('2 projects');
  });
});

describe('records something else points at', () => {
  it('refuses a client that still has contracts, but lets it be forced', () => {
    const verdict = assessDeletion({
      kind: 'client',
      name: 'Adera Hospital',
      references: [
        { label: 'contracts', count: 2 },
        { label: 'projects', count: 4 },
      ],
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.forceable).toBe(true);
    expect(verdict.reason).toContain('2 contracts and 4 projects');
    expect(verdict.leftBehind.join(' ')).toMatch(/2 contracts — kept, still showing “Adera Hospital”/);
    expect(verdict.leftBehind.join(' ')).toMatch(/4 projects — kept/);
    // Deleting the client would not delete the contracts — it would blank the
    // name on them, which is worse than refusing.
    expect(verdict.alternative).toContain('inactive');
  });

  it('allows a client nothing points at', () => {
    const verdict = assessDeletion({
      kind: 'client',
      name: 'Typo Ltd',
      references: [
        { label: 'contracts', count: 0 },
        { label: 'projects', count: 0 },
      ],
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.alternative).toBeNull();
  });

  it('names what the delete takes with it', () => {
    const verdict = assessDeletion({
      kind: 'contract',
      name: 'AGR-2021-001',
      references: [{ label: 'projects', count: 0 }],
      cascade: [{ label: 'payment terms', count: 4 }],
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.cascade).toEqual(['4 payment terms']);
  });

  it('suggests cancelling rather than deactivating for a contract', () => {
    const verdict = assessDeletion({
      kind: 'contract',
      name: 'AGR-2021-001',
      references: [{ label: 'issued invoices', count: 1 }],
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.alternative).toMatch(/cancel/i);
  });
});

describe('invoices', () => {
  it('refuses to delete one that has been issued', () => {
    // The number is part of the VAT sequence. A gap in it cannot be explained
    // in an audit, and "the system allowed it" is not a defence.
    const verdict = assessDeletion({ kind: 'invoice', name: 'INV-0047', status: 'issued' });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('VAT sequence');
    expect(verdict.alternative).toContain('Void');
  });

  it('refuses a paid one too', () => {
    expect(assessDeletion({ kind: 'invoice', name: 'INV-0047', status: 'paid' }).allowed).toBe(
      false,
    );
  });

  it('allows a draft, which never had a number that mattered', () => {
    const verdict = assessDeletion({ kind: 'invoice', name: 'Draft invoice', status: 'draft' });
    expect(verdict.allowed).toBe(true);
  });

  it('refuses an approved payment voucher, pointing at the withholding record', () => {
    const verdict = assessDeletion({
      kind: 'disbursement',
      name: 'PV-0012',
      status: 'approved',
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('withholding');
  });

  it('treats a missing status as not a draft', () => {
    // An absent status must never read as permission; the safe reading is that
    // this is a real document.
    expect(assessDeletion({ kind: 'invoice', name: 'INV-1' }).allowed).toBe(false);
  });
});

describe('programs', () => {
  it('always allows deletion, because a program only groups things', () => {
    const verdict = assessDeletion({
      kind: 'program',
      name: 'Adera Hospital',
      cascade: [{ label: 'projects released', count: 4 }],
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.cascade).toEqual(['4 projects released']);
  });
});

describe('technicians', () => {
  it('never allows deletion, and says what to do instead', () => {
    // Their KPI history is the basis on which they were paid a bonus, so it
    // has to survive them leaving. The security rules refuse it too.
    const verdict = assessDeletion({ kind: 'technician', name: 'Fasika' });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('KPI history');
    expect(verdict.alternative).toContain('inactive');
  });

  it('refuses even when nothing points at them yet', () => {
    // A technician entered this morning with no callouts is still refused: the
    // rule is about what the record is for, not how much it has accumulated.
    const verdict = assessDeletion({
      kind: 'technician',
      name: 'New Starter',
      references: [{ label: 'callouts', count: 0 }],
    });
    expect(verdict.allowed).toBe(false);
  });
});


describe('deleting over a warning', () => {
  it('may be forced for a contract, naming what happens to each thing tied to it', () => {
    const v = assessDeletion({
      kind: 'contract',
      name: 'C-1',
      references: [
        { label: 'projects', count: 2 },
        { label: 'invoices', count: 1 },
        { label: 'lifts', count: 3 },
        { label: 'callouts', count: 4 },
      ],
      cascade: [{ label: 'payment terms', count: 4 }],
    });
    expect(v.allowed).toBe(false);
    expect(v.forceable).toBe(true);
    expect(v.cascade).toEqual(['4 payment terms']);
    const text = v.leftBehind.join('\n');
    expect(text).toMatch(/2 projects — unlinked from the contract/);
    expect(text).toMatch(/1 invoice — kept but unlinked.*VAT numbering stays whole/);
    expect(text).toMatch(/3 lifts — no longer under a maintenance contract/);
    expect(text).toMatch(/4 callouts — kept as history/);
  });

  it('may be forced for a project, which leaves vouchers where they are', () => {
    const v = assessDeletion({
      kind: 'project',
      name: 'PRJ-1',
      references: [
        { label: 'payment vouchers', count: 1 },
        { label: 'sub-projects', count: 2 },
        { label: 'lifts', count: 1 },
      ],
    });
    expect(v.forceable).toBe(true);
    const text = v.leftBehind.join('\n');
    expect(text).toMatch(/1 payment voucher — kept.*withholding record/);
    expect(text).toMatch(/2 sub-projects — become stand-alone/);
    expect(text).toMatch(/1 lift — no longer name a project/);
  });

  it('may be forced for a lift that has service history', () => {
    const v = assessDeletion({ kind: 'unit', name: 'LIFT-01', references: [{ label: 'callouts', count: 3 }] });
    expect(v.forceable).toBe(true);
    expect(v.leftBehind[0]).toMatch(/3 callouts — kept as the history/);
  });

  it('is not an option when nothing is in the way', () => {
    const v = assessDeletion({ kind: 'contract', name: 'C-1', references: [{ label: 'projects', count: 0 }] });
    expect(v.allowed).toBe(true);
    expect(v.forceable).toBe(false);
    expect(v.leftBehind).toEqual([]);
  });

  it('never applies to an issued invoice, an approved voucher or a technician', () => {
    expect(assessDeletion({ kind: 'invoice', name: 'INV-1', status: 'issued' }).forceable).toBe(false);
    expect(assessDeletion({ kind: 'disbursement', name: 'PV-1', status: 'approved' }).forceable).toBe(false);
    expect(assessDeletion({ kind: 'technician', name: 'Abel' }).forceable).toBe(false);
  });

  it('is not extended to a subcontractor', () => {
    const v = assessDeletion({ kind: 'subcontractor', name: 'Sub', references: [{ label: 'payment vouchers', count: 2 }] });
    expect(v.allowed).toBe(false);
    expect(v.forceable).toBe(false);
  });
});
