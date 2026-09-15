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
  it('refuses a client that still has contracts', () => {
    const verdict = assessDeletion({
      kind: 'client',
      name: 'Adera Hospital',
      references: [
        { label: 'contracts', count: 2 },
        { label: 'projects', count: 4 },
      ],
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('2 contracts and 4 projects');
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
    expect(verdict.alternative).toContain('cancel');
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
