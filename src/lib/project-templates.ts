/**
 * Starting points for a project's stage list.
 *
 * The fourteen-stage elevator lifecycle was the only thing a project could be.
 * That is wrong twice over: a modernisation strips out an existing lift before
 * anything is installed, and IntelMotion's non-elevator work — a generator
 * install, a fit-out, an export consignment — shares almost none of it.
 *
 * A template is only ever a STARTING POINT. Every stage it produces can be
 * renamed, reweighted, reordered or deleted afterwards, and the weights
 * rebalance themselves. So a template that is 80% right is worth having; one
 * that has to be perfect would never be written.
 */

import { ELEVATOR_STAGE_TEMPLATE, type StageTemplateEntry } from './stages.js';
import { rescaleWeights, TOTAL_BPS } from './stage-edit.js';

export interface TemplateStage {
  key: string;
  name: string;
  weightBps: number;
  owner: StageTemplateEntry['owner'];
  description: string;
  /** Guidance for the contract form; the real link is set per contract. */
  commonlyGatesPayment: boolean;
}

export interface ProjectTemplate {
  key: string;
  name: string;
  /** What kind of job this fits, in the words a manager would use. */
  description: string;
  stages: readonly TemplateStage[];
}

function stage(
  key: string,
  name: string,
  weightBps: number,
  owner: StageTemplateEntry['owner'],
  description: string,
  commonlyGatesPayment = false,
): TemplateStage {
  return { key, name, weightBps, owner, description, commonlyGatesPayment };
}

const ELEVATOR_INSTALL: ProjectTemplate = {
  key: 'elevator_install',
  name: 'Elevator supply & installation',
  description: 'A new lift, from site inspection through manufacturing and customs to handover.',
  stages: ELEVATOR_STAGE_TEMPLATE.map((entry) => ({
    key: entry.key,
    name: entry.name,
    weightBps: entry.weightBps,
    owner: entry.owner,
    description: entry.description,
    commonlyGatesPayment: entry.commonlyGatesPayment,
  })),
};

/**
 * Modernisation.
 *
 * The removal is the part that goes wrong: an old lift comes out of a live
 * building, and the shaft is rarely what the drawings claim. Survey and strip-out
 * carry real weight here, where a new installation has almost none.
 */
const MODERNISATION: ProjectTemplate = {
  key: 'modernisation',
  name: 'Modernisation / upgrade',
  description: 'Replacing or upgrading a lift already in a building, including strip-out.',
  stages: [
    stage('survey', 'Survey & condition report', 500, 'us', 'Existing equipment assessed, shaft measured as built rather than as drawn.'),
    stage('scope_approval', 'Scope & approval', 400, 'client', 'What is being replaced agreed and signed off, including what stays.'),
    stage('manufacturing', 'Order & manufacturing', 800, 'supplier', 'New equipment ordered and built.', true),
    stage('shipping_customs', 'Shipping & customs clearance', 600, 'supplier', 'Freight, duty and clearance.'),
    stage('shutdown_agreement', 'Shutdown window agreed', 300, 'client', 'When the lift can be taken out of service, in a building still occupied.'),
    stage('strip_out', 'Strip-out & disposal', 1200, 'us', 'Old equipment removed and disposed of. The shaft is rarely what the drawings claim.', true),
    stage('shaft_remedials', 'Shaft remedial works', 900, 'us', 'Making good what strip-out exposed.'),
    stage('rail_installation', 'Guide rails & brackets', 1200, 'us', 'Rails, brackets, alignment and plumbing.'),
    stage('machine_controller', 'Machine, controller & ropes', 1300, 'us', 'Traction machine, controller cabinet, governor, ropes, counterweight.'),
    stage('cab_assembly', 'Cab & door assembly', 1200, 'us', 'Car frame, cab finishes, landing and car doors, fixtures.'),
    stage('wiring_commissioning', 'Wiring & commissioning', 800, 'us', 'Travelling cable, landing wiring, parameter setup, first movement.'),
    stage('testing', 'Testing & adjustment', 400, 'us', 'Load tests, safety gear, governor, levelling, snag list.', true),
    stage('authority_inspection', 'Authority inspection', 200, 'authority', 'Regulatory inspection and certificate.'),
    stage('handover', 'Handover & training', 200, 'us', 'Client training, documentation, defects liability starts.', true),
  ],
};

