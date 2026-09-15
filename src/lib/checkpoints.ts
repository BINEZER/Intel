/**
 * What "60% done" actually means.
 *
 * THE PROBLEM THIS SOLVES
 *   A stage used to carry a percentage somebody typed in. Nobody can type an
 *   honest percentage for "Guide rails & brackets" — they look at the shaft,
 *   feel like it is most of the way there, and write 70. Next week they write
 *   75 because writing less would look like going backwards. The number drifts
 *   upward, every project sits at 90% for a month, and the schedule variance
 *   that the whole Priority page rests on is measuring somebody's optimism.
 *
 * THE RULE
 *   A checkpoint is a FACT, not a judgement. "Rails plumbed and aligned to
 *   tolerance" either has been signed off or has not. "Rails mostly done" is
 *   not a checkpoint. Everything below is written so that a supervisor standing
 *   in the building can answer yes or no without an opinion.
 *
 * HOW PROGRESS IS COMPUTED
 *   Stage progress = checkpoints ticked / checkpoints total. Project progress
 *   is the existing weighted roll-up of those stage figures. Nobody types a
 *   percentage anywhere.
 *
 *   Checkpoints within a stage weigh the same. Weighting them would be false
 *   precision — the stage weights already carry the judgement about what
 *   matters, and a second layer of weights invites the same drift this file
 *   exists to remove.
 *
 * STAGES WITHOUT CHECKPOINTS
 *   A stage somebody added by hand has none, and keeps the manual percentage.
 *   That is a deliberate escape hatch for non-elevator work, not the default.
 */

import type { ElevatorStageKey } from './stages.js';

export interface CheckpointTemplate {
  key: string;
  label: string;
}

/**
 * Objective checkpoints per installation stage.
 *
 * Three to five each. Fewer and the progress bar jumps in tenths; more and
 * nobody ticks them, which is worse than a typed percentage because it looks
 * like evidence.
 */
export const STAGE_CHECKPOINTS: Record<ElevatorStageKey, readonly CheckpointTemplate[]> = {
  site_inspection: [
    { key: 'shaft_measured', label: 'Shaft measured as built and recorded' },
    { key: 'power_confirmed', label: 'Power supply position and rating confirmed' },
    { key: 'access_agreed', label: 'Site access and storage agreed with the builder' },
    { key: 'report_issued', label: 'Survey report issued' },
  ],
  design_approval: [
    { key: 'drawings_issued', label: 'Shop drawings issued to the client' },
    { key: 'comments_closed', label: 'Client or consultant comments answered' },
    { key: 'drawings_signed', label: 'Drawings signed off in writing' },
  ],
  manufacturing: [
    { key: 'order_placed', label: 'Order placed with the factory' },
    { key: 'proforma_settled', label: 'Proforma settled and production slot confirmed' },
    { key: 'production_complete', label: 'Factory confirms production complete' },
    { key: 'ready_to_ship', label: 'Equipment released for shipping' },
  ],
  shipping_customs: [
    { key: 'shipped', label: 'Shipped — bill of lading received' },
    { key: 'arrived_port', label: 'Arrived at port' },
    { key: 'duty_paid', label: 'Duty assessed and paid' },
    { key: 'cleared', label: 'Cleared customs' },
  ],
  delivery_to_site: [
    { key: 'delivered', label: 'Delivered to site' },
    { key: 'checked_packing_list', label: 'Checked against the packing list' },
    { key: 'damage_recorded', label: 'Damage or shortage recorded (or confirmed none)' },
    { key: 'stored_secure', label: 'Stored securely on site' },
  ],
  site_preparation: [
    { key: 'shaft_complete', label: 'Shaft civil works complete' },
    { key: 'shaft_plumb_dry', label: 'Shaft plumb, dry and clear of obstruction' },
    { key: 'machine_room', label: 'Machine room ready and lockable' },
    { key: 'permanent_power', label: 'Permanent power available at the shaft' },
    { key: 'pit_ladder', label: 'Pit, ladder and lighting in place' },
  ],
  mobilisation: [
    { key: 'crew_assigned', label: 'Crew assigned and on site' },
    { key: 'scaffolding', label: 'Scaffolding or working platform up' },
    { key: 'tools_on_site', label: 'Tools and lifting gear on site' },
    { key: 'start_recorded', label: 'Installation start formally recorded with the client' },
  ],
  rail_installation: [
    { key: 'brackets_fixed', label: 'Brackets fixed at every landing' },
    { key: 'rails_erected', label: 'Guide rails erected full travel' },
    { key: 'aligned', label: 'Rails plumbed and aligned to tolerance' },
    { key: 'buffers_set', label: 'Buffers and pit steelwork set' },
  ],
  machine_controller: [
    { key: 'machine_set', label: 'Traction machine set and secured' },
    { key: 'controller_mounted', label: 'Controller cabinet mounted' },
    { key: 'ropes_reeved', label: 'Ropes reeved and tensioned' },
    { key: 'counterweight', label: 'Counterweight assembled and filled' },
    { key: 'governor_fitted', label: 'Overspeed governor fitted' },
  ],
  cab_assembly: [
    { key: 'car_frame', label: 'Car frame assembled and slung' },
    { key: 'cab_finishes', label: 'Cab walls, ceiling and floor finished' },
    { key: 'car_doors', label: 'Car door operator fitted and running' },
    { key: 'landing_doors', label: 'Landing doors fitted at every floor' },
    { key: 'fixtures', label: 'Car and landing fixtures fitted' },
  ],
  wiring_commissioning: [
    { key: 'travelling_cable', label: 'Travelling cable run and terminated' },
    { key: 'landing_wiring', label: 'Landing and shaft wiring complete' },
    { key: 'parameters_set', label: 'Controller parameters set' },
    { key: 'first_movement', label: 'First movement on normal control achieved' },
  ],
  testing: [
    { key: 'load_test', label: 'Load test passed at rated and 125% load' },
    { key: 'safety_gear', label: 'Safety gear and governor trip tested' },
    { key: 'levelling', label: 'Levelling and door timing adjusted at every floor' },
    { key: 'emergency', label: 'Emergency operation and alarm proven' },
    { key: 'snags_closed', label: 'Snag list closed out' },
  ],
  authority_inspection: [
    { key: 'application', label: 'Inspection applied for' },
    { key: 'inspected', label: 'Inspection attended' },
    { key: 'defects_closed', label: 'Inspector’s defects closed (or none raised)' },
    { key: 'certificate', label: 'Certificate issued' },
  ],
  handover: [
    { key: 'training', label: 'Client staff trained and attendance recorded' },
    { key: 'documents', label: 'Manuals, drawings and certificate handed over' },
    { key: 'keys', label: 'Keys and release tools handed over' },
    { key: 'acceptance_signed', label: 'Client acceptance signed — warranty starts here' },
  ],
};

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface Checkpoint {
  key: string;
  label: string;
  /** Null until somebody ticks it. The date is kept, not just the fact. */
  doneAt: unknown | null;
}

