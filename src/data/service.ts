/**
 * Writing service work: callouts and preventive maintenance visits.
 *
 * The rules — which stage may follow which, what each stamps, and why a time is
 * refused — are in `lib/service-log.ts`. This is the Firestore half.
 *
 * WHY EVERY WRITE IS NARROW
 *   The security rules refuse to let `reportedAt`, `arrivedAt` or `resolvedAt`
 *   be changed once set. A write that sent the whole document back would carry
 *   those fields with it and be rejected, so each function here sends only the
 *   fields its own step is responsible for. That is not an optimisation: it is
 *   what makes the write legal.
 *
 * WHY THE SLA IS COPIED IN, NOT LOOKED UP
 *   Whether a callout breached is judged against the promise as it stood the day
 *   the call came in. Reading today's setting when the report is drawn would let
 *   raising the target turn last month's breaches into passes.
 */

import { Timestamp, doc, getDocs, limit, orderBy, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase.js';
import { stampCreate, stampUpdate } from './audit.js';
import { collectionRef, getMany, newId, subscribe, type WithId } from './repository.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { calloutDurations } from '../lib/kpi.js';
import { stampedByMove, type CalloutStage, type VisitStage } from '../lib/service-log.js';
import type { Callout, CalloutCategory, CalloutResolution, KpiTargets, MaintenanceVisit } from '../lib/schema.js';

const CALLOUTS = 'callouts';
const VISITS = 'maintenanceVisits';

const asTimestamp = (date: Date) => Timestamp.fromDate(date);
const asDual = (date: Date) => dualDateFromGregorian(date, asTimestamp);

/** `EC-2018-04` and `2026-03`, the keys the monthly rollups group on. */
function periodsFor(date: Date): { periodEc: string; periodGc: string } {
  const dual = asDual(date);
  return {
    periodEc: dual.ecPeriod,
    periodGc: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
  };
}

export interface NewCallout {
  unitTag: string;
  siteName: string;
  clientId: string;
  clientName: string;
  contractId: string;
  projectId: string | null;
  category: CalloutCategory;
  entrapment: boolean;
  description: string;
  reportedAt: Date;
  technicianId: string | null;
  technicianName: string | null;
}

/**
 * Log a callout.
 *
 * The number is taken from the count of calls in the same Ethiopian month rather
 * than from the shared counters collection: a callout number is a reference for
 * a conversation, not a financial sequence, and it must not be able to fail or
 * to block on a counter document when somebody is trying to record an
 * entrapment.
 */
export async function logCallout(input: NewCallout, targets: KpiTargets, uid: string): Promise<string> {
  const id = newId(CALLOUTS);
  const periods = periodsFor(input.reportedAt);
  const soFar = await getDocs(
    query(collectionRef(CALLOUTS), where('periodEc', '==', periods.periodEc)),
  );

  const assigned = input.technicianId !== null;
  const payload: Omit<Callout, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> = {
    calloutNo: `CO-${periods.periodEc.replace('EC-', '')}-${String(soFar.size + 1).padStart(3, '0')}`,
    contractId: input.contractId,
    clientId: input.clientId,
    clientName: input.clientName,
    projectId: input.projectId,
    unitTag: input.unitTag,
    siteName: input.siteName,
    category: input.category,
    entrapment: input.entrapment,
    description: input.description,
    technicianId: input.technicianId,
    technicianName: input.technicianName,
    reportedAt: asTimestamp(input.reportedAt),
    assignedAt: assigned ? asTimestamp(new Date()) : null,
    arrivedAt: null,
    resolvedAt: null,
    // Snapshotted, for the reason in the header.
    slaResponseMinutes: targets.responseSlaMinutes,
    slaResolutionMinutes: targets.resolutionSlaMinutes,
    responseMinutes: null,
    repairMinutes: null,
    breachedResponse: null,
    breachedResolution: null,
    resolution: null,
    firstTimeFix: null,
    repeatOfCalloutId: null,
    partsUsed: [],
    status: assigned ? 'assigned' : 'open',
    ...periods,
  };

  await setDoc(doc(db, CALLOUTS, id), { ...payload, ...stampCreate(uid) });
  return id;
}

/** Put a technician on a call that had none. */
export async function assignCallout(
  id: string,
  technician: { id: string; name: string },
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, CALLOUTS, id), {
    technicianId: technician.id,
    technicianName: technician.name,
    assignedAt: Timestamp.now(),
    status: 'assigned' satisfies CalloutStage,
    ...stampUpdate(uid),
  });
}

/** Record the technician on site. Written once; the rules refuse a second. */
export async function recordArrival(id: string, when: Date, uid: string): Promise<void> {
  await updateDoc(doc(db, CALLOUTS, id), {
    arrivedAt: asTimestamp(when),
    status: 'on_site' satisfies CalloutStage,
    ...stampUpdate(uid),
  });
}

/**
 * Record the lift back in service, and close the call.
 *
 * The derived figures are computed and stored here rather than left to the
 * reader. `calloutDurations` — the same function the KPI engine uses — is the
 * single place the arithmetic lives, so a report and a callout page can never
 * disagree about whether something breached.
 */
