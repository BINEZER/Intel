/**
 * Firestore schema for IntelMotion PCM.
 *
 * CONVENTIONS (enforced by these types; see docs/01-firestore-schema.md)
 *   1. Money   -> integer santim,       field suffix `...Santim`
 *   2. Rates   -> integer basis points, field suffix `...Bps`
 *   3. Instants-> Gregorian UTC Timestamp, always. Never store an EC date as the source of truth.
 *   4. Dates the user picked -> `DualDate`, which carries the GC timestamp PLUS a
 *      denormalized EC triple for display and EC-period reporting, PLUS which
 *      calendar the user actually typed in (for round-tripping the edit form).
 *   5. Every document carries `createdAt`/`updatedAt`/`createdBy` for the audit trail.
 */

/** Firestore Timestamp, structurally typed so this file stays SDK-agnostic. */
import type { ClientStatus, ContractStatusValue, ProjectStatusValue } from './status.js';

export interface Timestamp {
  toDate(): Date;
  toMillis(): number;
  seconds: number;
  nanoseconds: number;
}

export type CalendarSystem = 'GC' | 'EC';

/**
 * A user-entered calendar date.
 *
 * `at` is the single source of truth (00:00 UTC on the chosen day). `ec` is a
 * derived cache written by the client on every save — it exists so we can query
 * "all invoices in Tir 2018 EC" with a single equality filter instead of a
 * range scan plus in-memory conversion. It MUST be recomputed whenever `at`
 * changes; `assertDualDateConsistent()` guards this in tests.
 */
export interface DualDate {
  at: Timestamp;
  ec: { year: number; month: number; day: number };
  /** `EC-2018-04` — the reporting period key derived from `ec`. */
  ecPeriod: string;
  /** Ethiopian fiscal year (1 Hamle - 30 Sene), named for the year it ends in. */
  ecFiscalYear: number;
  /** Which picker the user typed into. Purely for re-opening the form in the same mode. */
  enteredIn: CalendarSystem;
}

/**
 * Foreign-currency provenance.
 *
 * Attached to any document that may be raised in a currency other than ETB.
 * The document's `...Santim` fields remain the ETB figures and stay the source
 * of truth for VAT, WHT and every return — this block records what was actually
 * invoiced and the rate that produced the ETB equivalent.
 *
 * The rate is snapshotted here and never looked up at read time: the birr
 * floats, and a report that re-converted at today's rate would silently rewrite
 * a return that has already been filed.
 */
export interface ForeignAmount {
  /** 'ETB' when the document is native; then `amount` equals the ETB figure. */
  currency: 'ETB' | 'USD';
  /** Integer minor units in `currency` — cents for USD. */
  amount: number;
  /** ETB per 1 unit of `currency`, in micros. Exactly 1_000_000 for ETB. */
  rateMicros: number;
  /** The day the rate applied, so the ETB figure is reproducible. */
  rateDate: Timestamp;
  /** e.g. "NBE daily", "Commercial Bank of Ethiopia", "contract rate". */
  rateSource: string;
}

export interface AuditFields {
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Firebase Auth uid. */
  createdBy: string;
  updatedBy: string;
}

// ===========================================================================
// config/{docId} — singletons, admin-writable only
// ===========================================================================

/** `config/tax` */
export interface TaxConfig {
  vatRateBps: number;                 // 1500
  whtGoodsBps: number;                // 200
  whtServicesBps: number;             // 300
  whtNoTinBps: number;                // 3000
  whtGoodsThresholdSantim: number;    // 1_000_000 (= ETB 10,000)
  whtServicesThresholdSantim: number; //   300_000 (= ETB  3,000)
  /** The company's own TIN and VAT registration, printed on every invoice. */
  companyTin: string;
  companyVatRegNo: string;
  /** Effective-from, so historical documents keep the rate they were issued under. */
  effectiveFrom: DualDate;
}

// ===========================================================================
// clients/{clientId}
// ===========================================================================

export interface Client extends AuditFields {
  name: string;
  nameAm?: string;
  tin: string;
  vatRegistered: boolean;
  vatRegNo?: string;
  address: { city: string; subCity?: string; woreda?: string; kebele?: string; poBox?: string; street?: string; landmark?: string };
  contacts: Array<{ name: string; role?: string; phone: string; email?: string }>;
  /** See `CLIENT_STATUSES` in lib/status.ts for what each one means. */
  status: ClientStatus;
  notes?: string;
}

// ===========================================================================
// contracts/{contractId}
// ===========================================================================

export type ContractType = 'supply_install' | 'maintenance' | 'modernization' | 'other';
/** See `CONTRACT_STATUSES` in lib/status.ts for what each one means. */
export type ContractStatus = ContractStatusValue;