/** 0-10000. An empty list is 0, not 100 — nothing proven is not everything done. */
export function checkpointProgressBps(checkpoints: readonly Checkpoint[]): number {
  if (checkpoints.length === 0) return 0;
  const done = checkpoints.filter((c) => c.doneAt !== null).length;
  return Math.round((done / checkpoints.length) * 10_000);
}

export interface PhaseLike {
  key: string;
  progressBps: number;
  checkpoints?: readonly Checkpoint[];
}

/**
 * A phase's progress: from its checkpoints where it has them, otherwise the
 * stored figure.
 *
 * The fallback is what lets a hand-made stage on a non-elevator project keep
 * working. It is NOT a way back to typing percentages on an installation: the
 * checkpoints are seeded from the template when the project is created, so an
 * elevator stage always has them.
 */
export function phaseProgressBps(phase: PhaseLike): number {
  return phase.checkpoints !== undefined && phase.checkpoints.length > 0
    ? checkpointProgressBps(phase.checkpoints)
    : Math.min(10_000, Math.max(0, Math.round(phase.progressBps)));
}

/** Whether this phase's progress is a fact or somebody's estimate. */
export function isTracked(phase: PhaseLike): boolean {
  return phase.checkpoints !== undefined && phase.checkpoints.length > 0;
}

/** The checkpoints a stage starts life with. Empty for a non-template stage. */
export function checkpointsForStage(stageKey: string): CheckpointTemplate[] {
  const found = STAGE_CHECKPOINTS[stageKey as ElevatorStageKey];
  return found === undefined ? [] : found.map((c) => ({ ...c }));
}

/**
 * "3 of 5 checked", for a person reading a row.
 *
 * Deliberately a count rather than a percentage: the count says what is left to
 * do, and somebody can go and do those two things. A percentage says how you
 * should feel about it.
 */
export function describeCheckpoints(checkpoints: readonly Checkpoint[]): string {
  if (checkpoints.length === 0) return 'no checkpoints';
  const done = checkpoints.filter((c) => c.doneAt !== null).length;
  return `${done} of ${checkpoints.length} checked`;
}

/** The next unticked checkpoint — the thing to actually go and do. */
export function nextCheckpoint(checkpoints: readonly Checkpoint[]): Checkpoint | null {
  return checkpoints.find((c) => c.doneAt === null) ?? null;
}
