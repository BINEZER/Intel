/**
 * The full elevator project lifecycle, from site inspection to handover.
 *
 * The original five phases covered only what happens inside the shaft. Most of
 * an Ethiopian elevator project's calendar — and most of its cash risk — sits
 * outside that: approvals, manufacturing lead time, shipping and customs
 * clearance. A project stuck in customs for six weeks was previously invisible,
 * because the tracker had nowhere to put it.
 *
 * STAGES GATE PAYMENTS. A milestone names the stage whose completion unlocks it
 * (`milestone.phaseId`), which is what lets the system answer the question that
 * actually matters to a manager: *which unfinished work is holding up the most
 * money?*
 */

export const ELEVATOR_STAGES = [
  'site_inspection',
  'design_approval',
  'manufacturing',
  'shipping_customs',
  'delivery_to_site',
  'site_preparation',
  'mobilisation',
  'rail_installation',
  'machine_controller',
  'cab_assembly',
  'wiring_commissioning',
  'testing',
  'authority_inspection',
  'handover',
] as const;

export type ElevatorStageKey = (typeof ELEVATOR_STAGES)[number];

export interface StageTemplateEntry {
  key: ElevatorStageKey;
  name: string;
  /** Share of project progress in bps. The template sums to 10000. */
  weightBps: number;
  dependsOn: readonly ElevatorStageKey[];
  description: string;
  /**
   * Who has to move for this stage to finish. Stages we do not control are the
   * ones that quietly eat a programme, so the tracker names the owner rather
   * than letting every delay look like the crew's fault.
   */
  owner: 'us' | 'client' | 'supplier' | 'authority';
  /**
   * True where a payment milestone is conventionally attached. Guidance for the
   * contract form, not a rule — the actual link is set per contract.
   */
  commonlyGatesPayment: boolean;
}

/**
 * Weights reflect effort and management attention, not calendar time.
 * Manufacturing and shipping are long but largely waiting; cab assembly is where
 * our crew actually lives. Adjustable per project.
 */