/**
 * A date somebody wants to be warned about before it arrives.
 *
 * The system already knows about contract expiry and renewal windows, but those
 * are the two dates it happens to model. Real jobs carry others: a warranty
 * running out, a performance bond to release, a permit to renew, a price
 * escalation clause that bites on a date. None of them announce themselves, and
 * all of them cost money when missed.
 *
 * `leadDays` is the whole point. A warning on the day is not a warning.
 */
export interface Reminder {
  id: string;
  label: string;
  dueDate: DualDate;
  /** Days before `dueDate` the alert starts firing. */
  leadDays: number;
  /** Set when somebody has dealt with it, so it stops appearing. */
  doneAt: Timestamp | null;
  note?: string;
}

export interface Contract extends AuditFields {
  contractNo: string;
  type: ContractType;
  clientId: string;
  /** Denormalized for list views; refreshed by a Cloud Function on client rename. */
  clientName: string;
  projectId?: string;
  title: string;

  /** Always 'ETB' — the figures below are the ETB amounts tax is computed on. */
  currency: 'ETB';
  /** Present when the contract was priced in a foreign currency. */
  foreign?: ForeignAmount;
  /** VAT-exclusive contract value, in ETB. */
  valueNetSantim: number;
  vatRateBps: number;
  vatSantim: number;
  /** valueNetSantim + vatSantim. Denormalized so reports never recompute. */
  valueGrossSantim: number;
  /** True when the negotiated figure was VAT-inclusive and the net was backed out. */
  valueEnteredInclusive: boolean;

  signedDate: DualDate;
  startDate: DualDate;
  endDate: DualDate;

  // --- renewal (maintenance contracts) ---
  autoRenew: boolean;
  /** How many days before `endDate` the renewal alert fires. */
  renewalWindowDays: number;
  /** Precomputed `endDate - renewalWindowDays` so the alert query is one range filter. */
  renewalAlertAt: Timestamp | null;
  renewalStatus: 'not_due' | 'due' | 'in_negotiation' | 'renewed' | 'lapsed';
  renewedIntoContractId?: string;

  // --- SLA (maintenance contracts) ---
  sla?: {
    responseHours: number;
    resolutionHours: number;
    preventiveVisitsPerYear: number;
    /** Rolling metrics maintained by a Cloud Function off the callouts subcollection. */
    metrics: {
      callouts: number;
      breaches: number;
      avgResponseHours: number;
      visitsCompletedThisYear: number;
      lastComputedAt: Timestamp;
    };
  };

  // --- warranty / defects liability ------------------------------------
  /**
   * The period after handover during which we fix our own defects for free.
   * Tracked separately from the contract term because it usually starts when
   * the contract's delivery obligations END, and an expiring warranty is the
   * moment to inspect, not the moment to discover a claim.
   */
  warranty?: {
    months: number;
    /** Usually handover. Null until the project actually hands over. */
    startsOn: DualDate | null;
    endsOn: DualDate | null;
    /** Days before `endsOn` to start warning. */
    alertDays: number;
  };

  /**
   * The service agreement that took over when this contract's warranty ended.
   *
   * An installation contract does not simply stop: either it becomes a paying
   * maintenance agreement or the client declines. Both outcomes are recorded,
   * because "neither" is the state where we service lifts for nothing.
   */
  succeededByContractId?: string | null;
  /** The installation contract this service agreement grew out of. */
  supersedesContractId?: string;
  /** Set where the client was offered service after warranty and said no. */
  serviceDeclined?: boolean;

  /** Maintenance contracts are priced per month, not as a lump sum. */
  serviceFee?: {
    monthlyNetSantim: number;
    /** How many lifts the fee covers, so a per-lift rate can be read off it. */
    unitCount: number;
  };

  /** Dates on this contract somebody wants warning about. */
  reminders?: Reminder[];

  status: ContractStatus;
  attachments: Array<{ name: string; storagePath: string; uploadedAt: Timestamp }>;
}

/** contracts/{contractId}/milestones/{milestoneId} */
export interface PaymentMilestone extends AuditFields {
  seq: number;
  name: string;              // "Advance", "On delivery to site", "On handover"
  /** Ties the milestone to the phase whose completion triggers it. */
  phaseId?: string;
  /** Share of contract value, in bps. All milestones on a contract must sum to 10000. */
  shareBps: number;
  netSantim: number;
  vatSantim: number;
  grossSantim: number;
  dueDate: DualDate | null;
  status: 'pending' | 'ready_to_invoice' | 'invoiced' | 'paid' | 'waived';
  invoiceId?: string;
}

// ===========================================================================
// projects/{projectId}
// ===========================================================================

export type ProjectType = 'elevator' | 'non_elevator';

/** The five standard elevator phases. Non-elevator projects use free-form phases. */
export const ELEVATOR_PHASES = [
  'shaft_prep',
  'rail_installation',
  'cab_assembly',
  'testing',
  'authority_inspection',
] as const;
export type ElevatorPhaseKey = (typeof ELEVATOR_PHASES)[number];

