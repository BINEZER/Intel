/**
 * What may be deleted, and what must not be.
 *
 * A bulk import guarantees wrong entries, so deleting has to be possible. But
 * "possible" is not "unconditional", and the two rules below are the whole
 * policy:
 *
 *   1. NOTHING IS DELETED OUT FROM UNDER SOMETHING THAT POINTS AT IT.
 *      Deleting a client that has three contracts does not remove the
 *      contracts; it removes the name from them, and every page that joins on
 *      it starts showing a blank where a client used to be. The record is
 *      refused and the references are named, so the fix is obvious: delete
 *      those first, or keep this one.
 *
 *   2. AN ISSUED INVOICE IS NEVER DELETED.
 *      Invoice numbers come from a sequential counter because ERCA expects the
 *      sequence to be complete and explicable. Deleting number 47 leaves a hole
 *      that cannot be explained later, and "the system let me" is not a defence
 *      in an audit. Issued invoices are VOIDED — the number survives, marked as
 *      cancelled. Only a draft, which never had a number that mattered, can be
 *      deleted outright.
 *
 * Everything here is a pure decision over counts. The counting happens in the
 * data layer; the judgement happens here, where it can be tested.
 */

export type DeletableKind =
  | 'client'
  | 'technician'
  | 'contract'
  | 'project'
  | 'program'
  | 'unit'
  | 'subcontractor'
  | 'invoice'
  | 'disbursement';

/** Something that points at the record, and how many of them there are. */
export interface Reference {
  /** Plural noun as a person would say it: "contracts", "issued invoices". */
  label: string;
  count: number;
}

export interface DeletionVerdict {
  allowed: boolean;
  /**
   * One sentence. When allowed, what is about to happen; when refused, why.
   * Written to be read by somebody who is about to click, not by a developer.
   */
  reason: string;
  /** Anything the delete takes with it, named before it happens. */
  cascade: string[];
  /** What to do instead. Null when the delete is allowed. */
  alternative: string | null;
  /**
   * True when the delete is refused ONLY because other records point at it, and
   * the person may go ahead anyway. The reason is then a warning, not a wall.
   * Never true for an issued invoice, an approved voucher or a technician: those
   * are refused because of what they are, not because of what points at them.
   */
  forceable: boolean;
  /**
   * What deleting it anyway will do to the records that point at it, one
   * sentence each. Empty unless `forceable`.
   */
  leftBehind: string[];
}

const LABEL: Record<DeletableKind, string> = {
  client: 'client',
  technician: 'technician',
  contract: 'contract',
  project: 'project',
  program: 'program',
  unit: 'lift',
  subcontractor: 'subcontractor',
  invoice: 'invoice',
  disbursement: 'payment voucher',
};

