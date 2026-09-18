import { describe, expect, it } from 'vitest';
import {
  contractForProject,
  contractProgress,
  contractScope,
  describeAllocation,
  describeScope,
  projectsForContract,
  unitsForContract,
  unitsForProject,
  type ScopeContract,
  type ScopeProject,
  type ScopeUnit,
} from '../scope.js';

const contract = (over: Partial<ScopeContract> = {}): ScopeContract => ({
  id: 'k1',
  contractNo: 'AGR-2021-001',
  clientId: 'c1',
  valueNetSantim: 10_000_000_00,
  status: 'active',
  ...over,
});

const project = (over: Partial<ScopeProject> = {}): ScopeProject => ({
  id: 'p1',
  projectNo: 'PRJ-001',
  title: 'Bole Tower · LIFT-01',
  contractId: 'k1',
  clientId: 'c1',
  siteName: 'Bole Tower',
  status: 'in_progress',
  progressBps: 5000,
  contractNetSantim: null,
  ...over,
});

const unit = (over: Partial<ScopeUnit> = {}): ScopeUnit => ({
  id: 'u1',
  unitCode: 'IM-U-00001',
  tag: 'LIFT-01',
  siteName: 'Bole Tower',
  installedByProjectId: 'p1',
  maintenanceContractId: null,
  status: 'in_service',
  ...over,
});