export interface Project extends AuditFields {
  projectNo: string;
  type: ProjectType;
  title: string;
  clientId: string;
  clientName: string;
  contractId: string | null;
  /**
   * The program this project belongs to, where it is part of something larger.
   * A tower with four lifts is four projects and one commitment.
   */
  programId?: string | null;
  /**
   * The project this one sits under.
   *
   * A tower is one job commercially and several jobs operationally — per block,
   * per lift, per phase — each with its own crew, stages and dates. A parent
   * holds the commitment; the children hold the work. A project may not be its
   * own parent, and the tree is deliberately ONE level deep: a sub-project with
   * sub-projects of its own is a program, and there is already a Programs page
   * for that.
   */
  parentProjectId?: string | null;
  /** Which stage template it was created from. Stages are editable afterwards. */
  templateKey?: string;
  /** Dates on this project somebody wants warning about. */
  reminders?: Reminder[];

  /**
   * Where the work is. `city` alone is not a location anyone can drive to, and
   * a crew sent to the wrong Bole tower loses a day.
   */
  site: {
    name: string;
    city: string;
    subCity?: string;
    woreda?: string;
    /** Street, building, floor — how you would tell a driver. */
    address?: string;
    /** "Opposite Edna Mall" does more work than a street name in Addis. */
    landmark?: string;
    gps?: { lat: number; lng: number };
  };

  /** Elevator units under this project; empty for non-elevator work. */
  /**
   * The lifts under this project. Each carries its own identity because a lift
   * outlives the project that installed it: maintenance contracts, callouts and
   * authority certificates all attach to the UNIT, not the job.
   */
  units: Array<{
    /** Our reference on site, e.g. "LIFT-01". */
    tag: string;
    /** The manufacturer's unit id / equipment number — the one on the nameplate. */
    unitId?: string;
    serialNo?: string;
    brand?: string;
    model?: string;
    capacityKg?: number;
    personCapacity?: number;
    speedMps?: number;
    stops?: number;
    /** Passenger, goods, bed, panoramic, escalator. */
    type?: string;
    /** Where in the building, e.g. "Block B, core 2". */
    location?: string;
    /** Per-unit progress, for a project where the shafts run at different speeds. */
    status?: 'not_started' | 'in_progress' | 'testing' | 'commissioned' | 'handed_over';
  }>;

  plannedStart: DualDate;
  plannedEnd: DualDate;
  actualStart: DualDate | null;
  actualEnd: DualDate | null;

  /** See `PROJECT_STATUSES` in lib/status.ts for what each one means. */
  status: ProjectStatusValue;
  /** 0-10000 bps, rolled up from phase weights by a Cloud Function. */
  progressBps: number;

  /** Denormalized financial rollup; recomputed on disbursement/invoice writes. */
  financials: {
    contractNetSantim: number;
    contractVatSantim: number;
    contractGrossSantim: number;
    invoicedNetSantim: number;
    collectedGrossSantim: number;
    subcontractCostNetSantim: number;
    subcontractInputVatSantim: number;
    whtWithheldSantim: number;
    cashDisbursedSantim: number;
    grossMarginSantim: number;
    grossMarginBps: number;
    lastComputedAt: Timestamp;
  };
}

/** projects/{projectId}/phases/{phaseId} */
export interface ProjectPhase extends AuditFields {
  seq: number;
  key: ElevatorPhaseKey | string;
  name: string;
  /** Share of project progress, in bps. Phases on a project must sum to 10000. */
  weightBps: number;
  plannedStart: DualDate;
  plannedEnd: DualDate;
  actualStart: DualDate | null;
  actualEnd: DualDate | null;
  status: 'not_started' | 'in_progress' | 'blocked' | 'completed';
  /**
   * 0-10000. DERIVED from `checkpoints` wherever a stage has them, which is
   * every stage on an elevator project. Only a hand-made stage on other work
   * keeps a figure somebody typed. See lib/checkpoints.ts for why.
   */
  progressBps: number;
  /**
   * The facts that make up this stage, each either signed off or not.
   *
   * Absent on a stage added by hand, which then falls back to the stored
   * percentage.
   */
  checkpoints?: Array<{
    key: string;
    label: string;
    /** Null until it is ticked. The instant is kept, not just the fact. */
    doneAt: Timestamp | null;
    doneBy?: string;
  }>;
  assigneeUid?: string;

