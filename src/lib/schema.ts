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
  address: { city: string; subCity?: string; woreda?: string; kebele?: string; poBox?: string };
  contacts: Array<{ name: string; role?: string; phone: string; email?: string }>;
  status: 'active' | 'inactive';
  notes?: string;
}

// ===========================================================================
// contracts/{contractId}
// ===========================================================================

export type ContractType = 'supply_install' | 'maintenance' | 'modernization' | 'other';
export type ContractStatus = 'draft' | 'active' | 'suspended' | 'completed' | 'terminated' | 'expired';

export interface Contract extends AuditFields {
  contractNo: string;
  type: ContractType;
  clientId: string;
  /** Denormalized for list views; refreshed by a Cloud Function on client rename. */
  clientName: string;
  projectId?: string;
  title: string;

  currency: 'ETB';
  /** VAT-exclusive contract value. */
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

  site: { name: string; city: string; subCity?: string; gps?: { lat: number; lng: number } };

  /** Elevator units under this project; empty for non-elevator work. */
  units: Array<{
    tag: string;              // "LIFT-01"
    brand?: string;
    model?: string;
    capacityKg?: number;
    speedMps?: number;
    stops?: number;
    serialNo?: string;
  }>;

  plannedStart: DualDate;
  plannedEnd: DualDate;
  actualStart: DualDate | null;
  actualEnd: DualDate | null;

  status: 'planned' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
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
  progressBps: number;
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

  currency: 'ETB';
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

  currency: 'ETB';
  /** VAT-exclusive base. WHT is computed on this, never on the gross. */
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

  status: 'draft' | 'approved' | 'paid' | 'rejected' | 'void';
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
