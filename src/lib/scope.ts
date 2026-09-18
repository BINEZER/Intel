/**
 * What a contract actually covers.
 *
 * THE SHAPE OF THE BUSINESS
 *   A CONTRACT is the commercial agreement: one client, one value, one set of
 *   payment milestones, one warranty. It can cover several lifts, and those
 *   lifts can be in several buildings — "four lifts at Bole Tower and two at
 *   the Ayat site" is one contract, not three.
 *
 *   A PROJECT is the delivery: one site, one crew, one set of stages. Usually
 *   one lift, sometimes several in the same shaft bank or the same building.
 *
 *   A UNIT is the machine, and it outlives both. It keeps its own identity
 *   because callouts, maintenance visits and authority certificates attach to
 *   the machine, not to whichever job happened to install it.
 *
 *       Client → Contract → Project(s), one per site → Unit(s), the lifts
 *
 * WHERE THE LINK LIVES
 *   `Project.contractId` — one contract, many projects. NOT `Contract.projectId`,
 *   which is singular and cannot express a contract covering two buildings. That
 *   field is deprecated; see the note on it in `schema.ts`.
 *
 *   `ElevatorUnit.installedByProjectId` — one project, many lifts. There is
 *   deliberately no `Project.unitIds` array to go with it: two fields naming the
 *   same relationship drift apart, and the one that drifts is always the one you
 *   read.
 *
 * WHY THIS IS A LIBRARY
 *   Rolling a contract's progress up out of its projects is arithmetic with a
 *   judgement in it — see `contractProgress` — and arithmetic with a judgement
 *   in it belongs where a test can pin it down.
 */

/** The fields of a contract this module needs. */
export interface ScopeContract {
  id: string;
  contractNo: string;
  clientId: string;
  valueNetSantim: number;
  status: string;
}

/** The fields of a project this module needs. */
export interface ScopeProject {
  id: string;
  projectNo: string;
  title: string;
  contractId: string | null;
  clientId: string;
  siteName: string;
  status: string;
  progressBps: number;
  /** This project's share of the contract, where it is recorded. */
  contractNetSantim: number | null;
}

/** The fields of a lift this module needs. */
export interface ScopeUnit {
  id: string;
  unitCode: string;
  tag: string;
  siteName: string;
  installedByProjectId: string | null;
  maintenanceContractId: string | null;
  status: string;
}

/** How a rolled-up progress figure was arrived at. */
export type ProgressBasis =
  /** Each project weighted by its share of the contract value. */
  | 'value'
  /** No project carries a value, so every project counts the same. */
  | 'equal'
  /** Nothing to roll up. */
  | 'none';

export interface ContractProgress {
  bps: number | null;
  basis: ProgressBasis;
}