  /**
   * Present only on the `authority_inspection` phase. Tracks the Ministry /
   * regulatory certification that gates handover.
   */
  certification?: {
    authority: string;              // e.g. "Ministry of Urban & Infrastructure"
    applicationDate: DualDate | null;
    inspectionDate: DualDate | null;
    result: 'pending' | 'passed' | 'failed_rework' | 'not_applicable';
    /**
     * How many times the authority has inspected. First-pass rate is derived
     * from this, so it increments only on a real verdict — never on a re-save
     * of a pending record.
     */
    attempts: number;
    certificateNo?: string;
    certificateIssuedDate: DualDate | null;
    certificateExpiryDate: DualDate | null;
    storagePath?: string;
  };
}

// ===========================================================================
// invoices/{invoiceId} — revenue side, VAT OUTPUT
// ===========================================================================

export interface Invoice extends AuditFields {
  invoiceNo: string;
  /** Fiscal (machine) receipt number required on VAT invoices. */
  fsNo?: string;
  clientId: string;
  clientName: string;
  clientTin: string;
  contractId: string | null;
  projectId: string | null;
  milestoneId: string | null;

  issueDate: DualDate;
  dueDate: DualDate;

  /** Always 'ETB'. A VAT invoice is declared in ETB whatever was quoted. */
  currency: 'ETB';
  /** Present when the client was quoted in a foreign currency. */
  foreign?: ForeignAmount;
  lines: Array<{
    description: string;
    qty: number;
    unitNetSantim: number;
    lineNetSantim: number;
    /** Zero-rated / exempt lines carry 0 here. */
    vatRateBps: number;
  }>;
  netSantim: number;
  vatRateBps: number;
  vatSantim: number;
  grossSantim: number;

  paidGrossSantim: number;
  balanceGrossSantim: number;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void';

  /** `EC-2018-04`, copied from issueDate for one-filter VAT-return queries. */
  vatPeriodEc: string;
  /** `2025-12`, for cross-checking against the Gregorian filing calendar. */
  vatPeriodGc: string;
}

/** invoices/{invoiceId}/receipts/{receiptId} */
export interface Receipt extends AuditFields {
  receivedDate: DualDate;
  amountGrossSantim: number;
  method: 'bank_transfer' | 'cheque' | 'cash' | 'cpo' | 'other';
  bankRef?: string;
  /**
   * Withholding the CLIENT applied to us (common with government and large
   * clients). Recorded so we can claim it against our own income tax.
   */
  clientWhtSantim: number;
  clientWhtCertificateNo?: string;
}

/**
 * invoices/{invoiceId}/collectionSteps/{stepId}
 *
 * The chase. An ageing report says an invoice is 74 days old; it does not say
 * whether anyone asked for the money, whether the letter reached the right desk,
 * or whether the client promised to pay on a date that has since passed. Those
 * are the facts that decide what to do next.
 */
export interface CollectionStep extends AuditFields {
  action:
    | 'payment_request'
    | 'letter_delivered'
    | 'follow_up_call'
    | 'follow_up_visit'
    | 'promise_to_pay'
    | 'dispute_raised'
    | 'escalation'
    | 'legal_notice'
    | 'part_payment'
    | 'payment_received'
    | 'written_off';
  at: DualDate;
  /** Who did it, on our side. */
  byName: string;
  /** Who it went to, on theirs. */
  contactName: string;
  /** What was said, what was handed over, the reference on the stamped copy. */
  note: string;
  /** On `promise_to_pay`: what they committed to, and by when. */
  promisedAmountSantim?: number;
  promisedDate?: DualDate;
  /** On `letter_delivered`: their reference on the received copy. */
  deliveryRef?: string;
  /** Where a scan of the stamped letter lives. */
  storagePath?: string;
}

// ===========================================================================
// subcontractors/{subcontractorId}
// ===========================================================================

export interface Subcontractor extends AuditFields {
  name: string;
  tin: string;
  /** Drives the 30% penalty WHT rate when false. */
  hasTin: boolean;
  vatRegistered: boolean;
  vatRegNo?: string;
  defaultWhtCategory: 'goods' | 'services' | 'exempt';
  trades: string[];               // ["shaft civil works", "electrical"]
  bank: { name: string; accountName: string; accountNo: string };
  contacts: Array<{ name: string; phone: string; email?: string }>;
  status: 'active' | 'suspended' | 'blacklisted';
}

// ===========================================================================
// disbursements/{disbursementId} — payment side, VAT INPUT + WHT
// ===========================================================================

export interface Disbursement extends AuditFields {
  /** Our internal payment voucher number. */
  voucherNo: string;
  subcontractorId: string;
  subcontractorName: string;
  subcontractorTin: string;
  projectId: string;
  /** The phase this payment is against — the core of phase-by-phase disbursement. */
  phaseId: string;
  phaseName: string;

  /** The subcontractor's invoice we are paying. */
  supplierInvoiceNo: string;
  supplierInvoiceDate: DualDate;
  paymentDate: DualDate | null;

