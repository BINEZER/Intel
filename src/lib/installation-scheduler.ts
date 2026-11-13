/**
 * Installation scheduling domain.
 *
 * All durations are working days / crew-days. Calendar dates are ISO local
 * dates; the work calendar controls which dates count as working days.
 * Scheduling is deterministic and never silently double-books a team/member.
 */

export type InstallationDiscipline = 'mechanical' | 'electrical' | 'commissioning';
export type BookingStatus = 'tentative' | 'confirmed' | 'cancelled';

export interface InstallationTeam {
  id: string;
  name: string;
  supervisorId: string;
  supervisorName: string;
  memberIds: string[];
  disciplines: InstallationDiscipline[];
  active: boolean;
}

export interface InstallationBooking {
  id: string;
  projectId: string;
  phaseId: string;
  resourceType: 'team' | 'technician';
  resourceId: string;
  resourceName: string;
  memberIds: string[];
  discipline: InstallationDiscipline;
  startDate: string;
  endDate: string;
  allocationBps: number;
  status: BookingStatus;
}

export interface InstallationPhasePlan {
  id: string;
  name: string;
  discipline: InstallationDiscipline;
  crewDays: number;
  dependencies: string[];
  requiresSiteReadiness: boolean;
  siteReady: boolean;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  actualCrewDays?: number | null;
  assignedTeamId: string | null;
  status: 'not_started' | 'scheduled' | 'in_progress' | 'blocked' | 'completed';
}

export interface WorkCalendar {
  /** ISO weekday numbers: Monday=1 ... Sunday=7. */
  workingWeekdays: number[];
  holidays: string[];
}

export interface ScheduleConflict {
  code: 'team_overlap' | 'member_overlap' | 'site_not_ready' | 'dependency' | 'no_qualified_team' | 'invalid_duration';
  message: string;
  phaseId: string;
  conflictingBookingId?: string;
}

export interface ScheduledPhase extends InstallationPhasePlan {
  plannedStart: string | null;
  plannedEnd: string | null;
  scheduleState: 'scheduled' | 'blocked';
  blocker: string | null;
}

export interface ScheduleResult {
  phases: ScheduledPhase[];
  bookings: InstallationBooking[];
  conflicts: ScheduleConflict[];
  projectStart: string | null;
  projectEnd: string | null;
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day ? date : null;
}

