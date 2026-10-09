/**
 * Carrying out what the lifecycle engine worked out.
 *
 * The engine in lib/lifecycle.ts decides what SHOULD change; this file makes
 * the change. Two of them are more than a status flip:
 *
 *   STARTING THE WARRANTY sets both ends of it at once. A start date without an
 *   end date is a clock nobody is watching, and the end date is the thing the
 *   whole service decision hangs off.
 *
 *   CONVERTING TO SERVICE writes a second contract and links the two in the
 *   same batch. Half of that — a service contract with no link back, or an
 *   installation contract pointing at a service agreement that was never
 *   written — would be worse than not converting at all, because the engine
 *   would then stop asking about a decision nobody actually made.
 */

import { Timestamp, doc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase.js';
import { stampCreate, stampUpdate } from './audit.js';
import { collectionRef, newId } from './repository.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { monthlyTerms, serviceFeeFigures } from '../lib/service-agreement.js';
import { warrantyEnd, type ConsequenceAction } from '../lib/lifecycle.js';
import type { Contract, ElevatorUnit, PaymentMilestone } from '../lib/schema.js';
import { getMilestones } from './contracts.js';

const toTimestamp = (date: Date) => Timestamp.fromDate(date);
const dual = (date: Date) => dualDateFromGregorian(date, toTimestamp, 'GC');

/** The mechanical fixes: one field, one document. */
export async function applyConsequence(action: ConsequenceAction, uid: string): Promise<void> {
  const batch = writeBatch(db);
  const stamp = stampUpdate(uid);

  switch (action.kind) {
    case 'set_project_status':
      batch.update(doc(db, 'projects', action.targetId), { status: action.value, ...stamp });
      break;
    case 'set_contract_status':
      batch.update(doc(db, 'contracts', action.targetId), { status: action.value, ...stamp });
      break;
    case 'set_client_status':
      batch.update(doc(db, 'clients', action.targetId), { status: action.value, ...stamp });
      break;
    case 'set_unit_status':
      batch.update(doc(db, 'units', action.targetId), { status: action.value, ...stamp });
      break;
    default:
      throw new Error(`${action.kind} needs more than a status change; use its own function.`);
  }

  await batch.commit();
}

/**
 * Start the warranty clock, from today unless a handover date is given.
 *
 * Both ends are written together: a start with no end is a countdown nobody
 * is counting.
 */
export async function startWarranty(
  contractId: string,
  months: number,
  alertDays: number,
  uid: string,
  startsOn: Date = new Date(),
): Promise<{ endsOn: Date }> {
  const ends = warrantyEnd(startsOn, months);
  const batch = writeBatch(db);
  batch.update(doc(db, 'contracts', contractId), {
    warranty: { months, startsOn: dual(startsOn), endsOn: dual(ends), alertDays },
    ...stampUpdate(uid),
  });
  await batch.commit();
  return { endsOn: ends };
}

/** The client said no. Record it, so the engine stops asking and we stop working. */
export async function declineService(contractId: string, uid: string): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'contracts', contractId), {
    serviceDeclined: true,
    succeededByContractId: null,
    ...stampUpdate(uid),
  });

  // The lifts stay on the register with their whole history — they are still
  // our machines in the sense that matters — but nothing says we cover them.
  const units = await getDocs(
    query(collectionRef('units'), where('maintenanceContractId', '==', contractId)),
  );
  for (const unit of units.docs) {
    batch.update(unit.ref, { maintenanceContractId: null, maintenanceContractNo: null, ...stampUpdate(uid) });
  }

  await batch.commit();
}

export interface ConversionContext {
  /** The installation contract's payment terms, for what is still owed on it. */
  terms: PaymentMilestone[];
  /** Every lift the client has, with whether it came from this contract. */
  lifts: Array<ElevatorUnit & { id: string; installedHere: boolean }>;
}

/** What the conversion form needs to show before anybody commits to it. */
export async function loadConversionContext(
  original: Pick<Contract, 'clientId'> & { id: string },
): Promise<ConversionContext> {
  const [terms, here, clientUnits] = await Promise.all([
    getMilestones(original.id),
    liftsInstalledUnder(original),
    getDocs(query(collectionRef('units'), where('clientId', '==', original.clientId))),
  ]);
  const hereIds = new Set(here.map((d) => d.id));
  return {
    terms,
    lifts: clientUnits.docs
      .map((d) => ({ ...(d.data() as ElevatorUnit), id: d.id, installedHere: hereIds.has(d.id) }))
      .sort((a, b) => a.siteName.localeCompare(b.siteName) || a.tag.localeCompare(b.tag)),
  };
}

