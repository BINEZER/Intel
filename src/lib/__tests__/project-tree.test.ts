/**
 * Parent projects and sub-projects.
 *
 * The rules worth guarding are the refusals: no cycles, no second level, and
 * never silently dropping a project whose parent is not in view.
 */

import { describe, expect, it } from 'vitest';
import {
  buildTree,
  canParent,
  eligibleParents,
  shareOfFamily,
  sortTree,
  type TreeProject,
} from '../project-tree.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const NOW = utc(2026, 9, 14);

function project(over: Partial<TreeProject> & { id: string }): TreeProject {
  return {
    projectNo: over.id.toUpperCase(),
    title: `Project ${over.id}`,
    clientName: 'Addis Towers',
    parentProjectId: null,
    status: 'in_progress',
    progressBps: 5000,
    contractNetSantim: 1_000_000_00,
    plannedEnd: utc(2026, 12, 1),
    inDanger: false,
    ...over,
  };
}

describe('buildTree', () => {
  it('nests children under their parent', () => {
    const tree = buildTree(
      [
        project({ id: 'tower' }),
        project({ id: 'blockA', parentProjectId: 'tower' }),
        project({ id: 'blockB', parentProjectId: 'tower' }),
        project({ id: 'other' }),
      ],
      NOW,
    );

    expect(tree.map((n) => n.project.id)).toEqual(['tower', 'other']);
    expect(tree[0]?.children.map((c) => c.id)).toEqual(['blockA', 'blockB']);
    expect(tree[0]?.hasChildren).toBe(true);
    expect(tree[1]?.hasChildren).toBe(false);
  });

  it('promotes an orphan rather than hiding it', () => {
    // Its parent was deleted or filtered out. A project that disappears from
    // the list because of that is a project nobody works on.
    const tree = buildTree([project({ id: 'orphan', parentProjectId: 'gone' })], NOW);
    expect(tree.map((n) => n.project.id)).toEqual(['orphan']);
  });

  it('does not loop on a project that is its own parent', () => {
    const tree = buildTree([project({ id: 'self', parentProjectId: 'self' })], NOW);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children).toEqual([]);
  });

  it('rolls the family up by contract value, not by project count', () => {
    const tree = buildTree(
      [
        project({ id: 'tower', contractNetSantim: 0, progressBps: 0 }),
        project({ id: 'big', parentProjectId: 'tower', contractNetSantim: 24_000_000_00, progressBps: 2000 }),
        project({ id: 'small', parentProjectId: 'tower', contractNetSantim: 400_000_00, progressBps: 10_000 }),
      ],
      NOW,
    );

    const rolled = tree[0]?.rolled;
    // A count-average of 0, 20 and 100 would be 40%.
    expect(rolled?.progressBps).toBe(Math.round((2000 * 24_000_000_00 + 10_000 * 400_000_00) / 24_400_000_00));
    expect(rolled?.weightedBy).toBe('value');
    expect(rolled?.projects).toBe(3);
  });

  it('falls back to a plain mean only when nothing carries value', () => {
    const tree = buildTree(
      [
        project({ id: 'a', contractNetSantim: 0, progressBps: 2000 }),
        project({ id: 'b', parentProjectId: 'a', contractNetSantim: 0, progressBps: 8000 }),
      ],
      NOW,
    );
    expect(tree[0]?.rolled.progressBps).toBe(5000);
    expect(tree[0]?.rolled.weightedBy).toBe('count');
  });

  it('takes the family end date from the last member to finish', () => {
    const tree = buildTree(
      [
        project({ id: 'tower', plannedEnd: utc(2026, 6, 1) }),
        project({ id: 'late', parentProjectId: 'tower', plannedEnd: utc(2027, 3, 1) }),
      ],
      NOW,
    );
    expect(tree[0]?.rolled.plannedEnd.toISOString().slice(0, 10)).toBe('2027-03-01');
  });

  it('counts danger and overdue across the whole family', () => {
    const tree = buildTree(
      [
        project({ id: 'tower' }),
        project({ id: 'a', parentProjectId: 'tower', inDanger: true }),
        project({ id: 'b', parentProjectId: 'tower', plannedEnd: utc(2026, 1, 1) }),
      ],
      NOW,
    );
    expect(tree[0]?.rolled.inDanger).toBe(1);
    expect(tree[0]?.rolled.overdue).toBe(1);
  });
});

describe('canParent', () => {
  const projects = [
    project({ id: 'tower' }),
    project({ id: 'blockA', parentProjectId: 'tower' }),
    project({ id: 'loose' }),
    project({ id: 'other' }),
  ];

  it('allows a loose project under a top-level one', () => {
    expect(canParent(projects, 'loose', 'other')).toEqual({ ok: true });
  });

  it('refuses a project being its own parent', () => {
    const result = canParent(projects, 'tower', 'tower');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('its own parent');
  });

  it('refuses a cycle through its own child', () => {
    const result = canParent(projects, 'tower', 'blockA');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('already a sub-project of this one');
  });

  it('refuses a second level, and points at programs instead', () => {
    const result = canParent(projects, 'loose', 'blockA');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('use a program');
  });

  it('refuses making a parent into somebody else’s child', () => {
    const result = canParent(projects, 'tower', 'other');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Move its children first');
  });

  it('reports a parent that has since been deleted', () => {
    expect(canParent(projects, 'loose', 'gone')).toMatchObject({ ok: false });
  });
});

describe('eligibleParents', () => {
  it('offers only the projects that would actually be allowed', () => {
    const projects = [
      project({ id: 'tower' }),
      project({ id: 'blockA', parentProjectId: 'tower' }),
      project({ id: 'loose' }),
    ];
    expect(eligibleParents(projects, 'loose').map((p) => p.id)).toEqual(['tower']);
  });
});

describe('shareOfFamily', () => {
  it('reports a sub-project as a share of the whole', () => {
    const family = [
      project({ id: 'a', contractNetSantim: 750_000_00 }),
      project({ id: 'b', contractNetSantim: 250_000_00 }),
    ];
    expect(shareOfFamily(family[1] as TreeProject, family)).toBe(2500);
  });

  it('reports nothing rather than zero when the family carries no value', () => {
    const family = [project({ id: 'a', contractNetSantim: 0 })];
    expect(shareOfFamily(family[0] as TreeProject, family)).toBeNull();
  });
});

describe('sortTree', () => {
  it('puts troubled families above larger calm ones', () => {
    const tree = buildTree(
      [
        project({ id: 'big', contractNetSantim: 90_000_000_00 }),
        project({ id: 'troubled', contractNetSantim: 1_000_00, inDanger: true }),
      ],
      NOW,
    );
    expect(sortTree(tree)[0]?.project.id).toBe('troubled');
  });
});