export interface ContractScope {
  contractId: string;
  projects: ScopeProject[];
  units: ScopeUnit[];
  /** Distinct site names, in the order the projects give them. */
  sites: string[];
  projectCount: number;
  unitCount: number;
  siteCount: number;
  progress: ContractProgress;
  /** Projects on this contract that are finished. */
  completedProjects: number;
  /**
   * Contract value not accounted for by any project's recorded share.
   *
   * Non-zero means the projects do not add up to the contract: either a project
   * is missing, or one of them has no value recorded. Either way it is a
   * question worth putting in front of somebody.
   */
  unallocatedNetSantim: number;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Every project delivering this contract. */
export function projectsForContract(
  contractId: string,
  projects: readonly ScopeProject[],
): ScopeProject[] {
  return projects.filter((project) => project.contractId === contractId);
}

/** Every lift installed under this project. */
export function unitsForProject(
  projectId: string,
  units: readonly ScopeUnit[],
): ScopeUnit[] {
  return units.filter((unit) => unit.installedByProjectId === projectId);
}

/**
 * Every lift under this contract.
 *
 * Installation contracts reach their lifts THROUGH the projects that installed
 * them. A maintenance contract has no projects at all — it is signed against
 * machines that already exist — so its lifts point at it directly. Both are
 * counted, and a lift that is both installed under this contract and serviced
 * by it is counted once.
 */
export function unitsForContract(
  contractId: string,
  projects: readonly ScopeProject[],
  units: readonly ScopeUnit[],
): ScopeUnit[] {
  const projectIds = new Set(
    projectsForContract(contractId, projects).map((project) => project.id),
  );
  return units.filter(
    (unit) =>
      unit.maintenanceContractId === contractId ||
      (unit.installedByProjectId !== null && projectIds.has(unit.installedByProjectId)),
  );
}

/** The contract a project delivers, where it has one. */
export function contractForProject(
  project: { contractId: string | null },
  contracts: readonly ScopeContract[],
): ScopeContract | null {
  if (project.contractId === null) return null;
  return contracts.find((contract) => contract.id === project.contractId) ?? null;
}

// ---------------------------------------------------------------------------
// Rolling up
// ---------------------------------------------------------------------------

/** A project that is over, however it ended. */
function isFinished(status: string): boolean {
  return status === 'completed' || status === 'handed_over';
}

/** A project that no longer counts towards delivery at all. */
function isAbandoned(status: string): boolean {
  return status === 'cancelled' || status === 'terminated';
}

/**
 * One progress figure for a contract, out of its projects.
 *
 * WEIGHTED BY VALUE WHERE THE VALUES ARE THERE. Two lifts at a tower and one
 * goods lift at a warehouse are not a third each: if the tower is 80% of the
 * money, it is 80% of the contract. Averaging them equally reports a contract
 * as half done when the expensive half has not started.
 *
 * Where NO project carries a value, equal weight is the honest fallback and the
 * caller is told which was used, so the screen can say "by value" or not claim
 * it. A mixture — some projects valued, some not — is treated as equal weight
 * too: weighting only the ones with figures would silently give the unvalued
 * projects a weight of zero, which reads as progress the contract has not made.
 *
 * Cancelled and terminated projects are left out entirely. They are not 0%
 * complete; they are not part of the job any more.
 */
export function contractProgress(projects: readonly ScopeProject[]): ContractProgress {
  const live = projects.filter((project) => !isAbandoned(project.status));
  if (live.length === 0) return { bps: null, basis: 'none' };

  const everyProjectValued = live.every(
    (project) => project.contractNetSantim !== null && project.contractNetSantim > 0,
  );

  if (everyProjectValued) {
    const total = live.reduce((sum, project) => sum + (project.contractNetSantim ?? 0), 0);
    if (total > 0) {
      const weighted = live.reduce(
        (sum, project) => sum + project.progressBps * (project.contractNetSantim ?? 0),
        0,
      );
      return { bps: Math.round(weighted / total), basis: 'value' };
    }
  }

  const mean = live.reduce((sum, project) => sum + project.progressBps, 0) / live.length;
  return { bps: Math.round(mean), basis: 'equal' };
}

/** Everything a contract covers, in one pass. */
export function contractScope(
  contract: ScopeContract,
  allProjects: readonly ScopeProject[],
  allUnits: readonly ScopeUnit[],
): ContractScope {
  const projects = projectsForContract(contract.id, allProjects);
  const units = unitsForContract(contract.id, allProjects, allUnits);

  // Sites come from the projects, and from lifts serviced directly under a
  // maintenance contract that has no projects of its own.
  const sites: string[] = [];
  for (const name of [...projects.map((p) => p.siteName), ...units.map((u) => u.siteName)]) {
    const trimmed = name.trim();
    if (trimmed !== '' && !sites.includes(trimmed)) sites.push(trimmed);
  }

  const allocated = projects.reduce((sum, project) => sum + (project.contractNetSantim ?? 0), 0);

  return {
    contractId: contract.id,
    projects,
    units,
    sites,
    projectCount: projects.length,
    unitCount: units.length,
    siteCount: sites.length,
    progress: contractProgress(projects),
    completedProjects: projects.filter((project) => isFinished(project.status)).length,
    unallocatedNetSantim: contract.valueNetSantim - allocated,
  };
}

/**
 * The scope in a line of prose.
 *
 * A count on its own ("3 projects") does not say whether that is one building
 * or three, and the difference decides whether one crew can do it.
 */
export function describeScope(scope: ContractScope): string {
  if (scope.projectCount === 0 && scope.unitCount === 0) {
    return 'No project or lift is linked to this contract yet.';
  }

  const parts: string[] = [];
  if (scope.unitCount > 0) {
    parts.push(`${scope.unitCount} lift${scope.unitCount === 1 ? '' : 's'}`);
  }
  // The project count only earns its place when there are no lifts to name —
  // otherwise the control that expands the list is already saying it, and a
  // third clause makes the column wide enough to push the money off the row.
  if (scope.projectCount > 0 && scope.unitCount === 0) {
    parts.push(`${scope.projectCount} project${scope.projectCount === 1 ? '' : 's'}`);
  }
  if (scope.siteCount > 0) {
    parts.push(
      scope.siteCount === 1
        ? `at ${scope.sites[0] as string}`
        : `across ${scope.siteCount} sites`,
    );
  }
  return parts.join(' · ');
}

/**
 * Whether the projects add up to the contract, in words.
 *
 * Returns null when there is nothing to say — a contract whose projects account
 * for its value needs no remark, and a remark on every row is noise.
 */
export function describeAllocation(scope: ContractScope): string | null {
  if (scope.projectCount === 0) return null;
  if (scope.unallocatedNetSantim === 0) return null;
  if (scope.unallocatedNetSantim > 0) {
    return 'Part of this contract is not covered by any project yet.';
  }
  return 'The projects on this contract add up to more than the contract value.';
}