export const ELEVATOR_STAGE_TEMPLATE: readonly StageTemplateEntry[] = [
  {
    key: 'site_inspection',
    name: 'Site inspection & survey',
    weightBps: 200,
    dependsOn: [],
    owner: 'us',
    commonlyGatesPayment: false,
    description: 'Shaft measurement, site access, power availability, builder co-ordination.',
  },
  {
    key: 'design_approval',
    name: 'Shop drawings & approval',
    weightBps: 300,
    dependsOn: ['site_inspection'],
    owner: 'client',
    commonlyGatesPayment: false,
    description: 'Layout drawings issued and signed off by the client or consultant.',
  },
  {
    key: 'manufacturing',
    name: 'Order & manufacturing',
    weightBps: 400,
    dependsOn: ['design_approval'],
    owner: 'supplier',
    commonlyGatesPayment: true,
    description: 'Order placed with the factory and built. Long lead time, little we control.',
  },
  {
    key: 'shipping_customs',
    name: 'Shipping & customs clearance',
    weightBps: 400,
    dependsOn: ['manufacturing'],
    owner: 'supplier',
    commonlyGatesPayment: false,
    description: 'Freight, port handling, duty and clearance. A common and costly stall.',
  },
  {
    key: 'delivery_to_site',
    name: 'Delivery to site',
    weightBps: 300,
    dependsOn: ['shipping_customs'],
    owner: 'us',
    commonlyGatesPayment: true,
    description: 'Equipment delivered, checked against packing list, stored securely.',
  },
  {
    key: 'site_preparation',
    name: 'Site & shaft preparation',
    weightBps: 700,
    dependsOn: ['site_inspection'],
    owner: 'client',
    commonlyGatesPayment: false,
    description: 'Civil works, shaft plumb and dry, machine room ready, permanent power.',
  },
  {
    key: 'mobilisation',
    name: 'Mobilisation & start of installation',
    weightBps: 300,
    dependsOn: ['delivery_to_site', 'site_preparation'],
    owner: 'us',
    commonlyGatesPayment: true,
    description: 'Crew on site, scaffolding up, installation formally started.',
  },
  {
    key: 'rail_installation',
    name: 'Guide rails & brackets',
    weightBps: 1400,
    dependsOn: ['mobilisation'],
    owner: 'us',
    commonlyGatesPayment: false,
    description: 'Rails, brackets, alignment and plumbing of the shaft.',
  },
  {
    key: 'machine_controller',
    name: 'Machine, controller & ropes',
    weightBps: 1400,
    dependsOn: ['rail_installation'],
    owner: 'us',
    commonlyGatesPayment: false,
    description: 'Traction machine, controller cabinet, governor, ropes and counterweight.',
  },
  {
    key: 'cab_assembly',
    name: 'Cab & door assembly',
    weightBps: 1600,
    dependsOn: ['rail_installation'],
    owner: 'us',
    commonlyGatesPayment: false,
    description: 'Car frame, cab finishes, landing and car doors, fixtures.',
  },
  {
    key: 'wiring_commissioning',
    name: 'Wiring & commissioning',
    weightBps: 1100,
    dependsOn: ['machine_controller', 'cab_assembly'],
    owner: 'us',
    commonlyGatesPayment: false,
    description: 'Travelling cable, landing wiring, parameter setup, first movement.',
  },
  {
    key: 'testing',
    name: 'Testing & adjustment',
    weightBps: 700,
    dependsOn: ['wiring_commissioning'],
    owner: 'us',
    commonlyGatesPayment: true,
    description: 'Load tests, safety gear, overspeed governor, levelling, snag list.',
  },
  {
    key: 'authority_inspection',
    name: 'Authority inspection & certification',
    weightBps: 700,
    dependsOn: ['testing'],
    owner: 'authority',
    commonlyGatesPayment: false,
    description: 'Regulatory inspection and the certificate that gates handover.',
  },
  {
    key: 'handover',
    name: 'Handover & training',
    weightBps: 500,
    dependsOn: ['authority_inspection'],
    owner: 'us',
    commonlyGatesPayment: true,
    description: 'Client training, documentation, keys, defects liability period starts.',
  },
];

/**
 * The payment schedule these stages conventionally attach to, as a starting
 * point in the contract form. Percentages are typical Ethiopian supply-and-
 * install terms; the real split comes from the signed contract.
 */
export const TYPICAL_PAYMENT_STAGES: readonly {
  name: string;
  shareBps: number;
  stage: ElevatorStageKey | null;
}[] = [
  { name: 'Advance on signing', shareBps: 3000, stage: null },
  { name: 'On order & manufacturing', shareBps: 2000, stage: 'manufacturing' },
  { name: 'On delivery to site', shareBps: 2000, stage: 'delivery_to_site' },
  { name: 'On mobilisation', shareBps: 2000, stage: 'mobilisation' },
  { name: 'On testing complete', shareBps: 500, stage: 'testing' },
  { name: 'On handover (retention)', shareBps: 500, stage: 'handover' },
];

const BY_KEY = new Map(ELEVATOR_STAGE_TEMPLATE.map((s) => [s.key as string, s]));

export function stageTemplate(key: string): StageTemplateEntry | undefined {
  return BY_KEY.get(key);
}

export function stageName(key: string): string {
  return BY_KEY.get(key)?.name ?? key.replace(/_/g, ' ');
}

/** Who has to move for this stage. Unknown keys are assumed to be ours. */
export function stageOwner(key: string): StageTemplateEntry['owner'] {
  return BY_KEY.get(key)?.owner ?? 'us';
}

/**
 * Stages that are not ours to finish.
 *
 * Worth separating in any report: a project stalled in customs and a project
 * stalled because the crew has not turned up need completely different
 * interventions, and lumping them together hides both.
 */
export function isOurs(key: string): boolean {
  return stageOwner(key) === 'us';
}
