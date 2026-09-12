/**
 * Project, phase and assignment repositories.
 *
 * Project progress is a derived figure: `updatePhaseProgress` recomputes the
 * weighted roll-up and writes both the phase and the project in one batch, so
 * the two can never disagree. Nobody sets `project.progressBps` directly.
 */

import {
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type {
  DualDate,
  ProjectAssignment,
  Project,
  ProjectPhase,
} from '../lib/schema.js';
import {
  derivePhaseStatus,
  ELEVATOR_PHASE_TEMPLATE,
  recordInspection,
  rollUpProgress,
  type CertificationResult,
  type PhaseStatus,
} from '../lib/phases.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { toTimestamp } from '../firebase.js';
import { stampCreate, stampUpdate, stripReserved } from './audit.js';
import { collectionRef, getMany, getOne, newId, subscribe, type WithId } from './repository.js';
import { db } from '../firebase.js';

const PATH = 'projects';
const ASSIGNMENTS = 'projectAssignments';
const phasePath = (projectId: string) => `${PATH}/${projectId}/phases`;

export type ProjectInput = Omit<
  Project,
  'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'progressBps' | 'financials'
>;

const EMPTY_FINANCIALS = {
  contractNetSantim: 0,
  contractVatSantim: 0,
  contractGrossSantim: 0,
  invoicedNetSantim: 0,
  collectedGrossSantim: 0,
  subcontractCostNetSantim: 0,
  subcontractInputVatSantim: 0,
  whtWithheldSantim: 0,
  cashDisbursedSantim: 0,
  grossMarginSantim: 0,
  grossMarginBps: 0,
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function subscribeProjects(
  onData: (rows: WithId<Project>[]) => void,
  onError: (error: Error) => void,
  options: { status?: Project['status'] } = {},
) {
  const q =
    options.status === undefined
      ? query(collectionRef(PATH), orderBy('plannedEnd.at'))
      : query(collectionRef(PATH), where('status', '==', options.status), orderBy('plannedEnd.at'));
  return subscribe<Project>(q, onData, onError);
}

export function getProject(id: string) {
  return getOne<Project>(PATH, id);
}

export function subscribePhases(
  projectId: string,
  onData: (rows: WithId<ProjectPhase>[]) => void,
  onError: (error: Error) => void,
) {
  return subscribe<ProjectPhase>(query(collectionRef(phasePath(projectId)), orderBy('seq')), onData, onError);
}

export function getPhases(projectId: string) {
  return getMany<ProjectPhase>(query(collectionRef(phasePath(projectId)), orderBy('seq')));
}

export function subscribeAssignments(
  projectId: string,
  onData: (rows: WithId<ProjectAssignment>[]) => void,
  onError: (error: Error) => void,
) {
  return subscribe<ProjectAssignment>(
    query(collectionRef(ASSIGNMENTS), where('projectId', '==', projectId), where('active', '==', true)),
    onData,
    onError,
  );
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Create a project and seed its phases in one batch.
 *
 * An elevator project gets the five standard phases; a non-elevator project gets
 * whatever the caller supplies. A project with no phases cannot report progress
 * at all, so it is never created without them.
 */
export async function createProject(
  input: ProjectInput,
  uid: string,
  options: { plannedStart: DualDate; plannedEnd: DualDate },
): Promise<string> {
  const projectId = newId(PATH);
  const batch = writeBatch(db);

  batch.set(doc(db, PATH, projectId), {
    ...stripReserved(input),
    progressBps: 0,
    financials: { ...EMPTY_FINANCIALS, lastComputedAt: Timestamp.now() },
    ...stampCreate(uid),
  });

  ELEVATOR_PHASE_TEMPLATE.forEach((template, index) => {
    batch.set(doc(db, phasePath(projectId), newId(phasePath(projectId))), {
      seq: index + 1,
      key: template.key,
      name: template.name,
      weightBps: template.weightBps,
      plannedStart: options.plannedStart,
      plannedEnd: options.plannedEnd,
      actualStart: null,
      actualEnd: null,
      status: 'not_started' satisfies PhaseStatus,
      progressBps: 0,
      // The certification block lives only on the inspection phase.
      ...(template.key === 'authority_inspection'
        ? {
            certification: {
              authority: 'Ministry of Urban & Infrastructure',
              applicationDate: null,
              inspectionDate: null,
              result: 'pending' satisfies CertificationResult,
              attempts: 0,
              certificateIssuedDate: null,
              certificateExpiryDate: null,
            },
          }
        : {}),
      ...stampCreate(uid),
    });
  });

  await batch.commit();
  return projectId;
}

/**
 * Update one phase's progress and re-roll the project total in the same batch.
 *
 * Reading the sibling phases first costs one query, and buys the guarantee that
 * `project.progressBps` is always the weighted roll-up of what is actually
 * stored — not a stale figure from whenever someone last remembered to refresh.
 */
export async function updatePhaseProgress(
  projectId: string,
  phaseId: string,
  progressBps: number,
  uid: string,
  options: { status?: PhaseStatus } = {},
): Promise<{ projectProgressBps: number }> {
  const clamped = Math.min(10_000, Math.max(0, Math.round(progressBps)));
  const phases = await getPhases(projectId);
  const current = phases.find((p) => p.id === phaseId);
  if (current === undefined) throw new Error('That phase no longer exists on this project.');

  const status = options.status ?? derivePhaseStatus(clamped, current.status);

  const projectProgressBps = rollUpProgress(
    phases.map((p) =>
      p.id === phaseId
        ? { key: p.key, weightBps: p.weightBps, progressBps: clamped, status }
        : { key: p.key, weightBps: p.weightBps, progressBps: p.progressBps, status: p.status },
    ),
  );

  const batch = writeBatch(db);
  // Built through the sanctioned builder, never as a literal: a hand-written
  // DualDate would leave the Ethiopian reporting cache empty or wrong, and
  // batch.update() is too loosely typed to catch it.
  const today = dualDateFromGregorian(new Date(), toTimestamp, 'GC');

  batch.update(doc(db, phasePath(projectId), phaseId), {
    progressBps: clamped,
    status,
    // Stamp the actual start the first time real work is recorded, and the
    // actual end when it completes — these feed the phase-duration KPI.
    ...(current.actualStart === null && clamped > 0 ? { actualStart: today } : {}),
    ...(status === 'completed' && current.actualEnd === null ? { actualEnd: today } : {}),
    ...stampUpdate(uid),
  });

  batch.update(doc(db, PATH, projectId), { progressBps: projectProgressBps, ...stampUpdate(uid) });

  await batch.commit();
  return { projectProgressBps };
}

export async function setPhaseBlocked(
  projectId: string,
  phaseId: string,
  blocked: boolean,
  currentProgressBps: number,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, phasePath(projectId), phaseId), {
    status: blocked ? 'blocked' : derivePhaseStatus(currentProgressBps, 'not_started'),
    ...stampUpdate(uid),
  });
}

/**
 * Record an authority inspection outcome.
 *
 * Attempts increment only on a real verdict, via `recordInspection` — re-saving
 * a pending record must not inflate the count, or the first-pass rate decays
 * every time someone edits the form.
 */
export async function recordInspectionResult(
  projectId: string,
  phaseId: string,
  current: { result: CertificationResult; attempts: number },
  result: Exclude<CertificationResult, 'pending'>,
  details: {
    certificateNo?: string;
    certificateIssuedDate?: DualDate | null;
    certificateExpiryDate?: DualDate | null;
    inspectionDate?: DualDate | null;
  },
  uid: string,
): Promise<void> {
  const next = recordInspection(
    { result: current.result, attempts: current.attempts, certificateExpiryDate: null },
    result,
  );

  await updateDoc(doc(db, phasePath(projectId), phaseId), {
    'certification.result': next.result,
    'certification.attempts': next.attempts,
    ...(details.certificateNo === undefined ? {} : { 'certification.certificateNo': details.certificateNo }),
    ...(details.inspectionDate === undefined ? {} : { 'certification.inspectionDate': details.inspectionDate }),
    ...(details.certificateIssuedDate === undefined ? {} : { 'certification.certificateIssuedDate': details.certificateIssuedDate }),
    ...(details.certificateExpiryDate === undefined ? {} : { 'certification.certificateExpiryDate': details.certificateExpiryDate }),
    ...stampUpdate(uid),
  });
}

export async function updateProject(id: string, input: Partial<ProjectInput>, uid: string): Promise<void> {
  await updateDoc(doc(db, PATH, id), { ...stripReserved(input), ...stampUpdate(uid) });
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export type AssignmentInput = Omit<
  ProjectAssignment,
  'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'
>;

/**
 * Assign a technician to a project.
 *
 * `allocationBps` is what weights this technician in the project's team score,
 * so it is validated here rather than trusted from a form field.
 */
export async function assignTechnician(input: AssignmentInput, uid: string): Promise<string> {
  if (!Number.isInteger(input.allocationBps) || input.allocationBps <= 0 || input.allocationBps > 10_000) {
    throw new Error('Allocation must be between 1% and 100%.');
  }
  const id = newId(ASSIGNMENTS);
  const batch = writeBatch(db);
  batch.set(doc(db, ASSIGNMENTS, id), { ...stripReserved(input), ...stampCreate(uid) });
  await batch.commit();
  return id;
}

export async function endAssignment(assignmentId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, ASSIGNMENTS, assignmentId), { active: false, ...stampUpdate(uid) });
}

/** Only a planned or cancelled project may be deleted; anything else is cancelled. */
export async function deleteProject(id: string): Promise<void> {
  const phases = await getDocs(query(collectionRef(phasePath(id))));
  const batch = writeBatch(db);
  for (const phase of phases.docs) batch.delete(phase.ref);
  await batch.commit();
  await deleteDoc(doc(db, PATH, id));
}