  /** Always 'ETB' — WHT and input VAT are computed on the ETB figures. */
  currency: 'ETB';
  /**
   * Present when the subcontractor or supplier invoiced in a foreign currency —
   * the usual case for imported equipment. `netSantim` below is its ETB
   * equivalent at `foreign.rateMicros`, and that is what WHT is charged on.
   */
  foreign?: ForeignAmount;
  /** VAT-exclusive base in ETB. WHT is computed on this, never on the gross. */
  netSantim: number;
  vatRateBps: number;
  /** Input VAT, reclaimable. Zero when the subcontractor is not VAT-registered. */
  supplierVatSantim: number;
  /** Face value of the supplier invoice. */
  grossSantim: number;

  whtCategory: 'goods' | 'services' | 'exempt';
  whtRateBps: number;
  whtBaseSantim: number;
  whtSantim: number;
  /** Cash out of the bank: grossSantim - whtSantim. */
  netPayableSantim: number;
  whtExemptReason?: 'below_threshold' | 'category_exempt';
  /** Certificate we must issue to the subcontractor for the amount withheld. */
  whtCertificateNo?: string;
  whtRemittedDate: DualDate | null;

  /**
   * Where the voucher is in the payout workflow.
   *
   * `requested` and `checked` sit between draft and approval because a voucher
   * that has been submitted and a voucher nobody has looked at are completely
   * different things to a subcontractor waiting for money.
   */
  status: 'draft' | 'requested' | 'checked' | 'approved' | 'paid' | 'rejected' | 'on_hold' | 'void';

  /**
   * When each step happened and who did it.
   *
   * Waiting time is computed from THESE stamps, never from `updatedAt`, which
   * moves whenever anyone touches the record for any reason. Separation of
   * duties is enforced against `checkedBy`: the person who confirmed the work
   * happened may not be the person who releases the money for it.
   */
  workflow: {
    requestedAt: Timestamp | null;
    requestedBy: string | null;
    checkedAt: Timestamp | null;
    checkedBy: string | null;
    approvedAt: Timestamp | null;
    approvedBy: string | null;
    paidAt: Timestamp | null;
    paidBy: string | null;
    rejectedAt: Timestamp | null;
    rejectedBy: string | null;
    heldAt: Timestamp | null;
    heldBy: string | null;
    /** Why it was rejected or put on hold. Required for either. */
    reason: string | null;
  };

  approvedBy?: string;
  paymentMethod?: 'bank_transfer' | 'cheque' | 'cash' | 'cpo';
  bankRef?: string;

  /** Period keys for the monthly WHT return. */
  whtPeriodEc: string;
  whtPeriodGc: string;
}

// ===========================================================================
// boards/{boardId} + tasks/{taskId} — managerial Kanban
// ===========================================================================

export interface Board extends AuditFields {
  name: string;
  scope: 'admin' | 'project' | 'finance' | 'sales';
  columns: Array<{ id: string; name: string; order: number; wipLimit?: number }>;
  archived: boolean;
}

export interface Task extends AuditFields {
  boardId: string;
  columnId: string;
  /** Sparse ordering key so drag-and-drop reorders touch one document. */
  order: number;
  title: string;
  description?: string;
  assigneeUid: string | null;
  dueDate: DualDate | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  labels: string[];
  /** Optional links back into the domain. */
  projectId?: string;
  phaseId?: string;
  contractId?: string;
  checklist: Array<{ text: string; done: boolean }>;
  completedAt: Timestamp | null;
  archived: boolean;
}

// ===========================================================================
// users/{uid} + auditLogs/{logId}
// ===========================================================================

export type Role = 'admin' | 'manager' | 'finance' | 'engineer' | 'viewer';

export interface UserProfile extends AuditFields {
  email: string;
  displayName: string;
  role: Role;
  /** Mirrored into a custom auth claim so security rules can check it cheaply. */
  active: boolean;
  phone?: string;
}

export interface AuditLog {
  at: Timestamp;
  uid: string;
  action: 'create' | 'update' | 'delete' | 'approve' | 'void';
  collection: string;
  docId: string;
  /** Field-level before/after for financial documents only. */
  changes?: Record<string, { from: unknown; to: unknown }>;
}

// ===========================================================================
// technicians/{technicianId}
// ===========================================================================

/**
 * Field staff. Separate from `users` because not every technician has a login
 * (and subcontractor crews never will), while every technician needs a KPI
 * record. `uid` links the two when the person does sign in.
 */
