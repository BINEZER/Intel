/**
 * Changing which record something belongs to.
 *
 * THE CHAIN, AND WHO OWNS EACH LINK
 *
 *     Client ─┬─ Contract ─┬─ Project ─── Lift
 *             │            └─ Programme ─┘
 *
 *   Every relationship is held on exactly ONE field, on the MANY side:
 *
 *     Contract.clientId                 which client signed it
 *     Project.clientId                  who the job is for
 *     Project.contractId                which agreement pays for it
 *     Project.programId                 which commitment it is part of
 *     ElevatorUnit.clientId             whose building the machine is in
 *     ElevatorUnit.installedByProjectId which project it is linked to
 *     ElevatorUnit.maintenanceContractId which agreement services it
 *
 *   There is deliberately no array on the other side. Two fields naming one
 *   relationship drift apart, and the one that drifts is always the one being
 *   read — which is why `Contract.projectId` is deprecated and empty.
 *
 * THE PROBLEM THIS MODULE SOLVES
 *   Several of those fields have a NAME stored beside them so a list can be
 *   drawn without six more reads: `clientName`, `maintenanceContractNo`.
 *   Changing the id without the name leaves a project filed under one client
 *   and labelled with another, and the label is what people believe.
 *
 *   So a relink is never one field. This module says which fields go together,
 *   in one place, so no caller has to remember.
 */

/** What can be changed, and on what. */
export type LinkKind =
  | 'project.client'
  | 'project.contract'
  | 'project.program'
  | 'unit.client'
  | 'unit.project'
  | 'unit.contract'
  | 'contract.client';

/** The record being pointed AT, as little of it as the link needs. */
export interface LinkTarget {
  id: string;
  /** What a person calls it — the client's name, the contract number. */
  label: string;
}

/** The fields to write. Values are ids, names, or null to clear the link. */
export type LinkPatch = Record<string, string | null>;

/**
 * Which collection a link lives on, so a caller cannot write a project field
 * onto a lift.
 */
export const LINK_COLLECTION: Record<LinkKind, 'projects' | 'units' | 'contracts'> = {
  'project.client': 'projects',
  'project.contract': 'projects',
  'project.program': 'projects',
  'unit.client': 'units',
  'unit.project': 'units',
  'unit.contract': 'units',
  'contract.client': 'contracts',
};

/** Can this link be cleared, or must it always point somewhere? */
export const LINK_REQUIRED: Record<LinkKind, boolean> = {
  // A job without a client is a job nobody is doing for anybody.
  'project.client': true,
  // Variations and warranty work genuinely have no contract.
  'project.contract': false,
  'project.program': false,
  // A machine stands in somebody's building.
  'unit.client': true,
  // Every lift must be associated with a project, whether we installed it or only service it.
  'unit.project': true,
  'unit.contract': false,
  'contract.client': true,
};

/** What a person calls the other end, for labels and confirmations. */
export const LINK_NOUN: Record<LinkKind, string> = {
  'project.client': 'client',
  'project.contract': 'contract',
  'project.program': 'programme',
  'unit.client': 'client',
  'unit.project': 'project',
  'unit.contract': 'maintenance contract',
  'contract.client': 'client',
};

/**
 * Every field a relink writes, including the denormalised names.
 *
 * `target` is null when the link is being cleared; the name fields are cleared
 * with it, because a stored name with no id behind it is the worst of both —
 * it looks like data and points at nothing.
 */
export function linkPatch(kind: LinkKind, target: LinkTarget | null): LinkPatch {
  const id = target?.id ?? null;
  const label = target?.label ?? null;

  switch (kind) {
    case 'project.client':
      return { clientId: id, clientName: label };
    case 'project.contract':
      // No contract NUMBER is stored on a project: the contract is read through
      // the id when one is needed, and a number cached here would be one more
      // thing to keep in step for no gain.
      return { contractId: id };
    case 'project.program':
      return { programId: id };
    case 'unit.client':
      return { clientId: id, clientName: label };
    case 'unit.project':
      return { installedByProjectId: id };
    case 'unit.contract':
      // This one DOES cache the number: the lift register is read far more
      // often than it is written, and it is the column people scan.
      return { maintenanceContractId: id, maintenanceContractNo: label };
    case 'contract.client':
      return { clientId: id, clientName: label };
  }
}

/** Refuse a clear where the link must point somewhere. */
export function canClear(kind: LinkKind): boolean {
  return !LINK_REQUIRED[kind];
}

/**
 * Whether a change is worth writing.
 *
 * A picker fires on every selection, including re-picking what was already
 * there. Writing that would stamp `updatedBy` and bump the audit trail for
 * nothing.
 */
export function isChange(currentId: string | null | undefined, nextId: string | null): boolean {
  return (currentId ?? null) !== nextId;
}

/**
 * What to say before the change is made.
 *
 * Moving a lift to another client is not a small edit — it moves the machine's
 * service history with it — so the sentence names both ends rather than asking
 * "are you sure".
 */
export function describeRelink(
  kind: LinkKind,
  from: string | null,
  to: LinkTarget | null,
): string {
  const noun = LINK_NOUN[kind];
  if (to === null) {
    return from === null
      ? `No ${noun} is set.`
      : `Remove the link to ${from}? It will have no ${noun} afterwards.`;
  }
  if (from === null) return `Link to ${to.label} as the ${noun}.`;
  return `Change the ${noun} from ${from} to ${to.label}.`;
}