/** "3 contracts and 1 project", "2 lifts, 4 invoices and 1 project". */
export function listReferences(refs: readonly Reference[]): string {
  const parts = refs
    .filter((r) => r.count > 0)
    .map((r) => `${r.count} ${r.count === 1 ? singular(r.label) : r.label}`);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] as string}`;
}

/** Crude but sufficient: every label here is a regular plural. */
function singular(label: string): string {
  return label.endsWith('ies')
    ? `${label.slice(0, -3)}y`
    : label.endsWith('s')
      ? label.slice(0, -1)
      : label;
}

export interface AssessInput {
  kind: DeletableKind;
  /** The record's name, for the sentence. */
  name: string;
  /** Records pointing at this one. Zero-count entries are ignored. */
  references?: readonly Reference[];
  /** Current status, where the kind's policy depends on it. */
  status?: string;
  /** Things inside the record that go with it: payment terms, stages. */
  cascade?: readonly Reference[];
}

export function assessDeletion(input: AssessInput): DeletionVerdict {
  const { kind, name } = input;
  const blocking = (input.references ?? []).filter((r) => r.count > 0);
  const noun = LABEL[kind];

  // --- a technician is never deleted --------------------------------------

  if (kind === 'technician') {
    // Their KPI history, incentive payouts and the callouts they closed are
    // all recorded against them. Deleting the person leaves the record of
    // their work pointing at nobody — and that record is the basis on which
    // they were paid a bonus, so it has to survive them leaving.
    return {
      allowed: false,
      reason: `${name} cannot be deleted: the KPI history, incentive payouts and closed callouts recorded against them would be left pointing at nobody.`,
      cascade: [],
      alternative:
        'Set them to inactive instead. They drop out of the assignment lists and the roster, and everything they did stays attributable.',
      forceable: false,
      leftBehind: [],
    };
  }

  // --- money documents: the sequence matters more than the tidiness --------

  if (kind === 'invoice' || kind === 'disbursement') {
    if (input.status !== 'draft') {
      return {
        allowed: false,
        reason:
          kind === 'invoice'
            ? `${name} has been issued, so it cannot be deleted — its number is part of the VAT sequence and a gap in that sequence cannot be explained to ERCA later.`
            : `${name} has been approved, so it cannot be deleted — it is part of the withholding record for its period.`,
        cascade: [],
        alternative:
          kind === 'invoice'
            ? 'Void it instead. The number stays on file, marked cancelled, and the sequence stays whole.'
            : 'Put it on hold or cancel it instead, so the withholding record stays complete.',
        forceable: false,
        leftBehind: [],
      };
    }
    return {
      allowed: true,
      reason: `${name} is still a draft, so deleting it leaves no gap in the numbering.`,
      cascade: describeCascade(input.cascade),
      alternative: null,
      forceable: false,
      leftBehind: [],
    };
  }

  // --- a program is a grouping, so deleting it ungroups rather than deletes -

  if (kind === 'program') {
    return {
      allowed: true,
      reason: `Deletes the program ${name}.`,
      cascade: describeCascade(input.cascade),
      alternative: null,
      forceable: false,
      leftBehind: [],
    };
  }

  // --- everything else: refuse while something still points at it ----------

  if (blocking.length > 0) {
    const forceable = FORCEABLE.has(kind);
    return {
      allowed: false,
      reason: forceable
        ? `${name} still has ${listReferences(blocking)} tied to it.`
        : `${name} still has ${listReferences(blocking)} attached, and deleting it would leave them pointing at a ${noun} that no longer exists.`,
      cascade: forceable ? describeCascade(input.cascade) : [],
      alternative:
        kind === 'client' || kind === 'subcontractor'
          ? `Set this ${noun} to inactive to take it out of the lists while keeping the history${forceable ? ', or delete it anyway' : ''}.`
          : `Cancel this ${noun} instead of removing it${forceable ? ', or delete it anyway' : ''}.`,
      forceable,
      leftBehind: forceable ? leftBehindBy(kind, name, blocking) : [],
    };
  }

  return {
    allowed: true,
    reason: `Nothing else points at ${name}, so it can be removed.`,
    cascade: describeCascade(input.cascade),
    alternative: null,
    forceable: false,
    leftBehind: [],
  };
}

/**
 * The kinds that may be deleted over a warning.
 *
 * What makes these safe to force is that what points at them can be left
 * standing without being wrong: it is unlinked, or it keeps the name it
 * already carries. An issued invoice and an approved voucher are not in this
 * list because deleting THEM is the harm, however nothing points at them.
 */
const FORCEABLE: ReadonlySet<DeletableKind> = new Set(['client', 'contract', 'project', 'unit']);

/**
 * What happens to each thing that points at the record, in plain words.
 *
 * Nothing that points at the record is deleted with it. Deleting a client does
 * not delete its contracts, and deleting a contract does not delete its
 * invoices — those carry their own meaning, and an issued invoice's number is
 * never removed this way. They are unlinked where the link can be empty, and
 * left carrying the name they already hold where it cannot.
 */
function leftBehindBy(kind: DeletableKind, name: string, refs: readonly Reference[]): string[] {
  const out: string[] = [];
  for (const ref of refs) {
    const what = `${ref.count} ${ref.count === 1 ? singular(ref.label) : ref.label}`;
    switch (`${kind}:${ref.label}`) {
      case 'client:contracts':
      case 'client:projects':
      case 'client:invoices':
      case 'client:lifts':
        out.push(`${what} — kept, still showing “${name}” as the client but no longer linked to a client record. Open each and choose another client to re-link it.`);
        break;
      case 'contract:projects':
        out.push(`${what} — unlinked from the contract; they carry on as stand-alone projects.`);
        break;
      case 'contract:invoices':
      case 'project:invoices':
        out.push(`${what} — kept but unlinked. An invoice is never deleted along with something else, so the VAT numbering stays whole.`);
        break;
      case 'contract:lifts':
        out.push(`${what} — no longer under a maintenance contract.`);
        break;
      case 'contract:callouts':
      case 'contract:maintenance visits':
        out.push(`${what} — kept as history, still naming a contract that no longer exists.`);
        break;
      case 'project:payment vouchers':
        out.push(`${what} — kept, still naming a project that no longer exists. They are part of the withholding record.`);
        break;
      case 'project:sub-projects':
        out.push(`${what} — become stand-alone projects.`);
        break;
      case 'project:lifts':
        out.push(`${what} — no longer name a project as the one that installed them.`);
        break;
      case 'unit:callouts':
      case 'unit:maintenance visits':
        out.push(`${what} — kept as the history of this lift's tag, but the lift itself will no longer be on the register.`);
        break;
      default:
        out.push(`${what} — left pointing at nothing.`);
    }
  }
  return out;
}

function describeCascade(cascade: readonly Reference[] | undefined): string[] {
  return (cascade ?? [])
    .filter((c) => c.count > 0)
    .map((c) => `${c.count} ${c.count === 1 ? singular(c.label) : c.label}`);
}