export interface Technician extends AuditFields {
  employeeNo: string;
  name: string;
  nameAm?: string;
  /** Firebase Auth uid, when this technician also uses the app. */
  uid: string | null;
  /** Set when the technician belongs to a subcontractor rather than to us. */
  subcontractorId: string | null;
  phone: string;
  /**
   * What this person actually does. Installation and service are judged on
   * different evidence — stages delivered versus callouts closed — and scoring
   * an installer on SLA compliance produces nothing but blanks.
   */
  discipline: 'installation' | 'service' | 'both';
  trades: string[];
  /**
   * Licences and competency cards. Elevator work is certified work — an expired
   * card is a compliance problem, so expiry is a tracked KPI, not a note.
   */
  certifications: Array<{
    name: string;
    number: string;
    issuedDate: DualDate;
    expiryDate: DualDate;
    storagePath?: string;
  }>;
  /** Working minutes available per week, for the utilisation KPI. */
  contractedMinutesPerWeek: number;
  status: 'active' | 'on_leave' | 'inactive';
}

// ===========================================================================
// programs/{programId} — projects that belong together
// ===========================================================================

/**
 * A program owns no money of its own. Every figure reported against it is the
 * sum of its projects, so it can never disagree with what is inside it.
 *
 * A tower with four lifts is usually four projects — separate contracts, crews
 * and invoices — and ONE commitment to one client. Reported separately they look
 * like four modest jobs; together they are the largest thing the company carries.
 */
export interface Program extends AuditFields {
  programNo: string;
  name: string;
  description: string;
  /** A program may span clients (a developer with several buildings). */
  clientId: string | null;
  clientName: string | null;
  kind: 'program' | 'portfolio' | 'framework';
  status: 'active' | 'on_hold' | 'closed';
  plannedStart: DualDate;
  plannedEnd: DualDate;
  ownerUid: string | null;
}

// ===========================================================================
// units/{unitId} — the lift itself
// ===========================================================================

/**
 * A lift outlives the project that installed it and the contract that services
 * it. Maintenance, callouts and authority certificates all attach to the MACHINE,
 * which is why it needs an identity of its own rather than being an entry inside
 * whichever project happened to install it.
 */
export interface ElevatorUnit extends AuditFields {
  /** Our stable reference, e.g. "IM-U-00142". Never reused. */
  unitCode: string;
  /** The tag painted on site, e.g. "LIFT-01". Not unique across buildings. */
  tag: string;
  /** The manufacturer's equipment number — the one on the nameplate. */
  manufacturerUnitId?: string;
  serialNo?: string;
  brand?: string;
  model?: string;
  /** Passenger, goods, bed, panoramic, escalator. */
  type?: string;
  capacityKg?: number;
  personCapacity?: number;
  speedMps?: number;
  stops?: number;

  siteName: string;
  city: string;
  /** Where in the building, e.g. "Block B, core 2". */
  location?: string;

  clientId: string;
  clientName: string;
  /** The project that installed it, where we installed it. */
  installedByProjectId: string | null;
  /** The maintenance contract it is currently under, if any. */
  maintenanceContractId: string | null;
  maintenanceContractNo: string | null;

  commissionedOn: DualDate | null;
  status: 'under_installation' | 'in_service' | 'out_of_service' | 'decommissioned';

  certificate: {
    no?: string;
    issuedOn: DualDate | null;
    expiresOn: DualDate | null;
  } | null;

  /** Free text a manager keeps about this machine, separate from visit findings. */
  remarks: string;
}

// ===========================================================================
// callouts/{calloutId} — reactive service, the core of technician SLA metrics
// ===========================================================================

export type CalloutCategory = 'breakdown' | 'entrapment' | 'callback' | 'damage' | 'other';
export type CalloutResolution = 'fixed' | 'temporary_fix' | 'parts_required' | 'referred' | 'no_fault_found';

export interface Callout extends AuditFields {
  calloutNo: string;
  contractId: string;
  clientId: string;
  clientName: string;
  projectId: string | null;
  /** Which lift, e.g. "LIFT-01". Repeat-callout detection keys on this. */
  unitTag: string;
  siteName: string;

  category: CalloutCategory;
  /** Passengers trapped. Drives priority and is reported separately to the authority. */
  entrapment: boolean;
  description: string;

  technicianId: string | null;
  technicianName: string | null;

  // --- the timestamps every SLA metric derives from ---
  reportedAt: Timestamp;
  assignedAt: Timestamp | null;
  /** Technician on site. reportedAt -> arrivedAt is the response time. */
  arrivedAt: Timestamp | null;
  /** Lift back in service. arrivedAt -> resolvedAt is the repair time (MTTR). */
  resolvedAt: Timestamp | null;

  /**
   * SLA snapshotted from the contract when the call was logged, so a later
   * contract renegotiation cannot retroactively rewrite whether we breached.
   */
  slaResponseMinutes: number | null;
  slaResolutionMinutes: number | null;

  /** Denormalized on close so reports never recompute. Whole minutes. */
  responseMinutes: number | null;
  repairMinutes: number | null;
  breachedResponse: boolean | null;
  breachedResolution: boolean | null;

