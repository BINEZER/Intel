/**
 * Alerts.
 *
 * The discipline being tested is RESTRAINT. An alert list that shows everything
 * gets read once. So: a contract someone is already negotiating is not an alert,
 * a completed project is not an alert however bad its history, and every entry
 * has to name an action.
 */

import { describe, expect, it } from 'vitest';
import {
  buildAlerts,
  contractAlerts,
  countBySeverity,
  draftExtensionLetter,
  projectAlerts,
  sortAlerts,
  unitAlerts,
  type AlertContract,
  type AlertProject,
  type AlertUnit,
} from '../alerts.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const NOW = utc(2026, 9, 14);

function contract(over: Partial<AlertContract> = {}): AlertContract {
  return {
    id: 'mc1',
    contractNo: 'MC-2026-004',
    clientName: 'Sheger Mall',
    type: 'maintenance',
    endDate: utc(2026, 10, 7),
    renewalWindowDays: 90,
    renewalStatus: 'not_due',
    status: 'active',
    valueGrossSantim: 3_600_000_00,
    ...over,
  };
}

function project(over: Partial<AlertProject> = {}): AlertProject {
  return {
    id: 'p1',
    projectNo: 'PRJ-001',
    title: 'Bole Tower lifts',
    clientName: 'Addis Towers',
    status: 'in_progress',
    inDanger: true,
    severity: 'high',
    flags: [
      { code: 'overdue_receivable', severity: 'high', message: 'ETB 2,400,000.00 is 74 days overdue.', amountSantim: 240_000_000 },
      { code: 'schedule_slip', severity: 'medium', message: 'Progress is 12% behind the plan.' },
    ],
    plannedEnd: utc(2026, 12, 1),
    ...over,
  };
}

function unit(over: Partial<AlertUnit> = {}): AlertUnit {
  return {
    id: 'u1',
    unitCode: 'IM-U-00142',
    tag: 'LIFT-01',
    siteName: 'Sheger Mall',
    verdict: 'healthy',
    reasons: [],
    certificateExpiresOn: null,
    ...over,
  };
}

describe('contractAlerts', () => {
  it('raises one for a contract inside its renewal window, and says to write the letter', () => {
    const [alert] = contractAlerts([contract()], NOW);

    expect(alert?.kind).toBe('contract_expiring');
    expect(alert?.subject).toBe('MC-2026-004 · Sheger Mall');
    expect(alert?.message).toContain('23 days');
    expect(alert?.action).toContain('extension letter');
  });

  it('stays silent on a contract someone is already negotiating', () => {
    expect(contractAlerts([contract({ renewalStatus: 'in_negotiation' })], NOW)).toEqual([]);
    expect(contractAlerts([contract({ renewalStatus: 'renewed' })], NOW)).toEqual([]);
  });

  it('stays silent outside the renewal window', () => {
    expect(contractAlerts([contract({ endDate: utc(2027, 6, 1) })], NOW)).toEqual([]);
  });

  it('escalates a lapsed contract to critical and says the revenue has stopped', () => {
    const [alert] = contractAlerts([contract({ endDate: utc(2026, 7, 1) })], NOW);

    expect(alert?.kind).toBe('contract_lapsed');
    expect(alert?.severity).toBe('critical');
    expect(alert?.message).toContain('has stopped');
    expect(alert?.daysRemaining).toBeLessThan(0);
  });

  it('ignores contracts that are not active', () => {
    expect(contractAlerts([contract({ status: 'terminated' })], NOW)).toEqual([]);
  });
});

describe('projectAlerts', () => {
  it('leads with the worst flag and says how many others there are', () => {
    const [alert] = projectAlerts([project()], NOW);

    expect(alert?.message).toContain('74 days overdue');
    expect(alert?.message).toContain('and 1 more');
    expect(alert?.href).toBe('/projects/p1');
  });

  it('says nothing about a project that is not in danger', () => {
    expect(projectAlerts([project({ inDanger: false })], NOW)).toEqual([]);
  });

  it('says nothing about a finished or cancelled project, however bad its history', () => {
    expect(projectAlerts([project({ status: 'completed' })], NOW)).toEqual([]);
    expect(projectAlerts([project({ status: 'cancelled' })], NOW)).toEqual([]);
  });

  it('survives a project flagged in danger with no flags attached', () => {
    const [alert] = projectAlerts([project({ flags: [] })], NOW);
    expect(alert?.message).toContain('Addis Towers');
    expect(alert?.amountSantim).toBeUndefined();
  });
});