export function addCalendarDays(date: string, days: number): string {
  const parsed = parseDate(date);
  if (!parsed || !Number.isInteger(days)) throw new Error('A valid ISO date and whole-day offset are required.');
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function isWorkingDay(date: string, calendar: WorkCalendar): boolean {
  const parsed = parseDate(date);
  if (!parsed) return false;
  const weekday = parsed.getUTCDay() === 0 ? 7 : parsed.getUTCDay();
  return calendar.workingWeekdays.includes(weekday) && !calendar.holidays.includes(date);
}

export function addWorkingDays(startDate: string, workingDays: number, calendar: WorkCalendar): string {
  if (!parseDate(startDate) || !Number.isFinite(workingDays) || workingDays < 1) {
    throw new Error('A valid start date and positive working-day duration are required.');
  }
  let cursor = startDate;
  let remaining = Math.ceil(workingDays);
  while (!isWorkingDay(cursor, calendar)) cursor = addCalendarDays(cursor, 1);
  while (remaining > 1) {
    cursor = addCalendarDays(cursor, 1);
    if (isWorkingDay(cursor, calendar)) remaining -= 1;
  }
  return cursor;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function teamForPhase(phase: InstallationPhasePlan, teams: readonly InstallationTeam[]): InstallationTeam | null {
  return teams.find((team) => team.active && team.disciplines.includes(phase.discipline)) ?? null;
}

export function detectBookingConflicts(
  candidate: InstallationBooking,
  bookings: readonly InstallationBooking[],
): ScheduleConflict[] {
  if (candidate.status === 'cancelled') return [];
  const conflicts: ScheduleConflict[] = [];
  for (const existing of bookings) {
    if (existing.id === candidate.id || existing.status === 'cancelled') continue;
    if (!overlaps(candidate.startDate, candidate.endDate, existing.startDate, existing.endDate)) continue;
    if (candidate.resourceType === 'team' && existing.resourceType === 'team' && candidate.resourceId === existing.resourceId) {
      conflicts.push({ code: 'team_overlap', message: `${candidate.resourceName} is already booked for ${existing.projectId} during this period.`, phaseId: candidate.phaseId, conflictingBookingId: existing.id });
    }
    const sharedMembers = candidate.memberIds.filter((id) => existing.memberIds.includes(id));
    if (sharedMembers.length) {
      conflicts.push({ code: 'member_overlap', message: `${sharedMembers.length} team member(s) are already committed to another booking.`, phaseId: candidate.phaseId, conflictingBookingId: existing.id });
    }
  }
  return conflicts;
}

/**
 * Forward-pass scheduler. Phases are ordered by dependency readiness, then
 * original input order. It reserves one qualified team per phase, starts only
 * after dependencies, site readiness and existing resource commitments allow.
 * Existing confirmed bookings are treated as immutable constraints.
 */
export function scheduleInstallation(
  phases: readonly InstallationPhasePlan[],
  teams: readonly InstallationTeam[],
  existingBookings: readonly InstallationBooking[],
  startDate: string,
  calendar: WorkCalendar,
): ScheduleResult {
  if (!parseDate(startDate)) throw new Error('Choose a valid project start date.');
  const remaining = new Map(phases.map((phase) => [phase.id, { ...phase }]));
  if (remaining.size !== phases.length) throw new Error('Phase IDs must be unique.');
  const scheduled = new Map<string, ScheduledPhase>();
  const generated: InstallationBooking[] = [];
  const conflicts: ScheduleConflict[] = [];
  // Completed and in-progress phases are fixed anchors during rescheduling.
  // They must not be silently moved or booked a second time.
  for (const phase of phases) {
    if (phase.status !== 'completed' && phase.status !== 'in_progress') continue;
    const start = phase.plannedStart ?? phase.actualStart ?? null;
    const end = phase.plannedEnd ?? phase.actualEnd ?? null;
    if (start && end && parseDate(start) && parseDate(end)) {
      scheduled.set(phase.id, { ...phase, plannedStart: start, plannedEnd: end, scheduleState: 'scheduled', blocker: null });
    } else {
      scheduled.set(phase.id, { ...phase, plannedStart: null, plannedEnd: null, scheduleState: 'blocked', blocker: 'An in-progress or completed phase needs its actual or planned dates recorded before downstream scheduling.' });
      conflicts.push({ code: 'dependency', message: `${phase.name} is active/completed but has no reliable completion date.`, phaseId: phase.id });
    }
    remaining.delete(phase.id);
  }
  let guard = phases.length + 1;

  while (remaining.size && guard-- > 0) {
    let madeProgress = false;
    for (const phase of phases) {
      if (!remaining.has(phase.id)) continue;
      const missingDependencies = phase.dependencies.filter((id) => !phases.some((candidate) => candidate.id === id));
      const blockedDependency = phase.dependencies.find((id) => scheduled.get(id)?.scheduleState === 'blocked');
      if (missingDependencies.length || blockedDependency) {
        const reason = missingDependencies.length
          ? `Missing prerequisite phase: ${missingDependencies.join(', ')}.`
          : `A prerequisite phase (${blockedDependency}) is blocked.`;
        scheduled.set(phase.id, { ...phase, plannedStart: null, plannedEnd: null, scheduleState: 'blocked', blocker: reason });
        conflicts.push({ code: 'dependency', message: `${phase.name}: ${reason}`, phaseId: phase.id });
        remaining.delete(phase.id);
        madeProgress = true;
        continue;
      }
      const unmet = phase.dependencies.filter((id) => !scheduled.has(id));
      if (unmet.length) continue;
      const dependencyEnds = phase.dependencies
        .map((id) => scheduled.get(id)?.plannedEnd ?? startDate);
      const latestDependencyEnd = dependencyEnds.length
        ? dependencyEnds.reduce((latest, end) => end > latest ? end : latest, dependencyEnds[0]!)
        : startDate;
      let dependencyEnd = phase.dependencies.length ? addCalendarDays(latestDependencyEnd, 1) : startDate;
      if (dependencyEnd < startDate) dependencyEnd = startDate;
      while (!isWorkingDay(dependencyEnd, calendar)) dependencyEnd = addCalendarDays(dependencyEnd, 1);
      if (phase.requiresSiteReadiness && !phase.siteReady) {
        scheduled.set(phase.id, { ...phase, plannedStart: null, plannedEnd: null, scheduleState: 'blocked', blocker: 'Site readiness has not been approved.' });
        conflicts.push({ code: 'site_not_ready', message: `${phase.name} is waiting for site-readiness approval.`, phaseId: phase.id });
        remaining.delete(phase.id);
        madeProgress = true;
        continue;
      }
      if (!Number.isFinite(phase.crewDays) || phase.crewDays <= 0) {
        scheduled.set(phase.id, { ...phase, plannedStart: null, plannedEnd: null, scheduleState: 'blocked', blocker: 'No valid duration estimate.' });
        conflicts.push({ code: 'invalid_duration', message: `${phase.name} needs a positive crew-day estimate.`, phaseId: phase.id });
        remaining.delete(phase.id);
        madeProgress = true;
        continue;
      }
      const eligibleTeams = phase.assignedTeamId
        ? teams.filter((row) => row.id === phase.assignedTeamId && row.active && row.disciplines.includes(phase.discipline))
        : teams.filter((row) => row.active && row.disciplines.includes(phase.discipline));
      if (!eligibleTeams.length) {
        scheduled.set(phase.id, { ...phase, plannedStart: null, plannedEnd: null, scheduleState: 'blocked', blocker: 'No active team qualified for this discipline.' });
        conflicts.push({ code: 'no_qualified_team', message: `No active team is available for ${phase.discipline} work.`, phaseId: phase.id });
        remaining.delete(phase.id);
        madeProgress = true;
        continue;
      }

      let candidateStart = dependencyEnd;
      let placed: InstallationBooking | null = null;
      for (let attempts = 0; attempts < 730 && !placed; attempts += 1) {
        while (!isWorkingDay(candidateStart, calendar)) candidateStart = addCalendarDays(candidateStart, 1);
        const candidateEnd = addWorkingDays(candidateStart, phase.crewDays, calendar);
        // Try every qualified team on the same date before pushing the phase
        // into the future. This avoids a busy first team hiding a free second one.
        for (const team of eligibleTeams) {
          const candidate: InstallationBooking = {
            id: `auto:${phase.id}`, projectId: 'schedule-preview', phaseId: phase.id,
            resourceType: 'team', resourceId: team.id, resourceName: team.name,
            memberIds: team.memberIds, discipline: phase.discipline,
            startDate: candidateStart, endDate: candidateEnd, allocationBps: 10000, status: 'tentative',
          };
          const collisions = detectBookingConflicts(candidate, [...existingBookings, ...generated]);
          if (!collisions.length) { placed = candidate; break; }
        }
        if (!placed) candidateStart = addCalendarDays(candidateStart, 1);
      }
      if (!placed) {
        scheduled.set(phase.id, { ...phase, plannedStart: null, plannedEnd: null, scheduleState: 'blocked', blocker: 'No conflict-free team slot found within two years.' });
        conflicts.push({ code: 'team_overlap', message: `No conflict-free slot found for ${phase.name}.`, phaseId: phase.id });
      } else {
        generated.push(placed);
        scheduled.set(phase.id, { ...phase, plannedStart: placed.startDate, plannedEnd: placed.endDate, assignedTeamId: placed.resourceId, scheduleState: 'scheduled', blocker: null });
      }
      remaining.delete(phase.id);
      madeProgress = true;
    }
    if (!madeProgress) {
      for (const phase of remaining.values()) {
        scheduled.set(phase.id, { ...phase, plannedStart: null, plannedEnd: null, scheduleState: 'blocked', blocker: 'Circular or missing phase dependency.' });
        conflicts.push({ code: 'dependency', message: `${phase.name} has a circular or missing dependency.`, phaseId: phase.id });
      }
      remaining.clear();
    }
  }

  const ordered = phases.map((phase) => scheduled.get(phase.id)!);
  const validDates = ordered.filter((phase) => phase.scheduleState === 'scheduled');
  return {
    phases: ordered,
    bookings: generated,
    conflicts,
    projectStart: validDates.length ? validDates.reduce((min, row) => row.plannedStart! < min ? row.plannedStart! : min, validDates[0]!.plannedStart!) : null,
    projectEnd: validDates.length ? validDates.reduce((max, row) => row.plannedEnd! > max ? row.plannedEnd! : max, validDates[0]!.plannedEnd!) : null,
  };
}

export interface HistoricalPerformance {
  discipline: InstallationDiscipline;
  liftType: string;
  minStops: number;
  maxStops: number;
  minCapacityKg: number;
  maxCapacityKg: number;
  sampleSize: number;
  averageCrewDays: number;
  medianCrewDays: number;
  suggestedCrewDays: number;
}

/** Only completed phases with explicitly recorded actual crew-days qualify. */
export function analyseInstallationHistory(
  rows: ReadonlyArray<{
    discipline: InstallationDiscipline;
    liftType: string;
    stops: number;
    capacityKg: number;
    actualCrewDays: number | null | undefined;
    status: string;
  }>,
): HistoricalPerformance[] {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    if (row.status !== 'completed' || !Number.isFinite(row.actualCrewDays) || (row.actualCrewDays ?? 0) <= 0) continue;
    const key = [row.discipline, row.liftType, row.stops, row.capacityKg].join('|');
    const values = groups.get(key) ?? [];
    values.push(row.actualCrewDays!);
    groups.set(key, values);
  }
  return [...groups.entries()].map(([key, values]) => {
    const [discipline, liftType, stops, capacityKg] = key.split('|');
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianCrewDays = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    const averageCrewDays = values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      discipline: discipline as InstallationDiscipline,
      liftType: liftType!,
      minStops: Number(stops), maxStops: Number(stops),
      minCapacityKg: Number(capacityKg), maxCapacityKg: Number(capacityKg),
      sampleSize: values.length, averageCrewDays, medianCrewDays,
      // Median is the robust starting recommendation; it remains a suggestion,
      // not an automatically published standard.
      suggestedCrewDays: medianCrewDays,
    };
  }).sort((a, b) => a.discipline.localeCompare(b.discipline) || a.liftType.localeCompare(b.liftType) || a.minStops - b.minStops);
}