  resolution: CalloutResolution | null;
  /** Closed on the first visit with no follow-up needed. */
  firstTimeFix: boolean | null;
  /** Set by the repeat-callout pass: an earlier callout on this unit within the window. */
  repeatOfCalloutId: string | null;

  partsUsed: Array<{ description: string; qty: number; costNetSantim: number }>;
  status: 'open' | 'assigned' | 'on_site' | 'resolved' | 'cancelled';

  /** Period keys for monthly KPI rollups, from reportedAt. */
  periodEc: string;
  periodGc: string;
}

// ===========================================================================
// maintenanceVisits/{visitId} — planned preventive maintenance
// ===========================================================================

export interface MaintenanceVisit extends AuditFields {
  contractId: string;
  clientId: string;
  unitTag: string;
  siteName: string;
  technicianId: string | null;
  technicianName: string | null;

  /** The visit the contract promised. PM compliance measures against this. */
  scheduledDate: DualDate;
  completedDate: DualDate | null;
  status: 'scheduled' | 'completed' | 'missed' | 'rescheduled' | 'cancelled';

  /** Share of the checklist actually signed off, in bps. */
  checklistCompleteBps: number;
  findings: Array<{ note: string; severity: 'info' | 'defect' | 'safety'; raisedCalloutId?: string }>;
  durationMinutes: number | null;
  nextVisitDue: DualDate | null;

  periodEc: string;
  periodGc: string;
}

// ===========================================================================
// KPI snapshots
// ===========================================================================

/**
 * A KPI rate. `null` means NO DATA, which is not the same as 0% — a technician
 * with no callouts this month must not be shown as 0% SLA compliance.
 */
export type RateBps = number | null;

/** Written onto `projects/{id}.kpi` by a Cloud Function. */
export interface ProjectKpi {
  asOf: Timestamp;

  // --- schedule ---
  progressBps: number;
  /** Share of the planned duration already elapsed. */
  expectedProgressBps: number;
  /** progress − expected. Negative means behind schedule. */
  scheduleVarianceBps: number;
  /** Calendar days late; negative is early. Null while the end date is unknowable. */
  scheduleVarianceDays: number | null;
  daysToPlannedEnd: number | null;
  overdue: boolean;

  // --- cost and billing ---
  contractNetSantim: number;
  subcontractCostNetSantim: number;
  grossMarginSantim: number;
  grossMarginBps: RateBps;
  /** Share of contract value invoiced so far. */
  invoicedBps: RateBps;
  /** Share of invoiced value collected. */
  collectionRateBps: RateBps;
  /**
   * progress − invoiced. Positive means we have built more than we have billed:
   * work in progress that is not yet earning cash.
   */
  underBillingBps: number | null;
  /** Mean days from invoice issue to full settlement, weighted by amount. */
  avgCollectionDays: number | null;

  // --- delivery quality ---
  phasesCompleted: number;
  phasesTotal: number;
  /** Inspections passed without a rework cycle. */
  inspectionFirstPass: boolean | null;
  inspectionAttempts: number;
  /** Days each completed phase actually took, keyed by phase key. */
  phaseDurationDays: Record<string, number>;
}

/** Written to `technicians/{id}/kpiSnapshots/{periodEc}`. */
export interface TechnicianKpi {
  technicianId: string;
  /** `EC-2018-04`, or `EC-2018` for an annual roll-up. */
  periodEc: string;
  asOf: Timestamp;

  // --- reactive service ---
  calloutsHandled: number;
  entrapments: number;
  /** Mean is skewed by one bad night; median is the honest number. Both are kept. */
  avgResponseMinutes: number | null;
  medianResponseMinutes: number | null;
  /** Mean time to repair: arrival to back in service. */
  avgRepairMinutes: number | null;
  slaResponseComplianceBps: RateBps;
  slaResolutionComplianceBps: RateBps;
  firstTimeFixBps: RateBps;
  /** Share of this technician's callouts that were a repeat on a unit they had recently attended. */
  repeatCalloutBps: RateBps;

  // --- preventive maintenance ---
  pmVisitsScheduled: number;
  pmVisitsCompleted: number;
  pmComplianceBps: RateBps;
  /** Completed on or before the scheduled date. */
  pmOnTimeBps: RateBps;

  // --- capacity and compliance ---
  loggedMinutes: number;
  utilisationBps: RateBps;
  certificationsExpiringSoon: number;
  certificationsExpired: number;
}

/**
 * `config/fxRates` — the working rates the UI offers as a default.
 *
 * A default only. The rate that matters is the one snapshotted onto each
 * document, and finance may override it per transaction: the rate on the day a
 * shipment cleared is not necessarily today's.
 */
export interface FxRates {
  /** ETB per 1 USD, in micros. */
  usdMicros: number;
  rateDate: DualDate;
  source: string;
}

