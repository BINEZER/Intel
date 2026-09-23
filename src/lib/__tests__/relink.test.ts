import { describe, expect, it } from 'vitest';
import {
  LINK_COLLECTION,
  LINK_NOUN,
  LINK_REQUIRED,
  canClear,
  describeRelink,
  isChange,
  linkPatch,
  type LinkKind,
} from '../relink.js';

const ALL: LinkKind[] = [
  'project.client', 'project.contract', 'project.program',
  'unit.client', 'unit.project', 'unit.contract', 'contract.client',
];

describe('what a relink writes', () => {
  it('writes the id and the name together for a client', () => {
    // Writing the id without the name leaves a record filed under one client
    // and labelled with another, and the label is what people believe.
    expect(linkPatch('project.client', { id: 'c1', label: 'Addis Towers PLC' }))
      .toEqual({ clientId: 'c1', clientName: 'Addis Towers PLC' });
  });

  it('caches the contract number on a lift, where the register is scanned', () => {
    expect(linkPatch('unit.contract', { id: 'k1', label: 'AGR-2026-001' }))
      .toEqual({ maintenanceContractId: 'k1', maintenanceContractNo: 'AGR-2026-001' });
  });

  it('caches no contract number on a project, which has no column for one', () => {
    expect(linkPatch('project.contract', { id: 'k1', label: 'AGR-2026-001' }))
      .toEqual({ contractId: 'k1' });
  });

  it('clears the name along with the id', () => {
    // A stored name with no id behind it looks like data and points at nothing.
    expect(linkPatch('unit.contract', null))
      .toEqual({ maintenanceContractId: null, maintenanceContractNo: null });
    expect(linkPatch('project.client', null)).toEqual({ clientId: null, clientName: null });
  });

  it('writes something for every kind there is', () => {
    for (const kind of ALL) {
      expect(Object.keys(linkPatch(kind, { id: 'x', label: 'Y' })).length).toBeGreaterThan(0);
    }
  });

  it('never writes a field belonging to another record', () => {
    // A project field must never end up on a lift.
    expect(Object.keys(linkPatch('unit.project', { id: 'p1', label: 'PRJ-1' })))
      .toEqual(['installedByProjectId']);
    expect(Object.keys(linkPatch('project.program', { id: 'g1', label: 'Bole' })))
      .toEqual(['programId']);
  });
});

describe('which links may be emptied', () => {
  it('holds a client on everything that must have one', () => {
    expect(canClear('project.client')).toBe(false);
    expect(canClear('unit.client')).toBe(false);
    expect(canClear('contract.client')).toBe(false);
  });

  it('lets the optional ones go', () => {
    // Variations and warranty work genuinely have no contract; we service
    // plenty of lifts we did not install.
    expect(canClear('project.contract')).toBe(true);
    expect(canClear('project.program')).toBe(true);
    expect(canClear('unit.project')).toBe(true);
    expect(canClear('unit.contract')).toBe(true);
  });

  it('has an answer for every kind', () => {
    for (const kind of ALL) expect(typeof LINK_REQUIRED[kind]).toBe('boolean');
  });
});

describe('where each link lives', () => {
  it('routes each kind to the collection that owns it', () => {
    expect(LINK_COLLECTION['project.contract']).toBe('projects');
    expect(LINK_COLLECTION['unit.contract']).toBe('units');
    expect(LINK_COLLECTION['contract.client']).toBe('contracts');
  });

  it('names every kind in words', () => {
    for (const kind of ALL) expect(LINK_NOUN[kind].length).toBeGreaterThan(2);
  });
});

describe('deciding whether to write at all', () => {
  it('ignores re-picking what was already there', () => {
    // A picker fires on every selection. Writing an unchanged value stamps
    // the audit trail for nothing.
    expect(isChange('c1', 'c1')).toBe(false);
    expect(isChange(null, null)).toBe(false);
    expect(isChange(undefined, null)).toBe(false);
  });

  it('spots a real change, including to and from empty', () => {
    expect(isChange('c1', 'c2')).toBe(true);
    expect(isChange(null, 'c1')).toBe(true);
    expect(isChange('c1', null)).toBe(true);
  });
});

describe('saying what is about to happen', () => {
  it('names both ends rather than asking "are you sure"', () => {
    const said = describeRelink('unit.client', 'Addis Towers PLC', { id: 'c2', label: 'Ayat Real Estate' });
    expect(said).toContain('Addis Towers PLC');
    expect(said).toContain('Ayat Real Estate');
    expect(said).toContain('client');
  });

  it('says what will be left behind when a link is removed', () => {
    const said = describeRelink('project.contract', 'AGR-2026-001', null);
    expect(said).toContain('AGR-2026-001');
    expect(said).toContain('no contract');
  });

  it('reads as an addition when there was nothing before', () => {
    expect(describeRelink('project.program', null, { id: 'g1', label: 'Bole Tower' }))
      .toBe('Link to Bole Tower as the programme.');
  });

  it('says plainly when there is nothing on either side', () => {
    expect(describeRelink('unit.project', null, null)).toContain('No project');
  });
});