export async function resolveCallout(
  id: string,
  closing: {
    when: Date;
    reportedAt: Date;
    arrivedAt: Date;
    slaResponseMinutes: number | null;
    slaResolutionMinutes: number | null;
    resolution: CalloutResolution;
    firstTimeFix: boolean;
  },
  uid: string,
): Promise<void> {
  const derived = calloutDurations({
    id,
    technicianId: null,
    unitTag: '',
    entrapment: false,
    reportedAt: closing.reportedAt,
    arrivedAt: closing.arrivedAt,
    resolvedAt: closing.when,
    slaResponseMinutes: closing.slaResponseMinutes,
    slaResolutionMinutes: closing.slaResolutionMinutes,
    firstTimeFix: closing.firstTimeFix,
    status: 'resolved',
    repeatOfCalloutId: null,
  });

  await updateDoc(doc(db, CALLOUTS, id), {
    resolvedAt: asTimestamp(closing.when),
    status: 'resolved' satisfies CalloutStage,
    resolution: closing.resolution,
    firstTimeFix: closing.firstTimeFix,
    responseMinutes: derived.responseMinutes,
    repairMinutes: derived.repairMinutes,
    breachedResponse: derived.breachedResponse,
    breachedResolution: derived.breachedResolution,
    ...stampUpdate(uid),
  });
}

export async function cancelCallout(id: string, uid: string): Promise<void> {
  await updateDoc(doc(db, CALLOUTS, id), {
    status: 'cancelled' satisfies CalloutStage,
    ...stampUpdate(uid),
  });
}

export interface NewVisit {
  unitTag: string;
  siteName: string;
  clientId: string;
  contractId: string;
  scheduledFor: Date;
  technicianId: string | null;
  technicianName: string | null;
}

/** Put a preventive maintenance visit in the diary. */
export async function scheduleVisit(input: NewVisit, uid: string): Promise<string> {
  const id = newId(VISITS);
  const payload: Omit<MaintenanceVisit, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> = {
    contractId: input.contractId,
    clientId: input.clientId,
    unitTag: input.unitTag,
    siteName: input.siteName,
    technicianId: input.technicianId,
    technicianName: input.technicianName,
    scheduledDate: asDual(input.scheduledFor),
    completedDate: null,
    status: 'scheduled',
    checklistCompleteBps: 0,
    findings: [],
    durationMinutes: null,
    nextVisitDue: null,
    ...periodsFor(input.scheduledFor),
  };
  await setDoc(doc(db, VISITS, id), { ...payload, ...stampCreate(uid) });
  return id;
}

/**
 * Record a visit as carried out.
 *
 * `completedDate` is what PM on-time compliance is measured from, against the
 * date that was promised — which is why the scheduled date is never rewritten
 * here, and why the rules stop a technician changing it.
 */
export async function completeVisit(
  id: string,
  done: { when: Date; checklistCompleteBps: number; durationMinutes: number | null },
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, VISITS, id), {
    completedDate: asDual(done.when),
    status: 'completed' satisfies VisitStage,
    checklistCompleteBps: done.checklistCompleteBps,
    durationMinutes: done.durationMinutes,
    ...stampUpdate(uid),
  });
}

/** Record that a promised visit did not happen. It stays missed: see lib. */
export async function markVisitMissed(id: string, uid: string): Promise<void> {
  await updateDoc(doc(db, VISITS, id), {
    status: 'missed' satisfies VisitStage,
    ...stampUpdate(uid),
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Every callout in an Ethiopian month, for the KPI panel. */
export function subscribeCalloutsInPeriod(
  periodEc: string,
  onData: (rows: WithId<Callout>[]) => void,
  onError: (error: Error) => void,
) {
  return subscribe<Callout>(
    query(collectionRef(CALLOUTS), where('periodEc', '==', periodEc), orderBy('reportedAt', 'desc')),
    onData,
    onError,
  );
}

export function subscribeVisitsInPeriod(
  periodEc: string,
  onData: (rows: WithId<MaintenanceVisit>[]) => void,
  onError: (error: Error) => void,
) {
  return subscribe<MaintenanceVisit>(
    query(collectionRef(VISITS), where('periodEc', '==', periodEc), orderBy('scheduledDate.at', 'desc')),
    onData,
    onError,
  );
}

/** The calls still needing somebody, newest first. */
export function subscribeOpenCallouts(
  onData: (rows: WithId<Callout>[]) => void,
  onError: (error: Error) => void,
  max = 100,
) {
  return subscribe<Callout>(
    query(
      collectionRef(CALLOUTS),
      where('status', 'in', ['open', 'assigned', 'on_site']),
      orderBy('reportedAt', 'desc'),
      limit(max),
    ),
    onData,
    onError,
  );
}

/** Visits still in the diary, soonest first. */
export function subscribeScheduledVisits(
  onData: (rows: WithId<MaintenanceVisit>[]) => void,
  onError: (error: Error) => void,
  max = 100,
) {
  return subscribe<MaintenanceVisit>(
    query(
      collectionRef(VISITS),
      where('status', '==', 'scheduled'),
      orderBy('scheduledDate.at'),
      limit(max),
    ),
    onData,
    onError,
  );
}

/**
 * Every visit, for the alerts.
 *
 * Both halves of "is maintenance slipping" need the whole history: the soonest
 * scheduled visit says whether one is due, and the latest completed one says
 * whether a lift with nothing booked has slipped or was serviced last week.
 * Filtering to one status would answer only half the question.
 */
export function subscribeAllVisits(
  onData: (rows: WithId<MaintenanceVisit>[]) => void,
  onError: (error: Error) => void,
  max = 1000,
) {
  return subscribe<MaintenanceVisit>(
    query(collectionRef(VISITS), orderBy('scheduledDate.at', 'desc'), limit(max)),
    onData,
    onError,
  );
}

export async function listCalloutsInPeriod(periodEc: string) {
  return getMany<Callout>(
    query(collectionRef(CALLOUTS), where('periodEc', '==', periodEc), orderBy('reportedAt', 'desc')),
  );
}