/**
 * Taking over maintenance of lifts someone else installed.
 *
 * Almost all risk sits in the first survey: inheriting a badly maintained lift
 * on a fixed monthly fee is how a maintenance contract loses money for three
 * years.
 */
const SERVICE_MOBILISATION: ProjectTemplate = {
  key: 'service_mobilisation',
  name: 'Service contract mobilisation',
  description: 'Taking over maintenance of existing lifts — survey, remedials, then routine service.',
  stages: [
    stage('site_survey', 'Take-on survey', 1500, 'us', 'Condition of every unit recorded BEFORE the contract starts. This is the stage that decides whether the contract makes money.'),
    stage('defect_report', 'Defect report & quotation', 1200, 'us', 'What needs fixing before we accept responsibility, priced.', true),
    stage('client_acceptance', 'Client acceptance of exclusions', 1000, 'client', 'Agreement on what we are and are not taking on.'),
    stage('remedial_works', 'Remedial works', 2500, 'us', 'Bringing inherited units to a serviceable standard.', true),
    stage('spares_stocking', 'Spares & documentation', 1000, 'us', 'Critical spares identified and stocked, manuals and wiring diagrams obtained.'),
    stage('unit_registration', 'Unit registration & tagging', 800, 'us', 'Every lift entered on the register with its own identity and history started.'),
    stage('first_pm_cycle', 'First planned maintenance cycle', 1500, 'us', 'The first full round of preventive visits completed.', true),
    stage('handover_to_service', 'Handover to routine service', 500, 'us', 'Contract live, schedule running, client briefed on the callout route.'),
  ],
};

/**
 * Everything that is not a lift.
 *
 * Deliberately generic and deliberately short. A template with the wrong twelve
 * stages is worse than one with the right six, because the wrong ones get
 * tolerated rather than deleted.
 */
const GENERAL_PROJECT: ProjectTemplate = {
  key: 'general',
  name: 'General project (non-elevator)',
  description: 'Any other job — fit-out, generator, civil works, an export consignment. Edit the stages to fit.',
  stages: [
    stage('scoping', 'Scoping & survey', 1000, 'us', 'What the job actually is, confirmed on site rather than on paper.'),
    stage('design_approval', 'Design & client approval', 1000, 'client', 'Proposal signed off.'),
    stage('procurement', 'Procurement', 1500, 'supplier', 'Ordering and lead time.', true),
    stage('logistics', 'Delivery & logistics', 1000, 'supplier', 'Freight, clearance where it applies, delivery to site.', true),
    stage('mobilisation', 'Mobilisation', 1000, 'us', 'Crew and materials on site, work formally started.', true),
    stage('execution', 'Main works', 2500, 'us', 'The bulk of the job.'),
    stage('testing', 'Testing & snagging', 1200, 'us', 'Proving it works and closing the snag list.', true),
    stage('handover', 'Handover & documentation', 800, 'us', 'Client acceptance, documentation, warranty starts.', true),
  ],
};

/**
 * One stage, nothing assumed.
 *
 * For a job that resembles nothing else. A project must have at least one stage
 * or it cannot report progress at all, so "blank" means one, not none.
 */
const BLANK: ProjectTemplate = {
  key: 'blank',
  name: 'Start from nothing',
  description: 'One stage covering the whole job. Add your own as the shape of the work becomes clear.',
  stages: [stage('delivery', 'Deliver the work', TOTAL_BPS, 'us', 'Replace this with the real stages once they are known.')],
};

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  ELEVATOR_INSTALL,
  MODERNISATION,
  SERVICE_MOBILISATION,
  GENERAL_PROJECT,
  BLANK,
];

export const DEFAULT_TEMPLATE_KEY = ELEVATOR_INSTALL.key;

export function projectTemplate(key: string): ProjectTemplate {
  return PROJECT_TEMPLATES.find((t) => t.key === key) ?? ELEVATOR_INSTALL;
}

/**
 * A template's stages, guaranteed to total exactly 100%.
 *
 * The templates above are hand-written and every one of them is checked by a
 * test, but a template is exactly the kind of thing someone edits in a hurry.
 * Rescaling here means a typo in a weight can never reach a project and silently
 * distort its progress figure.
 */
export function templateStages(key: string): TemplateStage[] {
  const template = projectTemplate(key);
  const weights = rescaleWeights(template.stages.map((s) => s.weightBps), TOTAL_BPS);
  return template.stages.map((stageEntry, index) => ({
    ...stageEntry,
    weightBps: weights[index] as number,
  }));
}
