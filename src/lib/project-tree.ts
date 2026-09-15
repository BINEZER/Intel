/**
 * Parent projects and their sub-projects.
 *
 * An installation job is one thing commercially and several things
 * operationally. A tower is one contract, one client and one handover date —
 * and four blocks, each with its own crew, its own stages, its own slippage.
 * Tracked as one project the detail is lost; tracked as four unrelated projects
 * the commitment is lost.
 *
 * So: a parent holds the commitment, children hold the work, and the parent's
 * figures are the sum of its children plus its own.
 *
 * THE TREE IS ONE LEVEL DEEP, ON PURPOSE. A sub-project with sub-projects of
 * its own is a program, and there is already a Programs page for that. Allowing
 * arbitrary depth buys a rollup nobody can hold in their head and a cycle bug
 * nobody finds until a page hangs.
 */

import { rateBps } from './kpi.js';
import type { RateBps } from './schema.js';
import type { ProjectStatusValue } from './status.js';

export interface TreeProject {
  id: string;
  projectNo: string;
  title: string;
  clientName: string;
  parentProjectId: string | null;
  status: ProjectStatusValue;
  progressBps: number;
  contractNetSantim: number;
  plannedEnd: Date;
  inDanger: boolean;
}

export interface TreeNode<T extends TreeProject = TreeProject> {
  project: T;
  children: T[];
  /** The parent's own figures plus every child's. */
  rolled: RolledFigures;
  /** True when this node has children, so the UI knows to offer the toggle. */
  hasChildren: boolean;
}

export interface RolledFigures {
  projects: number;
  live: number;
  inDanger: number;
  overdue: number;
  contractNetSantim: number;
  /**
   * Progress weighted by CONTRACT VALUE across the parent and its children.
   * A four-lift block at 20% and a single lift at 100% do not average to 60%
   * done in any sense a chief executive would accept.
   */
  progressBps: number;
  weightedBy: 'value' | 'count';
  /** The latest planned end in the family — when the commitment actually closes. */
  plannedEnd: Date;
}

function roll(members: readonly TreeProject[], asOf: Date): RolledFigures {
  const contractNetSantim = members.reduce((a, p) => a + p.contractNetSantim, 0);
  const weightedBy: RolledFigures['weightedBy'] = contractNetSantim > 0 ? 'value' : 'count';

  const progressBps =
    weightedBy === 'value'
      ? Math.round(members.reduce((a, p) => a + p.progressBps * p.contractNetSantim, 0) / contractNetSantim)
      : Math.round(members.reduce((a, p) => a + p.progressBps, 0) / Math.max(1, members.length));

  return {
    projects: members.length,
    live: members.filter((p) => p.status === 'in_progress').length,
    inDanger: members.filter((p) => p.inDanger).length,
    overdue: members.filter((p) => p.status === 'in_progress' && p.plannedEnd < asOf).length,
    contractNetSantim,
    progressBps: Math.min(10_000, Math.max(0, progressBps)),
    weightedBy,
    plannedEnd: new Date(Math.max(...members.map((p) => p.plannedEnd.getTime()))),
  };
}

/**
 * Arrange a flat list into parents with their children.
 *
 * A project whose parent is missing — deleted, or filtered out by a status
 * filter — is promoted to the top level rather than dropped. Silently hiding a
 * project because its parent is not in the current view is how a project stops
 * being worked on.
 */
export function buildTree<T extends TreeProject>(projects: readonly T[], asOf: Date): TreeNode<T>[] {
  const byId = new Map(projects.map((p) => [p.id, p]));

  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];

  for (const project of projects) {
    const parentId = project.parentProjectId;
    // Self-parenting would loop for ever; a missing parent means orphaned.
    if (parentId === null || parentId === project.id || !byId.has(parentId)) {
      roots.push(project);
      continue;
    }
    childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), project]);
  }

  return roots.map((project) => {
    const children = (childrenOf.get(project.id) ?? []).sort((a, b) =>
      a.projectNo.localeCompare(b.projectNo),
    );
    return {
      project,
      children,
      rolled: roll([project, ...children], asOf),
      hasChildren: children.length > 0,
    };
  });
}

/**
 * May this project become a child of that one?
 *
 * Four ways it may not, and each has a message rather than a silent refusal:
 * itself, its own child (which would make a cycle), a project that already has
 * children (depth two), and a project that is already someone's child.
 */
export function canParent(
  projects: readonly TreeProject[],
  childId: string,
  parentId: string,
): { ok: true } | { ok: false; error: string } {
  if (childId === parentId) {
    return { ok: false, error: 'A project cannot be its own parent.' };
  }

  const byId = new Map(projects.map((p) => [p.id, p]));
  const parent = byId.get(parentId);
  const child = byId.get(childId);

  if (parent === undefined) return { ok: false, error: 'That parent project no longer exists.' };
  if (child === undefined) return { ok: false, error: 'That project no longer exists.' };

  if (parent.parentProjectId === childId) {
    return { ok: false, error: `${parent.title} is already a sub-project of this one.` };
  }
  if (parent.parentProjectId !== null && parent.parentProjectId !== undefined) {
    return {
      ok: false,
      error: `${parent.title} is itself a sub-project. Sub-projects do not nest — if you need another level, use a program.`,
    };
  }
  if (projects.some((p) => p.parentProjectId === childId)) {
    return {
      ok: false,
      error: 'This project has sub-projects of its own, so it cannot also be one. Move its children first, or use a program.',
    };
  }

  return { ok: true };
}

/** Projects that may legally become a parent of this one. */
export function eligibleParents<T extends TreeProject>(
  projects: readonly T[],
  childId: string,
): T[] {
  return projects.filter((candidate) => canParent(projects, childId, candidate.id).ok);
}

/**
 * How much of the family is this one project?
 *
 * Shown on a sub-project so its own progress can be read against the whole.
 * Null when the family carries no contract value to take a share of.
 */
export function shareOfFamily(project: TreeProject, family: readonly TreeProject[]): RateBps {
  const total = family.reduce((a, p) => a + p.contractNetSantim, 0);
  return rateBps(project.contractNetSantim, total);
}

/** Parents first by money at stake, with troubled families above calm ones. */
export function sortTree<T extends TreeProject>(nodes: readonly TreeNode<T>[]): TreeNode<T>[] {
  return [...nodes].sort((a, b) => {
    if (a.rolled.inDanger !== b.rolled.inDanger) return b.rolled.inDanger - a.rolled.inDanger;
    if (a.rolled.overdue !== b.rolled.overdue) return b.rolled.overdue - a.rolled.overdue;
    return b.rolled.contractNetSantim - a.rolled.contractNetSantim;
  });
}