/** `config/kpiTargets` — the thresholds the dashboard grades against. */
export interface KpiTargets {
  slaResponseComplianceBps: number;
  slaResolutionComplianceBps: number;
  firstTimeFixBps: number;
  repeatCalloutBps: number;
  pmComplianceBps: number;
  pmOnTimeBps: number;
  utilisationBps: number;
  grossMarginBps: number;
  /** How far behind schedule is tolerated before a project grades amber. */
  scheduleVarianceBps: number;
  /** A callout on the same unit within this many days counts as a repeat. */
  repeatCalloutWindowDays: number;
  /** A certification expiring within this many days is "expiring soon". */
  certificationWarningDays: number;
}

// ===========================================================================
// projectAssignments/{assignmentId} — ties technicians to projects
// ===========================================================================

/**
 * Who is working on what, and how much of them.
 *
 * `allocationBps` is the share of that technician's capacity committed to this
 * project. It is the weight used when a project inherits a team-performance
 * score from its crew: a lead at 60% carries more of the project's service
 * score than a helper at 10%.
 */
export interface ProjectAssignment extends AuditFields {
  projectId: string;
  technicianId: string;
  technicianName: string;
  role: 'lead' | 'technician' | 'helper' | 'supervisor';
  /** Share of the technician's capacity on this project, 0-10000. */
  allocationBps: number;
  /** Optional narrowing to specific phases. Empty means the whole project. */
  phaseIds: string[];
  startDate: DualDate;
  endDate: DualDate | null;
  active: boolean;
}

// ===========================================================================
// config/kpiWeights — how the composite scorecard is built
// ===========================================================================

/**
 * Weights for the project scorecard, in basis points. MUST sum to 10000.
 *
 * A component with no data is dropped and its weight redistributed across the
 * rest, so a project is never marked down for a metric it cannot yet have.
 */
export interface ProjectKpiWeights {
  schedule: number;
  margin: number;
  billing: number;
  collection: number;
  quality: number;
  /** Inherited from the assigned technicians' service performance. */
  team: number;
}

/** Weights for the technician scorecard. MUST sum to 10000. */
export interface TechnicianKpiWeights {
  firstTimeFix: number;
  repeatCallouts: number;
  responseSla: number;
  resolutionSla: number;
  pmCompliance: number;
  pmOnTime: number;
  utilisation: number;
}

// ===========================================================================
// Risk and priority
// ===========================================================================

export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low';

export type RiskCode =
  | 'schedule_slip'
  | 'overdue_delivery'
  | 'overdue_receivable'
  | 'severe_under_billing'
  | 'margin_erosion'
  | 'margin_negative'
  | 'inspection_failed'
  | 'poor_collection'
  | 'no_team_assigned'
  | 'expired_certification'
  | 'repeat_callouts'
  | 'stalled_progress';

export interface RiskFlag {
  code: RiskCode;
  severity: RiskSeverity;
  /** One sentence a manager can act on, with the number that triggered it. */
  message: string;
  /** ETB at stake, where the flag is financial. */
  amountSantim?: number;
}

export interface RiskAssessment {
  level: RiskSeverity | 'none';
  /** True when the project needs attention this week. */
  inDanger: boolean;
  flags: RiskFlag[];
  /** 0-10000; higher is worse. Used to break ties in the priority ranking. */
  riskScoreBps: number;
}

/** Written onto `projects/{id}.priority` by the nightly rollup. */
export interface ProjectPriority {
  projectId: string;
  rank: number;
  /**
   * The headline: ETB reasonably reachable within the horizon, combining money
   * already earned but uncollected with milestones close enough to bill.
   */
  expectedReceivableSantim: number;
  /** Invoiced, unpaid and past due — earned money awaiting collection. */
  overdueReceivableSantim: number;
  /** Invoiced and unpaid but not yet due. */
  currentReceivableSantim: number;
  /** Upcoming milestones discounted by attainability and time. */
  nearTermBillableSantim: number;
  /** Contract value not yet invoiced at all. */
  unbilledContractSantim: number;
  /** Ranking key, 0-10000. */
  impactScoreBps: number;
  drivers: Array<{ label: string; amountSantim: number; note: string }>;
  risk: RiskAssessment;
  computedAt: Timestamp;
}

/** `config/priority` — tunables for the ranking. */
export interface PriorityConfig {
  /** How far ahead upcoming milestones are considered, in days. */
  horizonDays: number;
  /** Weight on money already earned but uncollected. */
  overdueWeightBps: number;
  /** Weight on invoiced, not yet due. */
  currentWeightBps: number;
  /** Weight on milestones not yet invoiced. */
  upcomingWeightBps: number;
  /** How much a project's risk score lifts it up the ranking. */
  riskBoostBps: number;
  /** AR older than this counts as a critical overdue receivable. */
  criticalOverdueDays: number;
}