export interface ServiceConversion {
  monthlyNetSantim: number;
  /** Term in months. Twelve unless somebody says otherwise. */
  months: number;
  vatRateBps: number;
  startsOn: Date;
  /**
   * The lifts the agreement covers, where somebody has chosen them. Absent means
   * "the lifts installed under the contract being replaced" — see
   * `liftsInstalledUnder`.
   */
  unitIds?: readonly string[];
}

/**
 * The lifts that were installed under a contract.
 *
 * Not every lift the client owns: a client with two buildings on two contracts
 * must not have the second building swept into the first one's service
 * agreement.
 */
export async function liftsInstalledUnder(original: Pick<Contract, 'clientId'> & { id: string }) {
  const projects = await getDocs(
    query(collectionRef('projects'), where('contractId', '==', original.id)),
  );
  const projectIds = new Set(projects.docs.map((d) => d.id));
  const clientUnits = await getDocs(
    query(collectionRef('units'), where('clientId', '==', original.clientId)),
  );
  return clientUnits.docs.filter((u) => {
    const installedBy = u.data()['installedByProjectId'];
    return typeof installedBy === 'string' && projectIds.has(installedBy);
  });
}

/**
 * Turn an installation contract into the service agreement that follows it.
 *
 * The new contract is priced monthly and carries one payment term per month,
 * because that is how it is actually billed — a single annual milestone would
 * make every month's invoice a manual exercise.
 */
export async function convertToServiceContract(
  original: Contract & { id: string },
  conversion: ServiceConversion,
  uid: string,
): Promise<string> {
  const { monthlyNetSantim, months, vatRateBps, startsOn } = conversion;
  if (monthlyNetSantim <= 0) throw new Error('A service agreement needs a monthly fee.');
  if (months < 1) throw new Error('A service agreement needs a term of at least one month.');
  if (original.succeededByContractId !== null && original.succeededByContractId !== undefined) {
    throw new Error(`${original.contractNo} already has a service agreement.`);
  }

  const { term: money } = serviceFeeFigures(monthlyNetSantim, months, vatRateBps);
  const endsOn = warrantyEnd(startsOn, months);

  const serviceId = newId('contracts');
  const batch = writeBatch(db);

  const covered =
    conversion.unitIds === undefined
      ? (await liftsInstalledUnder(original)).map((d) => d.ref)
      : conversion.unitIds.map((id) => doc(db, 'units', id));

  const contractNo = `${original.contractNo}-SVC`;

  const payload: Omit<Contract, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> = {
    contractNo,
    type: 'maintenance',
    clientId: original.clientId,
    clientName: original.clientName,
    title: `${original.title} — service & maintenance`,
    currency: 'ETB',
    valueNetSantim: money.netSantim,
    vatRateBps,
    vatSantim: money.vatSantim,
    valueGrossSantim: money.grossSantim,
    valueEnteredInclusive: false,
    signedDate: dual(startsOn),
    startDate: dual(startsOn),
    endDate: dual(endsOn),
    autoRenew: false,
    // A service agreement is the thing you renew; 60 days is enough to write
    // the letter and still have the conversation.
    renewalWindowDays: 60,
    renewalAlertAt: Timestamp.fromDate(
      new Date(endsOn.getTime() - 60 * 24 * 60 * 60 * 1000),
    ),
    renewalStatus: 'not_due',
    status: 'active',
    attachments: [],
    supersedesContractId: original.id,
    succeededByContractId: null,
    serviceFee: { monthlyNetSantim, unitCount: covered.length },
  };

  batch.set(doc(db, 'contracts', serviceId), { ...payload, ...stampCreate(uid) });

  // One term per month — the way it is billed.
  for (const [index, term] of monthlyTerms(startsOn, months, money).entries()) {
    batch.set(doc(db, `contracts/${serviceId}/milestones`, `m${String(index + 1).padStart(2, '0')}`), {
      seq: term.seq,
      name: term.name,
      shareBps: term.shareBps,
      netSantim: term.netSantim,
      vatSantim: term.vatSantim,
      grossSantim: term.grossSantim,
      dueDate: dual(term.dueDate),
      status: 'pending',
      ...stampCreate(uid),
    });
  }

  // Link both ways in the same batch. One without the other leaves the engine
  // unable to tell a decision that was made from one that was forgotten.
  batch.update(doc(db, 'contracts', original.id), {
    succeededByContractId: serviceId,
    serviceDeclined: false,
    ...stampUpdate(uid),
  });

  for (const unit of covered) {
    batch.update(unit, {
      maintenanceContractId: serviceId,
      maintenanceContractNo: contractNo,
      ...stampUpdate(uid),
    });
  }

  await batch.commit();
  return serviceId;
}