describe('one contract, many projects', () => {
  it('finds every project delivering a contract', () => {
    const projects = [
      project({ id: 'a' }),
      project({ id: 'b' }),
      project({ id: 'c', contractId: 'k2' }),
      project({ id: 'd', contractId: null }),
    ];
    expect(projectsForContract('k1', projects).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('points a project back at its contract', () => {
    const contracts = [contract(), contract({ id: 'k2', contractNo: 'AGR-2021-002' })];
    expect(contractForProject(project({ contractId: 'k2' }), contracts)?.contractNo)
      .toBe('AGR-2021-002');
  });

  it('says so plainly when a project is on no contract', () => {
    expect(contractForProject(project({ contractId: null }), [contract()])).toBeNull();
    expect(contractForProject(project({ contractId: 'gone' }), [contract()])).toBeNull();
  });
});

describe('one project, many lifts', () => {
  it('finds the lifts installed under a project', () => {
    const units = [
      unit({ id: 'u1' }),
      unit({ id: 'u2', tag: 'LIFT-02' }),
      unit({ id: 'u3', installedByProjectId: 'p2' }),
      unit({ id: 'u4', installedByProjectId: null }),
    ];
    expect(unitsForProject('p1', units).map((u) => u.id)).toEqual(['u1', 'u2']);
  });
});

describe('a contract reaching its lifts', () => {
  it('reaches them through the projects that installed them', () => {
    const projects = [project({ id: 'p1' }), project({ id: 'p2', siteName: 'Ayat' })];
    const units = [
      unit({ id: 'u1', installedByProjectId: 'p1' }),
      unit({ id: 'u2', installedByProjectId: 'p2' }),
      unit({ id: 'u3', installedByProjectId: 'other' }),
    ];
    expect(unitsForContract('k1', projects, units).map((u) => u.id)).toEqual(['u1', 'u2']);
  });

  it('also counts lifts a maintenance contract names directly', () => {
    // A service agreement has no projects at all — it is signed against
    // machines that already exist.
    const units = [unit({ id: 'u9', installedByProjectId: null, maintenanceContractId: 'k1' })];
    expect(unitsForContract('k1', [], units).map((u) => u.id)).toEqual(['u9']);
  });

  it('counts a lift once when the same contract installed and services it', () => {
    const units = [unit({ id: 'u1', installedByProjectId: 'p1', maintenanceContractId: 'k1' })];
    expect(unitsForContract('k1', [project({ id: 'p1' })], units)).toHaveLength(1);
  });
});

describe('rolling progress up to the contract', () => {
  it('weights each project by its share of the money', () => {
    // Two lifts at a tower worth 80% and one goods lift worth 20% are not a
    // third each: if the tower is 80% of the money it is 80% of the contract.
    const progress = contractProgress([
      project({ id: 'a', progressBps: 10_000, contractNetSantim: 8_000_000_00 }),
      project({ id: 'b', progressBps: 0, contractNetSantim: 2_000_000_00 }),
    ]);
    expect(progress).toEqual({ bps: 8000, basis: 'value' });
  });

  it('falls back to equal weight when no project carries a value', () => {
    const progress = contractProgress([
      project({ id: 'a', progressBps: 10_000 }),
      project({ id: 'b', progressBps: 0 }),
    ]);
    expect(progress).toEqual({ bps: 5000, basis: 'equal' });
  });

  it('uses equal weight when only SOME projects are valued', () => {
    // Weighting only the valued ones silently gives the rest a weight of zero,
    // which reads as progress the contract has not made.
    const progress = contractProgress([
      project({ id: 'a', progressBps: 10_000, contractNetSantim: 9_000_000_00 }),
      project({ id: 'b', progressBps: 0, contractNetSantim: null }),
    ]);
    expect(progress).toEqual({ bps: 5000, basis: 'equal' });
  });

  it('leaves cancelled and terminated projects out rather than counting them as zero', () => {
    // They are not 0% complete; they are not part of the job any more.
    const progress = contractProgress([
      project({ id: 'a', progressBps: 8000 }),
      project({ id: 'b', progressBps: 0, status: 'cancelled' }),
      project({ id: 'c', progressBps: 0, status: 'terminated' }),
    ]);
    expect(progress).toEqual({ bps: 8000, basis: 'equal' });
  });

  it('reports no figure rather than zero when there is nothing to roll up', () => {
    expect(contractProgress([])).toEqual({ bps: null, basis: 'none' });
    expect(contractProgress([project({ status: 'cancelled' })])).toEqual({ bps: null, basis: 'none' });
  });
});

describe('the whole scope', () => {
  const projects = [
    project({ id: 'p1', siteName: 'Bole Tower', progressBps: 6000, contractNetSantim: 6_000_000_00 }),
    project({ id: 'p2', siteName: 'Ayat Site', progressBps: 2000, contractNetSantim: 4_000_000_00, status: 'completed' }),
    project({ id: 'p3', contractId: 'k2', siteName: 'Elsewhere' }),
  ];
  const units = [
    unit({ id: 'u1', installedByProjectId: 'p1', siteName: 'Bole Tower' }),
    unit({ id: 'u2', installedByProjectId: 'p1', siteName: 'Bole Tower', tag: 'LIFT-02' }),
    unit({ id: 'u3', installedByProjectId: 'p2', siteName: 'Ayat Site' }),
    unit({ id: 'u4', installedByProjectId: 'p3', siteName: 'Elsewhere' }),
  ];

  it('counts the lifts, the projects and the distinct sites', () => {
    const scope = contractScope(contract(), projects, units);
    expect(scope.projectCount).toBe(2);
    expect(scope.unitCount).toBe(3);
    expect(scope.siteCount).toBe(2);
    expect(scope.sites).toEqual(['Bole Tower', 'Ayat Site']);
  });

  it('counts a site once however many projects are on it', () => {
    const two = [
      project({ id: 'a', siteName: 'Bole Tower' }),
      project({ id: 'b', siteName: 'Bole Tower' }),
    ];
    expect(contractScope(contract(), two, []).siteCount).toBe(1);
  });

  it('ignores a blank site name rather than counting an empty string', () => {
    const scope = contractScope(contract(), [project({ siteName: '  ' })], []);
    expect(scope.sites).toEqual([]);
    expect(scope.siteCount).toBe(0);
  });

  it('counts how many of its projects are done', () => {
    expect(contractScope(contract(), projects, units).completedProjects).toBe(1);
  });

  it('reports value the projects do not account for', () => {
    // 10,000,000 contract against 6,000,000 + 4,000,000 of projects.
    expect(contractScope(contract(), projects, units).unallocatedNetSantim).toBe(0);
    const short = contractScope(contract({ valueNetSantim: 12_000_000_00 }), projects, units);
    expect(short.unallocatedNetSantim).toBe(2_000_000_00);
  });
});

describe('saying it in words', () => {
  it('names the site when there is only one, and counts them when there are more', () => {
    const one = contractScope(contract(), [project({ siteName: 'Bole Tower' })], [unit()]);
    expect(describeScope(one)).toContain('at Bole Tower');

    const many = contractScope(
      contract(),
      [project({ id: 'a', siteName: 'Bole' }), project({ id: 'b', siteName: 'Ayat' })],
      [],
    );
    expect(describeScope(many)).toContain('across 2 sites');
  });

  it('leaves the project count out once there are lifts to name', () => {
    // The control that expands the list already says how many projects there
    // are; a third clause only makes the column wider.
    const withLifts = contractScope(contract(), [project()], [unit()]);
    expect(describeScope(withLifts)).toBe('1 lift · at Bole Tower');
  });

  it('falls back to the project count when no lift is linked yet', () => {
    const noLifts = contractScope(contract(), [project(), project({ id: 'p2' })], []);
    expect(describeScope(noLifts)).toContain('2 projects');
  });

  it('says plainly when nothing is linked yet', () => {
    expect(describeScope(contractScope(contract(), [], []))).toContain('No project or lift is linked');
  });

  it('flags a contract its projects do not add up to', () => {
    const short = contractScope(
      contract({ valueNetSantim: 9_000_000_00 }),
      [project({ contractNetSantim: 5_000_000_00 })],
      [],
    );
    expect(describeAllocation(short)).toContain('not covered by any project');
  });

  it('flags projects that add up to more than the contract', () => {
    const over = contractScope(
      contract({ valueNetSantim: 1_000_000_00 }),
      [project({ contractNetSantim: 5_000_000_00 })],
      [],
    );
    expect(describeAllocation(over)).toContain('more than the contract value');
  });

  it('says nothing when the figures agree, or when there is no project', () => {
    // A remark on every row is noise.
    const exact = contractScope(
      contract({ valueNetSantim: 5_000_000_00 }),
      [project({ contractNetSantim: 5_000_000_00 })],
      [],
    );
    expect(describeAllocation(exact)).toBeNull();
    expect(describeAllocation(contractScope(contract(), [], []))).toBeNull();
  });
});
