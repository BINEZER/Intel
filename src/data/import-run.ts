/**
 * Write an ImportPlan into Firestore.
 *
 * IDS ARE DERIVED FROM THE SOURCE, NOT GENERATED
 *   Every document gets an id built from the workbook's own key — contract
 *   `AGR-2021-001` always lands at `im-k-AGR-2021-001`. A second run of the
 *   same workbook therefore updates the same documents instead of creating a
 *   parallel set. This matters more than it sounds: the first import of a
 *   spreadsheet this size is never the last one, and an import that duplicates
 *   on re-run is an import nobody can safely correct.
 *
 * WHAT A RE-RUN DOES NOT TOUCH
 *   Payment milestones are written only when the contract is new. Once a
 *   contract exists, its schedule may have been invoiced against, and
 *   rewriting it would detach invoices from the terms they settled. The same
 *   goes for project phases, which carry recorded progress.
 */

import {
  Timestamp,
  collection,
  doc,
  getDocs,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { stampCreate, stampUpdate } from './audit.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { addVat, extractVat } from '../lib/money.js';
import { allocateMilestones } from '../lib/milestones.js';
import { EMPTY_FINANCIALS } from './projects.js';
import type { ImportPlan, PlannedContract } from '../lib/import-master.js';
import type {
  AuditFields,
  Client,
  Contract,
  DualDate,
  ElevatorUnit,
  Program,
  Project,
  Subcontractor,
  Technician,
} from '../lib/schema.js';

/**
 * The stored shape minus the audit stamps, which are added at the write.
 *
 * Every payload below is annotated with one of these. It is the only thing
 * standing between a typo and a field that Firestore accepts, stores, and
 * never shows anybody — `notes` on a contract, for instance, which has no such
 * field and would have vanished silently.
 */
type Payload<T> = Omit<T, keyof AuditFields>;

/** Firestore caps a batch at 500 writes. */
const BATCH_LIMIT = 450;

const ID = {
  client: (key: string) => `im-c-${key}`,
  technician: (key: string) => `im-${key}`,
  subcontractor: (key: string) => `im-${key}`,
  program: (key: string) => `im-g-${key}`,
  contract: (key: string) => `im-k-${key}`,
  project: (key: string) => `im-p-${key}`,
  unit: (key: string) => `im-u-${key}`,
};

export interface ImportProgress {
  stage: string;
  written: number;
  total: number;
}

export interface ImportResult {
  created: Record<string, number>;
  updated: Record<string, number>;
  /** Contracts that already existed, so their payment schedule was left alone. */
  schedulesPreserved: number;
}

function toDual(date: Date | null): DualDate | null {
  return date === null ? null : dualDateFromGregorian(date, (d) => Timestamp.fromDate(d));
}

/** Falls back to today so a required date field is never left empty. */
function toDualOr(date: Date | null, fallback: Date): DualDate {
  return dualDateFromGregorian(date ?? fallback, (d) => Timestamp.fromDate(d));
}

/**
 * A queue that commits every time it fills up.
 *
 * The plan runs to a few thousand writes, well past Firestore's 500-per-batch
 * cap, so the writes are flushed in chunks as they are produced rather than
 * assembled into one impossible batch.
 */
class BatchQueue {
  private batch: WriteBatch = writeBatch(db);
  private pending = 0;
  private done = 0;

  constructor(
    private readonly total: number,
    private readonly onProgress: (p: ImportProgress) => void,
    private stage = 'Starting',
  ) {}

  setStage(stage: string) {
    this.stage = stage;
    this.report();
  }

  add(write: (batch: WriteBatch) => void): Promise<void> {
    write(this.batch);
    this.pending += 1;
    this.done += 1;
    if (this.pending >= BATCH_LIMIT) return this.flush();
    if (this.done % 25 === 0) this.report();
    return Promise.resolve();
  }

  async flush(): Promise<void> {
    if (this.pending === 0) return;
    await this.batch.commit();
    this.batch = writeBatch(db);
    this.pending = 0;
    this.report();
  }

  private report() {
    this.onProgress({ stage: this.stage, written: this.done, total: this.total });
  }
}

/** The ids already present, so the run knows what it is updating. */
async function existingIds(path: string): Promise<Set<string>> {
  const snapshot = await getDocs(collection(db, path));
  return new Set(snapshot.docs.map((d) => d.id));
}

function contractMoney(contract: PlannedContract) {
  return contract.valueEnteredInclusive
    ? extractVat(contract.valueSantim, contract.vatRateBps)
    : addVat(contract.valueSantim, contract.vatRateBps);
}


/**
 * The workbook's stage word, as a per-lift state on the project.
 *
 * `Project.status` answers "is this job running"; this answers "how far has
 * this lift got", which is the question the stage column was actually
 * recording.
 */
function unitStageOf(sourceStage: string): NonNullable<Project['units'][number]['status']> {
  switch (sourceStage.trim().toLowerCase()) {
    case 'completed':
      return 'handed_over';
    case 'warranty':
      return 'commissioned';
    case 'testing & commissioning':
    case 'testing':
      return 'testing';
    case 'installation':
    case 'shipping':
    case 'procurement':
      return 'in_progress';
    default:
      return 'not_started';
  }
}

export async function runImport(
  plan: ImportPlan,
  uid: string,
  onProgress: (p: ImportProgress) => void,
): Promise<ImportResult> {
  const today = new Date();
  const created: Record<string, number> = {};
  const updated: Record<string, number> = {};
  const bump = (map: Record<string, number>, key: string) => {
    map[key] = (map[key] ?? 0) + 1;
  };

  const [haveClients, havePrograms, haveContracts, haveProjects, haveUnits, haveTechnicians, haveSubcontractors] =
    await Promise.all([
      existingIds('clients'),
      existingIds('programs'),
      existingIds('contracts'),
      existingIds('projects'),
      existingIds('units'),
      existingIds('technicians'),
      existingIds('subcontractors'),
    ]);

  const total =
    plan.clients.length +
    plan.programs.length +
    plan.contracts.length +
    plan.contracts.reduce(
      (a, c) => (haveContracts.has(ID.contract(c.key)) ? a : a + c.milestones.length),
      0,
    ) +
    plan.projects.length +
    plan.units.length +
    plan.technicians.length +
    plan.subcontractors.length;

  const queue = new BatchQueue(total, onProgress);
  const clientNameByKey = new Map(plan.clients.map((c) => [c.key, c.name]));
  const nameFor = (key: string, fallback: string) => clientNameByKey.get(key) ?? fallback;

  // --- clients -------------------------------------------------------------

  queue.setStage('Clients');
  for (const client of plan.clients) {
    const id = ID.client(client.key);
    const exists = haveClients.has(id);
    bump(exists ? updated : created, 'clients');

    const payload: Payload<Client> = {
      name: client.name,
      // The workbook has no TIN column. Left blank rather than invented — a
      // made-up TIN on a VAT invoice is a real problem.
      tin: '',
      vatRegistered: false,
      address: { city: client.city },
      contacts: client.contactName === null ? [] : [{ name: client.contactName, phone: '' }],
      status: 'active',
      notes: 'Imported from the project master workbook.',
    };
    await queue.add((batch) =>
      batch.set(
        doc(db, 'clients', id),
        { ...payload, ...(exists ? stampUpdate(uid) : stampCreate(uid)) },
        { merge: exists },
      ),
    );
  }

  // --- programs ------------------------------------------------------------

  queue.setStage('Programs');
  for (const program of plan.programs) {
    const id = ID.program(program.key);
    const exists = havePrograms.has(id);
    bump(exists ? updated : created, 'programs');

    const payload: Payload<Program> = {
      programNo: program.programNo,
      name: program.name,
      description: 'Lifts supplied under one agreement.',
      clientId: ID.client(program.clientKey),
      clientName: nameFor(program.clientKey, program.name),
      kind: 'program',
      status: 'active',
      plannedStart: toDualOr(program.plannedStart, today),
      plannedEnd: toDualOr(program.plannedEnd, program.plannedStart ?? today),
      ownerUid: null,
    };
    await queue.add((batch) =>
      batch.set(
        doc(db, 'programs', id),
        { ...payload, ...(exists ? stampUpdate(uid) : stampCreate(uid)) },
        { merge: exists },
      ),
    );
  }

  // --- contracts and their payment schedules -------------------------------

  queue.setStage('Contracts');
  let schedulesPreserved = 0;
  for (const contract of plan.contracts) {
    const id = ID.contract(contract.key);
    const exists = haveContracts.has(id);
    bump(exists ? updated : created, 'contracts');
    const money = contractMoney(contract);

    const payload: Payload<Contract> = {
      contractNo: contract.contractNo,
      type: 'supply_install',
      clientId: ID.client(contract.clientKey),
      clientName: nameFor(contract.clientKey, contract.title),
      title: contract.title,
      currency: 'ETB',
      valueNetSantim: money.netSantim,
      vatRateBps: contract.vatRateBps,
      vatSantim: money.vatSantim,
      valueGrossSantim: money.grossSantim,
      valueEnteredInclusive: contract.valueEnteredInclusive,
      signedDate: toDualOr(contract.signedDate, contract.startDate ?? today),
      startDate: toDualOr(contract.startDate, today),
      endDate: toDualOr(contract.endDate, contract.startDate ?? today),
      autoRenew: false,
      renewalWindowDays: 0,
      renewalAlertAt: null,
      renewalStatus: 'not_due',
      reminders: [],
      status: contract.status,
      attachments: [],
    };
    await queue.add((batch) =>
      batch.set(
        doc(db, 'contracts', id),
        { ...payload, ...(exists ? stampUpdate(uid) : stampCreate(uid)) },
        { merge: exists },
      ),
    );

    // A contract that already exists may have been invoiced against; rewriting
    // its schedule would detach those invoices from the terms they settled.
    if (exists) {
      schedulesPreserved += 1;
      continue;
    }

    const allocated = allocateMilestones(money, contract.milestones);
    for (const [index, milestone] of allocated.entries()) {
      const paid = contract.milestones[index]?.paid === true;
      await queue.add((batch) =>
        batch.set(doc(db, `contracts/${id}/milestones`, `m${String(index + 1).padStart(2, '0')}`), {
          seq: milestone.seq,
          name: milestone.name,
          shareBps: milestone.shareBps,
          netSantim: milestone.netSantim,
          vatSantim: milestone.vatSantim,
          grossSantim: milestone.grossSantim,
          dueDate: null,
          status: paid ? 'paid' : 'pending',
          ...stampCreate(uid),
        }),
      );
    }
  }

  // --- projects ------------------------------------------------------------

  queue.setStage('Projects');
  for (const project of plan.projects) {
    const id = ID.project(project.key);
    const exists = haveProjects.has(id);
    bump(exists ? updated : created, 'projects');

    const payload: Payload<Omit<Project, 'progressBps' | 'financials'>> = {
      projectNo: project.projectNo,
      type: 'elevator',
      title: project.title,
      clientId: ID.client(project.clientKey),
      clientName: nameFor(project.clientKey, project.title),
      contractId: ID.contract(project.contractKey),
      programId: project.programKey === null ? null : ID.program(project.programKey),
      parentProjectId: null,
      reminders: [],
      site: { name: project.title, city: project.siteCity },
      units: [
        {
          tag: project.tag,
          ...(project.capacityKg === null ? {} : { capacityKg: project.capacityKg }),
          ...(project.stops === null ? {} : { stops: project.stops }),
          status: unitStageOf(project.sourceStage),
        },
      ],
      plannedStart: toDualOr(project.plannedStart, today),
      plannedEnd: toDualOr(project.plannedEnd, project.plannedStart ?? today),
      actualStart: null,
      actualEnd: null,
      status: project.status,
    };
    await queue.add((batch) =>
      batch.set(
        doc(db, 'projects', id),
        {
          ...payload,
          // Only on a first write: a project that exists has real progress on
          // it, and resetting it to zero would erase what the crews recorded.
          ...(exists
            ? stampUpdate(uid)
            : {
                progressBps: 0,
                financials: { ...EMPTY_FINANCIALS, lastComputedAt: Timestamp.now() },
                ...stampCreate(uid),
              }),
        },
        { merge: exists },
      ),
    );
  }

  // --- lifts ---------------------------------------------------------------

  queue.setStage('Lifts');
  for (const unit of plan.units) {
    const id = ID.unit(unit.key);
    const exists = haveUnits.has(id);
    bump(exists ? updated : created, 'units');

    const payload: Payload<ElevatorUnit> = {
      unitCode: unit.klNumber === null ? `IM-${unit.key}` : `KL-${unit.klNumber}`,
      tag: unit.tag,
      ...(unit.klNumber === null ? {} : { manufacturerUnitId: unit.klNumber }),
      ...(unit.model === null ? {} : { model: unit.model }),
      ...(unit.capacityKg === null ? {} : { capacityKg: unit.capacityKg }),
      ...(unit.speedMps === null ? {} : { speedMps: unit.speedMps }),
      ...(unit.stops === null ? {} : { stops: unit.stops }),
      siteName: unit.siteName,
      city: unit.city,
      clientId: ID.client(unit.clientKey),
      clientName: nameFor(unit.clientKey, unit.siteName),
      installedByProjectId: ID.project(unit.projectKey),
      maintenanceContractId: null,
      maintenanceContractNo: null,
      commissionedOn: null,
      status: unit.status,
      // The KL number is the authority registration, so it is the certificate
      // number. The dates are not in the workbook and are left null rather
      // than guessed — an invented expiry date is an alert that fires on the
      // wrong day.
      certificate: unit.klNumber === null ? null : { no: unit.klNumber, issuedOn: null, expiresOn: null },
      remarks: '',
    };
    await queue.add((batch) =>
      batch.set(
        doc(db, 'units', id),
        { ...payload, ...(exists ? stampUpdate(uid) : stampCreate(uid)) },
        { merge: exists },
      ),
    );
  }

  // --- people --------------------------------------------------------------

  queue.setStage('Technicians');
  for (const [index, technician] of plan.technicians.entries()) {
    const id = ID.technician(technician.key);
    const exists = haveTechnicians.has(id);
    bump(exists ? updated : created, 'technicians');

    const payload: Payload<Technician> = {
      employeeNo: `T-${String(index + 1).padStart(3, '0')}`,
      name: technician.name,
      uid: null,
      subcontractorId: null,
      phone: technician.phone,
      // The rosters record who is on which site, not whether a person installs
      // or services. 'both' is the reading that scores nobody on evidence they
      // were never going to produce.
      discipline: 'both',
      trades: [],
      certifications: [],
      // 40 hours. The utilisation KPI needs a figure, and a wrong one is
      // visible on the Performance page where a zero would just read as broken.
      contractedMinutesPerWeek: 40 * 60,
      status: 'active',
    };
    await queue.add((batch) =>
      batch.set(
        doc(db, 'technicians', id),
        { ...payload, ...(exists ? stampUpdate(uid) : stampCreate(uid)) },
        { merge: exists },
      ),
    );
  }

  queue.setStage('Subcontractors');
  for (const subcontractor of plan.subcontractors) {
    const id = ID.subcontractor(subcontractor.key);
    const exists = haveSubcontractors.has(id);
    bump(exists ? updated : created, 'subcontractors');

    const payload: Payload<Subcontractor> = {
      name: subcontractor.name,
      // No TIN anywhere in the workbook. `hasTin: false` is the truth, and it
      // is what drives the 30% penalty withholding rate — which is why every
      // one of these is flagged in the issue report.
      tin: '',
      hasTin: false,
      vatRegistered: false,
      defaultWhtCategory: 'services',
      trades: subcontractor.trades,
      bank: { name: '', accountName: '', accountNo: '' },
      contacts:
        subcontractor.phone === ''
          ? []
          : [{ name: subcontractor.name, phone: subcontractor.phone }],
      status: 'active',
    };
    await queue.add((batch) =>
      batch.set(
        doc(db, 'subcontractors', id),
        { ...payload, ...(exists ? stampUpdate(uid) : stampCreate(uid)) },
        { merge: exists },
      ),
    );
  }

  queue.setStage('Finishing');
  await queue.flush();
  return { created, updated, schedulesPreserved };
}
