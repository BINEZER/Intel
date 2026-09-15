import { describe, expect, it } from 'vitest';
import { buildPeoplePlan, namesMatch, normaliseName } from '../import-people.js';
import type { ImportIssue, Workbook } from '../import-master.js';

describe('name handling', () => {
  it('strips the noise the sheets carry', () => {
    expect(normaliseName('  Merkebu  Alemayehu ')).toBe('MERKEBU ALEMAYEHU');
    expect(normaliseName('BGB(Getachew)')).toBe('BGB');
    expect(normaliseName('MAS ')).toBe('MAS');
  });

  it('matches the spellings that refer to one person', () => {
    // The contact list says MELAKU MAS, the roster says MAS.
    expect(namesMatch('MELAKU MAS', 'Mas')).toBe(true);
    // The payment sheet says Merkebu Alemayehu, the contact list says MERKEB.
    expect(namesMatch('Merkebu Alemayehu', 'Merkebu')).toBe(true);
    expect(namesMatch('MERKEB', 'Merkebu')).toBe(true);
  });

  it('does not match two different people', () => {
    expect(namesMatch('Abraham', 'Adugna')).toBe(false);
    expect(namesMatch('Seid', 'Sintayehu')).toBe(false);
    // Three letters is too little to call a prefix a match.
    expect(namesMatch('MAS', 'MASTEWAL')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

/** Shaped like the real sheets, including the roster's own typo. */
function workbook(): Workbook {
  return {
    HR_Roster: [
      { a: 'No.', b: 'Name', c: 'Previous', d: 'Remarks', e: 'Current', f: null, g: null, h: null, i: 'Upcoming' },
      { a: 'Our Techncians', b: null, c: null, d: null, e: null, f: null, g: null, h: null, i: null },
      { a: '1', b: 'Fasika', c: 'Maw', d: null, e: 'Sahle & family', f: null, g: null, h: null, i: 'Megersi RE' },
      { a: '2', b: 'Dejene', c: 'Webland', d: null, e: 'Bebarem', f: null, g: null, h: null, i: 'Col. Megersa' },
      { a: '3', b: 'Yosef', c: null, d: null, e: 'Muluwongel Mech', f: null, g: null, h: null, i: null },
      { a: null, b: 'Subcontractors', c: null, d: null, e: null, f: null, g: null, h: null, i: null },
      { a: '1', b: 'Abraham', c: 'Fedawaq', d: null, e: 'Muluwongel elec.', f: null, g: null, h: null, i: null },
      { a: '4', b: 'Yosef', c: null, d: null, e: 'Hiya G', f: null, g: null, h: null, i: null },
      { a: '3', b: 'MAS ', c: 'Maya', d: null, e: 'Narucon', f: null, g: null, h: null, i: null },
    ],
    Eng_Technicians_List: [
      { a: 'OUR TECHNICIANS', b: null, c: null, d: null, e: null },
      { a: null, b: 'PROJECTS', c: null, d: null, e: null },
      { a: 'FASIKA', b: 'ATO MILION', c: 'MAW', d: null, e: null },
      { a: 'GETACHEW', b: 'MIRROR(MECH)', c: null, d: null, e: null },
      { a: 'SUBCONTRACTORS', b: null, c: null, d: null, e: null },
      { a: 'MERKEBU', b: 'ATO GETNET', c: 'GARULA', d: 'KIDUS', e: null },
    ],
    Sch_Contacts: [
      { a: null, b: 'NAME', c: 'PHONE' },
      { a: '1', b: 'ABRAHAM SC', c: '251924044149' },
      { a: '2', b: 'FASIKA T', c: '251934422908' },
      { a: '3', b: 'MELAKU MAS SC', c: '251938266544' },
      { a: '4', b: 'MERKEB SC', c: '251912827456' },
      { a: '5', b: 'MIFTAH T', c: '251928666230' },
      { a: '6', b: 'YONAS KIDUS PROJECT', c: '251911211806' },
    ],
    Fin_Subcontractor_Payments: [
      { a: 'No', b: 'Name of  The sub contacts', c: 'Project Name', d: 'Work Description' },
      { a: '1', b: null, c: null, d: null },
      { a: null, b: 'Merkebu Alemayehu', c: 'Gift Real Estate', d: 'Installation' },
      { a: null, b: null, c: 'Getnet', d: 'Steel Structure Work' },
    ],
  };
}

describe('reading the people out of the rosters', () => {
  it('uses the section heading to decide what somebody is', () => {
    const issues: ImportIssue[] = [];
    const plan = buildPeoplePlan(workbook(), issues);
    expect(plan.technicians.map((t) => t.name)).toEqual(['Dejene', 'Fasika', 'GETACHEW', 'MIFTAH', 'Yosef']);
    expect(plan.subcontractors.map((s) => s.name)).toEqual([
      'Abraham', 'MELAKU MAS', 'Merkebu Alemayehu', 'Yosef',
    ]);
  });

  it('keeps the two Yosefs apart', () => {
    // One is a technician, one is a subcontractor. Merging them would put a
    // subcontractor's payments against an employee.
    const plan = buildPeoplePlan(workbook(), []);
    expect(plan.technicians.filter((t) => t.name === 'Yosef')).toHaveLength(1);
    expect(plan.subcontractors.filter((s) => s.name === 'Yosef')).toHaveLength(1);
    const tech = plan.technicians.find((t) => t.name === 'Yosef')!;
    const sub = plan.subcontractors.find((s) => s.name === 'Yosef')!;
    expect(tech.key).not.toBe(sub.key);
  });

  it('never creates a person out of a heading', () => {
    const plan = buildPeoplePlan(workbook(), []);
    const names = [...plan.technicians, ...plan.subcontractors].map((p) => p.name.toLowerCase());
    expect(names).not.toContain('our techncians');
    expect(names).not.toContain('subcontractors');
    expect(names).not.toContain('name');
    expect(names).not.toContain('projects');
  });

  it('attaches phones across the sheets’ different spellings', () => {
    const plan = buildPeoplePlan(workbook(), []);
    expect(plan.technicians.find((t) => t.name === 'Fasika')!.phone).toBe('251934422908');
    // The roster says "MAS", the contact list "MELAKU MAS SC" — the same
    // person, and the fuller spelling is kept.
    expect(plan.subcontractors.find((s) => s.name === 'MELAKU MAS')!.phone).toBe('251938266544');
    expect(plan.subcontractors.find((s) => s.name === 'Merkebu Alemayehu')!.phone).toBe('251912827456');
  });

  it('reports a phone joined to a differently spelled name', () => {
    const issues: ImportIssue[] = [];
    buildPeoplePlan(workbook(), issues);
    expect(issues.some((i) => i.severity === 'repaired' && i.ref.includes('MERKEB'))).toBe(true);
  });

  it('creates the people who exist only in the contact list, and says so', () => {
    const issues: ImportIssue[] = [];
    const plan = buildPeoplePlan(workbook(), issues);
    // MIFTAH T is in no roster; the "T" suffix is the only evidence.
    expect(plan.technicians.map((t) => t.name)).toContain('MIFTAH');
    expect(issues.some((i) => i.ref === 'MIFTAH T' && i.reason.includes('Only in the contact list'))).toBe(true);
  });

  it('ignores a contact who is not one of ours', () => {
    const plan = buildPeoplePlan(workbook(), []);
    const names = [...plan.technicians, ...plan.subcontractors].map((p) => p.name.toUpperCase());
    expect(names.some((n) => n.includes('YONAS'))).toBe(false);
  });

  it('prefers the fuller spelling of a name', () => {
    const plan = buildPeoplePlan(workbook(), []);
    expect(plan.subcontractors.map((s) => s.name)).toContain('Merkebu Alemayehu');
    expect(plan.subcontractors.map((s) => s.name)).not.toContain('MERKEBU');
  });

  it('carries the work description through as a trade', () => {
    const plan = buildPeoplePlan(workbook(), []);
    const merkebu = plan.subcontractors.find((s) => s.name === 'Merkebu Alemayehu')!;
    expect(merkebu.trades).toContain('Installation');
    expect(merkebu.trades).toContain('Steel structure work');
  });

  it('flags every subcontractor as having no TIN', () => {
    // Not cosmetic: no TIN means 30% withholding instead of 2% or 3%.
    const issues: ImportIssue[] = [];
    const plan = buildPeoplePlan(workbook(), issues);
    const flagged = issues.filter((i) => i.reason.includes('withholding to 30%'));
    expect(flagged).toHaveLength(plan.subcontractors.length);
  });

  it('returns nothing rather than throwing when the sheets are absent', () => {
    const plan = buildPeoplePlan({}, []);
    expect(plan).toEqual({ technicians: [], subcontractors: [] });
  });
});

describe('a sheet that declares its section in the header row', () => {
  it('reads the names under it instead of refusing them', () => {
    // Eng_Technicians_List's first row IS the header, so "OUR TECHNICIANS"
    // arrives as a column NAME and never appears as a cell value. Without
    // reading the header, every technician on that sheet is refused for
    // sitting above a heading that is right there.
    const issues: ImportIssue[] = [];
    const plan = buildPeoplePlan(
      {
        Eng_Technicians_List: [
          { 'OUR TECHNICIANS': null, 'Unnamed: 1': 'PROJECTS' },
          { 'OUR TECHNICIANS': 'GETACHEW', 'Unnamed: 1': 'MIRROR(MECH)' },
          { 'OUR TECHNICIANS': 'SUBCONTRACTORS', 'Unnamed: 1': null },
          { 'OUR TECHNICIANS': 'MERKEBU', 'Unnamed: 1': 'KIDUS' },
        ],
      },
      issues,
    );
    expect(plan.technicians.map((t) => t.name)).toEqual(['GETACHEW']);
    // The in-sheet marker still switches the section part way down.
    expect(plan.subcontractors.map((s) => s.name)).toEqual(['MERKEBU']);
    expect(issues.some((i) => i.reason.includes('above any'))).toBe(false);
  });
});
