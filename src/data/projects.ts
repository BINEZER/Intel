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
  recordInspection,
  rollUpProgress,
  type CertificationResult,
  type PhaseStatus,
} from '../lib/phases.js';
import { DEFAULT_TEMPLATE_KEY, templateStages } from '../lib/project-templates.js';
import {
  addStage,
  diffStages,
  moveStage,
  normaliseWeights,
  removeStage,
  renameStage,
  setStageWeight,
  type EditableStage,
  type StageEditResult,
} from '../lib/stage-edit.js';
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

export const EMPTY_FINANCIALS = {
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
 * Create a project and seed its stages in one batch.
 *
 * The stage list comes from a TEMPLATE — elevator installation, modernisation,
 * service mobilisation, a general non-elevator job, or a single blank stage.
 * IntelMotion's work is not only lift installation, and a project forced into
 * the fourteen-stage lift lifecycle was a project whose progress figure meant
 * nothing.
 *
 * The template is only a starting point: every stage can be renamed, reweighted,
 * reordered or deleted afterwards, and the weights rebalance themselves.
 *
 * A project with no stages cannot report progress at all, so it is never created
 * without them.
 */
export async function createProject(
  input: ProjectInput,
  uid: string,
  options: { plannedStart: DualDate; plannedEnd: DualDate; templateKey?: string },
): Promise<string> {
  const projectId = newId(PATH);
  const batch = writeBatch(db);

  const templateKey = options.templateKey ?? DEFAULT_TEMPLATE_KEY;

  batch.set(doc(db, PATH, projectId), {
    ...stripReserved(input),
    templateKey,
    progressBps: 0,
    financials: { ...EMPTY_FINANCIALS, lastComputedAt: Timestamp.now() },
    ...stampCreate(uid),
  });

  // Weights arrive already rescaled to exactly 100%, so a typo in a template
  // cannot reach a project and silently distort its progress figure.
  templateStages(templateKey).forEach((template, index) => {
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

// ---------------------------------------------------------------------------
// Editing the stage list
// ---------------------------------------------------------------------------

/**
 * The standard fourteen stages fit a typical supply-and-install job. Real ones
 * differ: a machine-room-less lift skips half of the machine room work, a
 * refurbishment adds demolition, a job from local stock never sees customs.
 *
 * So the stage list is editable per project. Every edit runs through the pure
 * functions in `lib/stage-edit`, which keep the weights summing to exactly 100%,
 * and every edit re-rolls the project's progress in the same batch — because
 * changing what the stages weigh changes what "62% complete" means.
 */

/** The stored phase travels alongside the editable view, so a rewrite of the
 * weights can keep every field the edit functions do not care about. */
type EditablePhase = EditableStage & { source?: WithId<ProjectPhase> };

function toEditable(phase: WithId<ProjectPhase>): EditablePhase {
  return {
    id: phase.id,
    seq: phase.seq,
    key: phase.key,
    name: phase.name,
    weightBps: phase.weightBps,
    progressBps: phase.progressBps,
    source: phase,
  };
}

/**
 * Apply a pure stage edit and persist it.
 *
 * Writes only what actually moved — a rename touches one document, a reweight
 * touches the stages whose share changed — plus the project's re-rolled
 * progress. All in one batch, so the tracker and the dashboard can never
 * disagree about how complete a project is.
 */
async function commitStageEdit(
  projectId: string,
  uid: string,
  edit: (stages: EditablePhase[]) => StageEditResult<EditablePhase>,
): Promise<{ note: string; projectProgressBps: number }> {
  const phases = await getPhases(projectId);
  const before = phases.map(toEditable);

  const result = edit(before);
  if (!result.ok) throw new Error(result.error);

  const after = result.stages;
  const diff = diffStages(before, after);

  const projectProgressBps = rollUpProgress(
    after.map((s) => ({
      key: s.key,
      weightBps: s.weightBps,
      progressBps: s.progressBps,
      status: (s.source?.status ?? 'not_started') as PhaseStatus,
    })),
  );

  const batch = writeBatch(db);
  const path = phasePath(projectId);

  // A new stage inherits the project's planned window rather than being left
  // date-less: a stage with no planned end never reads as overdue, which is
  // precisely when a hand-added stage most needs to. Only read the project when
  // something was actually added — a rename should not cost an extra document.
  const window =
    diff.added.length === 0
      ? null
      : ((await getProject(projectId)) ?? { plannedStart: before[0]?.source?.plannedStart, plannedEnd: before[0]?.source?.plannedEnd });

  for (const stage of diff.added) {
    if (window?.plannedStart === undefined || window.plannedEnd === undefined) {
      throw new Error('This project has no planned dates, so a new stage has nothing to be scheduled against.');
    }
    batch.set(doc(db, path, stage.id), {
      seq: stage.seq,
      key: stage.key,
      name: stage.name,
      weightBps: stage.weightBps,
      plannedStart: window.plannedStart,
      plannedEnd: window.plannedEnd,
      actualStart: null,
      actualEnd: null,
      status: 'not_started' satisfies PhaseStatus,
      progressBps: 0,
      ...stampCreate(uid),
    });
  }

  for (const id of diff.removedIds) batch.delete(doc(db, path, id));

  for (const patch of diff.changed) {
    const { id, ...fields } = patch;
    batch.update(doc(db, path, id), { ...fields, ...stampUpdate(uid) });
  }

  batch.update(doc(db, PATH, projectId), { progressBps: projectProgressBps, ...stampUpdate(uid) });

  await batch.commit();
  return { note: result.note, projectProgressBps };
}

/** Add a stage this project needs that the standard template does not have. */
export function addProjectStage(
  projectId: string,
  input: { name: string; weightBps: number; afterId: string | null },
  uid: string,
) {
  const path = phasePath(projectId);
  const id = newId(path);
  // Custom stages get their own key namespace so they can never collide with a
  // template key, whose name and owner the reports look up by key.
  const key = `custom_${id.slice(0, 8)}`;
  return commitStageEdit(projectId, uid, (stages) =>
    addStage(
      stages,
      { id, key, name: input.name, weightBps: input.weightBps, afterId: input.afterId },
      (base) => ({ ...base }),
    ),
  );
}

/**
 * Delete a stage. `lockedBy` names payment milestones tied to it — the caller
 * looks those up, because the repository has no business querying contracts.
 */
export function removeProjectStage(
  projectId: string,
  phaseId: string,
  uid: string,
  lockedBy: readonly string[] = [],
) {
  return commitStageEdit(projectId, uid, (stages) => removeStage(stages, phaseId, lockedBy));
}

export function renameProjectStage(projectId: string, phaseId: string, name: string, uid: string) {
  return commitStageEdit(projectId, uid, (stages) => renameStage(stages, phaseId, name));
}

export function setProjectStageWeight(projectId: string, phaseId: string, weightBps: number, uid: string) {
  return commitStageEdit(projectId, uid, (stages) => setStageWeight(stages, phaseId, weightBps));
}

export function moveProjectStage(projectId: string, phaseId: string, direction: 'up' | 'down', uid: string) {
  return commitStageEdit(projectId, uid, (stages) => moveStage(stages, phaseId, direction));
}

/** Escape hatch for a stage set whose weights have drifted off 100%. */
export function normaliseProjectStageWeights(projectId: string, uid: string) {
  return commitStageEdit(projectId, uid, (stages) => normaliseWeights(stages));
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

/** Change only the status, without touching the phases or the rollup. */
export async function updateProjectStatus(
  id: string,
  status: Project['status'],
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, PATH, id), { status, ...stampUpdate(uid) });
}
