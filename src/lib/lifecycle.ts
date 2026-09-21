/**
 * What follows from a change, and who decides.
 *
 * THE PROBLEM
 *   A lift is installed, handed over, sits in warranty for a year or two, and
 *   then either becomes a paying maintenance customer or stops being ours. Four
 *   records have to agree about where in that story we are — the client, the
 *   contract, the project and the lift itself — and until now each one carried
 *   a status somebody set by hand. They drift apart within a month. A contract
 *   still says "active" two years after the last lift was handed over; a client
 *   is "active" with nothing live; a lift says "under installation" while its
 *   project says completed.
 *
 * WHY NOT CASCADE AUTOMATICALLY
 *   Because a status is sometimes deliberately out of step. A contract is kept
 *   active through a dispute. A client stays active because a second job is
 *   about to sign. Software that "helpfully" rewrites those is software people
 *   start working around, and then the statuses mean even less.
 *
 * WHAT THIS DOES INSTEAD
 *   It compares what IS against what SHOULD BE and reports the disagreements,
 *   each with the fix attached. Nothing changes behind anybody's back; the list
 *   persists until somebody either applies the fix or the situation changes, so
 *   nothing is forgotten either. That is the difference between a nag and a
 *   worklist.
 *
 * THE ONE THAT IS NOT MECHANICAL
 *   Warranty running out is a commercial decision, not a tidy-up: either the
 *   client signs a monthly maintenance agreement, or they decline and the
 *   relationship ends there. The engine raises it early and names both routes;
 *   it never picks one.
 */

import { daysBetween } from './kpi.js';
import { isClosedContract, isClosedProject } from './status.js';

export type ConsequenceKind =
  | 'start_warranty'
  | 'warranty_decision_due'
  | 'warranty_lapsed_undecided'
  | 'project_complete'
  | 'contract_complete'
  | 'contract_expired'
  | 'client_dormant'
  | 'client_should_be_active'
  | 'unit_in_service'
  | 'unit_uncovered';

export type ConsequenceSeverity = 'decision' | 'high' | 'medium' | 'low';

/**
 * One disagreement, with what to do about it.
 *
 * `action` is mechanical and safe to apply in one click. A consequence whose
 * `action` is null needs a person to choose between routes — see `choices`.
 */
export interface Consequence {
  id: string;
  kind: ConsequenceKind;
  severity: ConsequenceSeverity;
  /** What this is about, as a person would name it. */
  subject: string;
  /** Why the records disagree, with the fact that settles it. */
  detail: string;
  /** Where to go and look. */
  href: string;
  /** The single mechanical fix, where there is one. */
  action: ConsequenceAction | null;
  /** Mutually exclusive routes, where a person has to decide. */
  choices: ConsequenceAction[];
}

export interface ConsequenceAction {
  /** The button. */
  label: string;
  /** What it will change, spelled out before it happens. */
  effect: string;
  kind:
    | 'set_project_status'
    | 'set_contract_status'
    | 'set_client_status'
    | 'set_unit_status'
    | 'start_warranty'
    | 'convert_to_service'
    | 'close_after_warranty';
  targetId: string;
  value?: string;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface LifecycleClient {
  id: string;
  name: string;
  status: string;
}

export interface LifecycleContract {
  id: string;
  contractNo: string;
  clientId: string;
  clientName: string;
  type: string;
  status: string;
  endDate: Date;
  /** Null where the contract has no warranty term recorded. */
  warranty: {
    months: number;
    startsOn: Date | null;
    endsOn: Date | null;
    alertDays: number;
  } | null;
  /** Set once this contract has been replaced by a service agreement. */
  succeededByContractId: string | null;
  /** Set where somebody recorded that the client declined to take service on. */
  serviceDeclined: boolean;
}

export interface LifecycleProject {
  id: string;
  projectNo: string;
  title: string;
  clientId: string;
  contractId: string | null;
  status: string;
  progressBps: number;
  /** True once the handover acceptance checkpoint is signed. */
  handoverSigned: boolean;
}

export interface LifecycleUnit {
  id: string;
  tag: string;
  siteName: string;
  clientId: string;
  installedByProjectId: string | null;
  maintenanceContractId: string | null;
  status: string;
}

export interface LifecycleInput {
  clients: readonly LifecycleClient[];
  contracts: readonly LifecycleContract[];
  projects: readonly LifecycleProject[];
  units: readonly LifecycleUnit[];
  asOf: Date;
}

// ---------------------------------------------------------------------------
// Warranty dates
// ---------------------------------------------------------------------------

/** Warranty ends this many months after it starts. Whole months, same day. */
/**
 * Add whole months in UTC, clamping a day the target month does not have.
 *
 * 31 August plus six months is 28 February, not 3 March. JavaScript rolls the
 * overflow forward, which silently GAINS days on a term — so the day is pulled
 * back to the last of the intended month.
 *
 * UTC throughout: every date in this system is stored as UTC midnight, and
 * doing this arithmetic in local time is how a term ends up a day out.
 */
export function addMonthsUtc(from: Date, months: number): Date {
  const end = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, from.getUTCDate()),
  );
  const intendedMonth = (((from.getUTCMonth() + months) % 12) + 12) % 12;
  if (end.getUTCMonth() !== intendedMonth) end.setUTCDate(0);
  return end;
}