describe('unitAlerts', () => {
  it('treats an expired certificate as critical', () => {
    const [alert] = unitAlerts([unit({ certificateExpiresOn: utc(2026, 6, 1) })], NOW);
    expect(alert?.kind).toBe('certificate_expired');
    expect(alert?.severity).toBe('critical');
    expect(alert?.message).toContain('still in service');
  });

  it('warns ahead of expiry, harder as the date closes', () => {
    const soon = unitAlerts([unit({ certificateExpiresOn: utc(2026, 9, 25) })], NOW);
    const later = unitAlerts([unit({ certificateExpiresOn: utc(2026, 11, 1) })], NOW);

    expect(soon[0]?.severity).toBe('high');
    expect(later[0]?.severity).toBe('medium');
  });

  it('says nothing about a certificate that is not close to expiring', () => {
    expect(unitAlerts([unit({ certificateExpiresOn: utc(2027, 8, 1) })], NOW)).toEqual([]);
  });

  it('raises a unit whose service record has deteriorated, quoting the reason', () => {
    const [alert] = unitAlerts([unit({ verdict: 'problem', reasons: ['9 callouts in the last twelve months.'] })], NOW);
    expect(alert?.message).toBe('9 callouts in the last twelve months.');
    expect(alert?.action).toContain('modernisation quote');
  });

  it('says nothing about a unit merely on watch', () => {
    expect(unitAlerts([unit({ verdict: 'watch', reasons: ['x'] })], NOW)).toEqual([]);
  });
});

describe('sorting and counting', () => {
  it('puts the most severe first, and within a severity the most overdue', () => {
    const alerts = buildAlerts(
      {
        contracts: [contract({ id: 'lapsed', endDate: utc(2026, 5, 1) }), contract({ id: 'soon' })],
        projects: [project()],
        units: [unit({ certificateExpiresOn: utc(2026, 9, 25) })],
      },
      NOW,
    );

    expect(alerts[0]?.severity).toBe('critical');
    expect(alerts.map((a) => a.severity)).toEqual([...alerts.map((a) => a.severity)].sort(
      (a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 })[a] - ({ critical: 0, high: 1, medium: 2, low: 3 })[b],
    ));
  });

  it('sorts something already overdue above something due tomorrow', () => {
    const sorted = sortAlerts([
      { id: 'tomorrow', kind: 'contract_expiring', severity: 'high', subject: 's', message: 'm', action: 'a', href: '/', daysRemaining: 1 },
      { id: 'late', kind: 'contract_expiring', severity: 'high', subject: 's', message: 'm', action: 'a', href: '/', daysRemaining: -10 },
    ]);
    expect(sorted[0]?.id).toBe('late');
  });

  it('puts an alert with no date last within its severity', () => {
    const sorted = sortAlerts([
      { id: 'undated', kind: 'unit_needs_attention', severity: 'high', subject: 's', message: 'm', action: 'a', href: '/', daysRemaining: null },
      { id: 'dated', kind: 'contract_expiring', severity: 'high', subject: 's', message: 'm', action: 'a', href: '/', daysRemaining: 40 },
    ]);
    expect(sorted.map((a) => a.id)).toEqual(['dated', 'undated']);
  });

  it('counts by severity', () => {
    const counts = countBySeverity(buildAlerts({ contracts: [contract()], projects: [project()], units: [] }, NOW));
    expect(counts.high).toBeGreaterThanOrEqual(1);
    expect(counts.low).toBe(0);
  });

  it('every alert names an action', () => {
    const alerts = buildAlerts(
      {
        contracts: [contract(), contract({ id: 'l', endDate: utc(2026, 1, 1) })],
        projects: [project()],
        units: [unit({ verdict: 'problem', reasons: ['r'] }), unit({ id: 'u2', certificateExpiresOn: utc(2026, 9, 20) })],
      },
      NOW,
    );
    expect(alerts.length).toBeGreaterThan(3);
    for (const alert of alerts) expect(alert.action.length).toBeGreaterThan(10);
  });
});

describe('draftExtensionLetter', () => {
  const base = {
    companyName: 'IntelMotion Lifts PLC',
    companyAddress: 'Bole Sub-city, Addis Ababa',
    contractNo: 'MC-2026-004',
    clientName: 'Sheger Mall',
    clientAddress: 'Megenagna, Addis Ababa',
    siteName: 'Sheger Mall',
    units: 4,
    endDate: utc(2026, 10, 7),
    proposedEndDate: utc(2027, 10, 7),
    currentValueGrossSantim: 3_600_000_00,
    proposedValueGrossSantim: 3_960_000_00,
    signatoryName: 'Abenezer Wale',
    signatoryTitle: 'Executive Manager',
    formatDate: (d: Date) => d.toISOString().slice(0, 10),
  };

  it('names the contract, the site and the number of lifts', () => {
    const letter = draftExtensionLetter(base);
    expect(letter).toContain('MC-2026-004');
    expect(letter).toContain('4 lifts');
    expect(letter).toContain('2026-10-07');
  });

  it('states the uplift as a figure AND a reason', () => {
    const letter = draftExtensionLetter(base);
    expect(letter).toContain('10.0%');
    expect(letter).toContain('spare part and transport costs');
  });

  it('says plainly when there is no increase, rather than inventing a justification', () => {
    const letter = draftExtensionLetter({ ...base, proposedValueGrossSantim: base.currentValueGrossSantim });
    expect(letter).toContain('no increase');
    expect(letter).not.toContain('adjustment reflects');
  });

  it('does not divide by zero on a contract with no recorded value', () => {
    const letter = draftExtensionLetter({ ...base, currentValueGrossSantim: 0 });
    expect(letter).not.toContain('Infinity');
    expect(letter).not.toContain('NaN');
  });

  it('uses the singular for one lift', () => {
    expect(draftExtensionLetter({ ...base, units: 1 })).toContain('1 lift at');
  });
});
