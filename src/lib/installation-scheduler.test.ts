import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  analyseInstallationHistory,
  detectBookingConflicts,
  isWorkingDay,
  scheduleInstallation,
  type InstallationBooking,
  type InstallationPhasePlan,
  type InstallationTeam,
  type WorkCalendar,
} from './installation-scheduler.js';

const calendar: WorkCalendar = { workingWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-11-16'] };
const team: InstallationTeam = {
  id: 'mechanical-a', name: 'Mechanical Team A', supervisorId: 'sup-1',
  supervisorName: 'Supervisor A', memberIds: ['tech-1', 'tech-2'],
  disciplines: ['mechanical'], active: true,
};
const phase = (patch: Partial<InstallationPhasePlan> = {}): InstallationPhasePlan => ({
  id: 'mechanical', name: 'Mechanical installation', discipline: 'mechanical',
  crewDays: 3, dependencies: [], requiresSiteReadiness: true, siteReady: true,
  plannedStart: null, plannedEnd: null, assignedTeamId: null, status: 'not_started',
  ...patch,
});

describe('installation scheduling engine', () => {
  it('uses working days and skips weekends and configured holidays', () => {
    expect(isWorkingDay('2026-11-14', calendar)).toBe(false);
    expect(isWorkingDay('2026-11-16', calendar)).toBe(false);
    expect(addWorkingDays('2026-11-13', 2, calendar)).toBe('2026-11-17');
  });

  it('detects team and shared-member double bookings', () => {
    const existing: InstallationBooking = {
      id: 'b1', projectId: 'P-1', phaseId: 'p1', resourceType: 'team',
      resourceId: team.id, resourceName: team.name, memberIds: team.memberIds,
      discipline: 'mechanical', startDate: '2026-11-16', endDate: '2026-11-18',
      allocationBps: 10000, status: 'confirmed',
    };
    const candidate = { ...existing, id: 'candidate', projectId: 'P-2', phaseId: 'p2', startDate: '2026-11-18', endDate: '2026-11-20' };
    expect(detectBookingConflicts(candidate, [existing]).map((c) => c.code)).toEqual(['team_overlap', 'member_overlap']);
  });

  it('blocks phases that require site readiness until approval is recorded', () => {
    const result = scheduleInstallation([phase({ siteReady: false })], [team], [], '2026-11-16', calendar);
    expect(result.phases[0]?.scheduleState).toBe('blocked');
    expect(result.conflicts[0]?.code).toBe('site_not_ready');
  });

  it('schedules dependent phases sequentially on working dates', () => {
    const first = phase({ id: 'mechanical', crewDays: 2 });
    const second = phase({ id: 'electrical', name: 'Electrical installation', discipline: 'mechanical', crewDays: 2, dependencies: ['mechanical'] });
    const result = scheduleInstallation([first, second], [team], [], '2026-11-17', calendar);
    expect(result.phases.map((p) => [p.plannedStart, p.plannedEnd])).toEqual([
      ['2026-11-17', '2026-11-18'],
      ['2026-11-19', '2026-11-20'],
    ]);
  });

  it('keeps completed phases fixed during rescheduling', () => {
    const completed = phase({ id: 'done', status: 'completed', plannedStart: '2026-11-10', plannedEnd: '2026-11-12', crewDays: 2 });
    const next = phase({ id: 'next', dependencies: ['done'], crewDays: 1 });
    const result = scheduleInstallation([completed, next], [team], [], '2026-11-17', calendar);
    expect(result.phases[0]).toMatchObject({ plannedStart: '2026-11-10', plannedEnd: '2026-11-12', status: 'completed' });
    expect(result.phases[1]?.plannedStart).toBe('2026-11-13');
  });

  it('does not produce a schedule for missing or circular dependencies', () => {
    const result = scheduleInstallation([phase({ dependencies: ['missing'] })], [team], [], '2026-11-17', calendar);
    expect(result.phases[0]?.scheduleState).toBe('blocked');
    expect(result.conflicts[0]?.code).toBe('dependency');
  });

  it('summarises completed historical actual crew-days without including incomplete data', () => {
    const history = analyseInstallationHistory([
      { discipline: 'mechanical', liftType: 'Passenger', stops: 8, capacityKg: 630, actualCrewDays: 10, status: 'completed' },
      { discipline: 'mechanical', liftType: 'Passenger', stops: 8, capacityKg: 630, actualCrewDays: 14, status: 'completed' },
      { discipline: 'mechanical', liftType: 'Passenger', stops: 8, capacityKg: 630, actualCrewDays: 99, status: 'in_progress' },
    ]);
    expect(history[0]).toMatchObject({ sampleSize: 2, averageCrewDays: 12, medianCrewDays: 12, suggestedCrewDays: 12 });
  });
});