export function warrantyEnd(startsOn: Date, months: number): Date {
  return addMonthsUtc(startsOn, months);
}

/** The default where nobody has said otherwise. Editable per contract. */
export const DEFAULT_WARRANTY_MONTHS = 12;
/** How long before warranty end the decision has to be put to the client. */
export const DEFAULT_WARRANTY_ALERT_DAYS = 90;

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export function findConsequences(input: LifecycleInput): Consequence[] {
  const out: Consequence[] = [];
  const { asOf } = input;

  const projectsByContract = new Map<string, LifecycleProject[]>();
  for (const project of input.projects) {
    if (project.contractId === null) continue;
    const list = projectsByContract.get(project.contractId) ?? [];
    list.push(project);
    projectsByContract.set(project.contractId, list);
  }

  // --- projects that are finished but not marked so ------------------------

  for (const project of input.projects) {
    if (isClosedProject(project.status)) continue;
    if (project.progressBps < 10_000) continue;
    out.push({
      id: `project-complete-${project.id}`,
      kind: 'project_complete',
      severity: 'medium',
      subject: `${project.projectNo} · ${project.title}`,
      detail: 'Every stage is signed off, but the project is still open.',
      href: `/projects/${project.id}`,
      action: {
        label: 'Mark completed',
        effect: 'Sets the project to completed. It stops appearing as live work.',
        kind: 'set_project_status',
        targetId: project.id,
        value: 'completed',
      },
      choices: [],
    });
  }

  // --- warranty ------------------------------------------------------------

  for (const contract of input.contracts) {
    const projects = projectsByContract.get(contract.id) ?? [];
    const handedOver = projects.filter((p) => p.handoverSigned);

    // Handover signed, warranty clock never started.
    if (
      handedOver.length > 0 &&
      contract.warranty !== null &&
      contract.warranty.startsOn === null &&
      !isClosedContract(contract.status)
    ) {
      out.push({
        id: `start-warranty-${contract.id}`,
        kind: 'start_warranty',
        severity: 'high',
        subject: `${contract.contractNo} · ${contract.clientName}`,
        detail: `${handedOver.length === 1 ? 'The lift has' : `${handedOver.length} lifts have`} been handed over, but the warranty period has not been started, so nothing is counting down to the service decision.`,
        href: `/contracts?contract=${contract.id}`,
        action: {
          label: `Start the ${contract.warranty.months}-month warranty`,
          effect: `Warranty runs from today to ${warrantyEnd(asOf, contract.warranty.months).toISOString().slice(0, 10)}. You will be prompted about a service agreement ${contract.warranty.alertDays} days before it ends.`,
          kind: 'start_warranty',
          targetId: contract.id,
        },
        choices: [],
      });
      continue;
    }

    const endsOn = contract.warranty?.endsOn ?? null;
    if (endsOn === null || contract.warranty === null) continue;
    if (contract.succeededByContractId !== null || contract.serviceDeclined) continue;

    const daysLeft = daysBetween(asOf, endsOn);
    const lapsed = daysLeft < 0;
    if (!lapsed && daysLeft > contract.warranty.alertDays) continue;

    const choices: ConsequenceAction[] = [
      {
        label: 'Set up a service agreement',
        effect:
          'Creates a maintenance contract for the same lifts on a monthly fee, and links it to this one as its successor.',
        kind: 'convert_to_service',
        targetId: contract.id,
      },
      {
        label: 'Client declined — close it',
        effect:
          'Completes this contract and records that the lifts are no longer covered by us. They stay on the register with their history.',
        kind: 'close_after_warranty',
        targetId: contract.id,
      },
    ];

    out.push({
      id: `warranty-${contract.id}`,
      kind: lapsed ? 'warranty_lapsed_undecided' : 'warranty_decision_due',
      severity: 'decision',
      subject: `${contract.contractNo} · ${contract.clientName}`,
      detail: lapsed
        ? `Free warranty ended ${Math.abs(daysLeft)} days ago and nothing replaced it. Whatever we are doing for this client now, we are doing for nothing.`
        : `Free warranty ends in ${daysLeft} days. This is when it becomes a paying maintenance agreement — or stops being ours.`,
      href: `/contracts?contract=${contract.id}`,
      action: null,
      choices,
    });
  }

  // --- contracts -----------------------------------------------------------

  for (const contract of input.contracts) {
    if (isClosedContract(contract.status) || contract.status === 'draft') continue;
    const projects = projectsByContract.get(contract.id) ?? [];

    // Every project done, warranty over or never applicable, nothing succeeded
    // it: the contract has run its course.
    const allProjectsClosed = projects.length > 0 && projects.every((p) => isClosedProject(p.status));
    const warrantyOver =
      contract.warranty?.endsOn === null || contract.warranty === null
        ? true
        : contract.warranty.endsOn !== null && daysBetween(asOf, contract.warranty.endsOn) < 0;

    if (allProjectsClosed && warrantyOver && (contract.succeededByContractId !== null || contract.serviceDeclined)) {
      out.push({
        id: `contract-complete-${contract.id}`,
        kind: 'contract_complete',
        severity: 'medium',
        subject: `${contract.contractNo} · ${contract.clientName}`,
        detail: contract.succeededByContractId !== null
          ? 'Every project is closed and a service agreement has taken over, but this contract is still open.'
          : 'Every project is closed, the warranty has ended and the client declined service, but this contract is still open.',
        href: `/contracts?contract=${contract.id}`,
        action: {
          label: 'Mark completed',
          effect: 'Sets the contract to completed. It stops raising renewal alerts.',
          kind: 'set_contract_status',
          targetId: contract.id,
          value: 'completed',
        },
        choices: [],
      });
      continue;
    }

    // Past its end date with nothing said about it.
    if (daysBetween(asOf, contract.endDate) < 0 && contract.status === 'active' && !allProjectsClosed) {
      out.push({
        id: `contract-expired-${contract.id}`,
        kind: 'contract_expired',
        severity: 'high',
        subject: `${contract.contractNo} · ${contract.clientName}`,
        detail: `Ran past its end date ${Math.abs(daysBetween(asOf, contract.endDate))} days ago with work still open.`,
        href: `/contracts?contract=${contract.id}`,
        action: {
          label: 'Mark expired',
          effect: 'Sets the contract to expired, which is what it is until it is extended or closed.',
          kind: 'set_contract_status',
          targetId: contract.id,
          value: 'expired',
        },
        choices: [],
      });
    }
  }

  // --- lifts ---------------------------------------------------------------

  const projectById = new Map(input.projects.map((p) => [p.id, p]));

  for (const unit of input.units) {
    const project =
      unit.installedByProjectId === null ? undefined : projectById.get(unit.installedByProjectId);

    if (
      project !== undefined &&
      project.handoverSigned &&
      unit.status === 'under_installation'
    ) {
      out.push({
        id: `unit-in-service-${unit.id}`,
        kind: 'unit_in_service',
        severity: 'medium',
        subject: `${unit.tag} · ${unit.siteName}`,
        detail: 'Its project has been handed over, but the lift is still marked as under installation.',
        href: `/units/${unit.id}`,
        action: {
          label: 'Mark in service',
          effect: 'The lift starts appearing in the service lists and its callout history counts.',
          kind: 'set_unit_status',
          targetId: unit.id,
          value: 'in_service',
        },
        choices: [],
      });
    }
  }

  // --- clients -------------------------------------------------------------

  const liveContractsByClient = new Map<string, number>();
  for (const contract of input.contracts) {
    if (isClosedContract(contract.status) || contract.status === 'draft') continue;
    liveContractsByClient.set(contract.clientId, (liveContractsByClient.get(contract.clientId) ?? 0) + 1);
  }

  for (const client of input.clients) {
    const live = liveContractsByClient.get(client.id) ?? 0;

    if (live > 0 && (client.status === 'inactive' || client.status === 'prospect')) {
      out.push({
        id: `client-active-${client.id}`,
        kind: 'client_should_be_active',
        severity: 'low',
        subject: client.name,
        detail: `Marked ${client.status.replace(/_/g, ' ')}, but has ${live} live contract${live === 1 ? '' : 's'}.`,
        href: '/clients',
        action: {
          label: 'Mark active',
          effect: 'Puts the client back in the active list, where the work actually is.',
          kind: 'set_client_status',
          targetId: client.id,
          value: 'active',
        },
        choices: [],
      });
      continue;
    }

    if (live === 0 && client.status === 'active') {
      out.push({
        id: `client-dormant-${client.id}`,
        kind: 'client_dormant',
        severity: 'low',
        subject: client.name,
        detail: 'Marked active, but has no live contract — nothing signed, nothing in warranty, nothing on service.',
        href: '/clients',
        action: {
          label: 'Mark inactive',
          effect: 'Takes the client out of the active list. Every record stays, and they come back the moment something is signed.',
          kind: 'set_client_status',
          targetId: client.id,
          value: 'inactive',
        },
        choices: [],
      });
    }
  }

  return sortConsequences(out);
}

const SEVERITY_ORDER: Record<ConsequenceSeverity, number> = {
  decision: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Decisions first: they cost money, and the rest is tidying. */
export function sortConsequences(items: readonly Consequence[]): Consequence[] {
  return [...items].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.subject.localeCompare(b.subject),
  );
}

/** Headline counts for the page. */
export function summariseConsequences(items: readonly Consequence[]) {
  return {
    total: items.length,
    decisions: items.filter((i) => i.severity === 'decision').length,
    oneClick: items.filter((i) => i.action !== null).length,
  };
}
