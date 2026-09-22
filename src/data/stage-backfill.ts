/**
 * Create the stage trackers the imported projects never got.
 *
 * The workbook import wrote clients, contracts, projects and lifts, but no
 * stages. A project with no stages has nothing to roll progress up from, so
 * every imported job reads 0% however much of it is built — and the board, the
 * schedule variance and the "finish next" list all rest on that figure.
 *
 * WHAT IT WILL NOT DO
 *   It never touches a project that already has stages. Not "merges with", not
 *   "tops up" — skips, and says it skipped. Those stages carry recorded
 *   progress, and recorded progress is somebody's work; a back-fill that can
 *   overwrite it is a back-fill nobody should be willing to run twice.
 *
 *   That makes it safe to run again: a second pass finds every project already
 *   has stages and writes nothing.
 *
 * WHAT IT ASSERTS
 *   Only what the workbook says. Stages behind the job are completed and their
 *   checkpoints ticked — stamped `WORKBOOK_SOURCE` rather than a person's id,
 *   because nobody signed them. The current stage is opened at zero, and where
 *   the workbook says nothing the tracker is created with nothing asserted.
 *   See `lib/stage-backfill.ts` for why.
 */

import { Timestamp, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db, toTimestamp } from '../firebase.js';
import { stampCreate, stampUpdate } from './audit.js';
import { collectionRef, newId } from './repository.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { checkpointsForStage } from '../lib/checkpoints.js';
import { templateStages } from '../lib/project-templates.js';
import {
  WORKBOOK_SOURCE,
  planStages,
  reachFor,
  rolledProgressBps,
  type BackfillOutcome,
} from '../lib/stage-backfill.js';
import type { ImportPlan } from '../lib/import-master.js';
import type { DualDate } from '../lib/schema.js';

/** Firestore caps a batch at 500 writes; the same headroom the importer keeps. */
const BATCH_LIMIT = 400;

/** Imported projects carry ids derived from the workbook key. */
const projectId = (key: string) => `im-p-${key}`;

/** The template an imported project's stages come from. All were lift work. */
const TEMPLATE_KEY = 'elevator_install';

export interface BackfillProgress {
  stage: string;
  examined: number;
  total: number;
}

export interface BackfillResult {
  /** Projects in the workbook that were looked at. */
  examined: number;
  /** Projects given a fresh set of stages. */
  backfilled: number;
  /** Stage documents written. */
  stagesCreated: number;
  /** Skipped because they already had stages — their progress is untouched. */
  alreadyHadStages: number;
  /** In the workbook but no longer in the app. */
  missing: number;
  /** Given a tracker with nothing asserted, because the workbook said nothing. */
  openedEmpty: number;
  outcomes: BackfillOutcome[];
}

/**
 * Give every imported project without stages a tracker.
 *
 * Reads the whole projects collection once and every project's phases once —
 * 163 jobs is 164 reads, against a write set that is only the projects that
 * actually need one.
 */
export async function backfillImportedStages(
  plan: ImportPlan,
  uid: string,
  onProgress: (progress: BackfillProgress) => void,
): Promise<BackfillResult> {
  const template = templateStages(TEMPLATE_KEY);
  const keys = template.map((stage) => stage.key);
  const weightByKey = new Map(template.map((stage) => [stage.key as string, stage.weightBps]));

  const result: BackfillResult = {
    examined: 0,
    backfilled: 0,
    stagesCreated: 0,
    alreadyHadStages: 0,
    missing: 0,
    openedEmpty: 0,
    outcomes: [],
  };

  const stored = new Map<string, Record<string, unknown>>();
  const snapshot = await getDocs(collectionRef('projects'));
  for (const document of snapshot.docs) stored.set(document.id, document.data());

  const total = plan.projects.length;
  let batch = writeBatch(db);
  let queued = 0;
  const flush = async () => {
    if (queued === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    queued = 0;
  };

  const now = Timestamp.now();
  const today: DualDate = dualDateFromGregorian(new Date(), toTimestamp, 'GC');

  for (const project of plan.projects) {
    const id = projectId(project.key);
    result.examined += 1;
    onProgress({ stage: 'Projects', examined: result.examined, total });

    const current = stored.get(id);
    if (current === undefined) {
      result.missing += 1;
      continue;
    }

    // One read per project, and the cheapest possible guard: if it has any
    // stage at all, it is not ours to touch.
    const existing = await getDocs(collectionRef(`projects/${id}/phases`));
    if (!existing.empty) {
      result.alreadyHadStages += 1;
      continue;
    }

    const reach = reachFor(project.sourceStage, String(current['status'] ?? ''));
    const planned = planStages(keys, reach);
    const plannedByKey = new Map(planned.map((stage) => [stage.key, stage]));
    const progressBps = rolledProgressBps(planned, weightByKey);

    const plannedStart = (current['plannedStart'] as DualDate | undefined) ?? today;
    const plannedEnd = (current['plannedEnd'] as DualDate | undefined) ?? today;

    template.forEach((stage, index) => {
      const decision = plannedByKey.get(stage.key);
      if (decision === undefined) return;

      const checkpoints = checkpointsForStage(stage.key).map((checkpoint) => ({
        ...checkpoint,
        // Stamped as coming from the workbook, never as a person's sign-off.
        ...(decision.tickCheckpoints
          ? { doneAt: now, doneBy: WORKBOOK_SOURCE }
          : { doneAt: null }),
      }));

      batch.set(doc(db, `projects/${id}/phases`, newId(`projects/${id}/phases`)), {
        seq: index + 1,
        key: stage.key,
        name: stage.name,
        weightBps: stage.weightBps,
        plannedStart,
        plannedEnd,
        actualStart: null,
        // Never dated: the workbook records no completion dates, and a
        // fabricated one would feed the phase-duration KPI a number nobody
        // measured.
        actualEnd: null,
        status: decision.status,
        progressBps: decision.progressBps,
        checkpoints,
        ...(stage.key === 'authority_inspection'
          ? {
              certification: {
                authority: 'Ministry of Urban & Infrastructure',
                applicationDate: null,
                inspectionDate: null,
                result: 'pending',
                attempts: 0,
                certificateIssuedDate: null,
                certificateExpiryDate: null,
              },
            }
          : {}),
        ...stampCreate(uid),
      });
      queued += 1;
      result.stagesCreated += 1;
    });

    // The first unfinished stage, so the job lands in the right board column.
    const nextStage = template.find(
      (stage) => (plannedByKey.get(stage.key)?.progressBps ?? 0) < 10_000,
    );

    batch.update(doc(db, 'projects', id), {
      templateKey: TEMPLATE_KEY,
      progressBps,
      currentStage:
        nextStage === undefined
          ? null
          : {
              key: nextStage.key,
              name: nextStage.name,
              plannedEnd,
              nextCheckpoint: checkpointsForStage(nextStage.key)[0]?.label ?? null,
            },
      ...stampUpdate(uid),
    });
    queued += 1;

    result.backfilled += 1;
    if (reach.kind === 'unknown') result.openedEmpty += 1;
    result.outcomes.push({
      projectNo: project.projectNo,
      title: project.title,
      sourceStage: (project.sourceStage ?? '').trim() || '(blank)',
      stagesCreated: template.length,
      stagesCompleted: planned.filter((stage) => stage.status === 'completed').length,
      progressBps,
      openedEmpty: reach.kind === 'unknown',
    });

    if (queued >= BATCH_LIMIT) await flush();
  }

  await flush();
  onProgress({ stage: 'done', examined: result.examined, total });
  return result;
}
