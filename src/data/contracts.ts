/**
 * Contract repository, including the milestone subcollection.
 *
 * A contract and its milestones are written in ONE BATCH. A contract whose
 * milestones failed to save is a contract nobody can invoice against, and the
 * milestones must sum to the contract value exactly — so they are never allowed
 * to exist in a half-written state.
 */

import {
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { Contract, PaymentMilestone } from '../lib/schema.js';
import { addVat, extractVat } from '../lib/money.js';
import { allocateMilestones, type MilestoneShare } from '../lib/milestones.js';
import { renewalAlertAt } from '../lib/renewal.js';
import { stampCreate, stampUpdate, stripReserved } from './audit.js';
import { collectionRef, getMany, getOne, newId, subscribe, type WithId } from './repository.js';
import { db } from '../firebase.js';

const PATH = 'contracts';
const milestonePath = (contractId: string) => `${PATH}/${contractId}/milestones`;

export type ContractInput = Omit<
  Contract,
  'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'vatSantim' | 'valueGrossSantim' | 'renewalAlertAt'
>;

/**
 * Derive the VAT fields and the renewal alert instant from what the user
 * entered, so the caller can never persist a contract whose VAT does not add up
 * — which the security rules would reject anyway.
 */
export function deriveContractFields(input: ContractInput): Pick<
  Contract,
  'valueNetSantim' | 'vatSantim' | 'valueGrossSantim' | 'renewalAlertAt'
> {
  const breakdown = input.valueEnteredInclusive
    ? extractVat(input.valueNetSantim, input.vatRateBps)
    : addVat(input.valueNetSantim, input.vatRateBps);

  const alertAt = renewalAlertAt(input.endDate.at.toDate(), input.renewalWindowDays);

  return {
    valueNetSantim: breakdown.netSantim,
    vatSantim: breakdown.vatSantim,
    valueGrossSantim: breakdown.grossSantim,
    renewalAlertAt: alertAt === null ? null : Timestamp.fromDate(alertAt),
  };
}

export function subscribeContracts(
  onData: (rows: WithId<Contract>[]) => void,
  onError: (error: Error) => void,
  options: { status?: Contract['status'] } = {},
) {
  const q =
    options.status === undefined
      ? query(collectionRef(PATH), orderBy('endDate.at', 'desc'))
      : query(collectionRef(PATH), where('status', '==', options.status), orderBy('endDate.at', 'desc'));
  return subscribe<Contract>(q, onData, onError);
}

/**
 * Contracts entering their renewal window.
 * One indexed range filter, because `renewalAlertAt` was precomputed on write.
 */
export function subscribeRenewalsDue(
  onData: (rows: WithId<Contract>[]) => void,
  onError: (error: Error) => void,
  asOf: Date = new Date(),
) {
  const q = query(
    collectionRef(PATH),
    where('status', '==', 'active'),
    where('renewalAlertAt', '<=', Timestamp.fromDate(asOf)),
    orderBy('renewalAlertAt'),
  );
  return subscribe<Contract>(q, onData, onError);
}

export function getContract(id: string) {
  return getOne<Contract>(PATH, id);
}

export async function getMilestones(contractId: string) {
  return getMany<PaymentMilestone>(query(collectionRef(milestonePath(contractId)), orderBy('seq')));
}

export function subscribeMilestones(
  contractId: string,
  onData: (rows: WithId<PaymentMilestone>[]) => void,
  onError: (error: Error) => void,
) {
  return subscribe<PaymentMilestone>(
    query(collectionRef(milestonePath(contractId)), orderBy('seq')),
    onData,
    onError,
  );
}

/**
 * Create a contract and its milestones atomically.
 * Returns the new contract id.
 */
/**
 * Which payment milestones are tied to which stage of a project.
 *
 * The tracker needs this before it will let a stage be deleted. A milestone
 * whose stage no longer exists is a payment that will never become due — the
 * money stays uninvoiced, and nothing in the system ever complains, because
 * from its point of view the milestone is simply still waiting.
 *
 * Keyed by phase id; the values are milestone names, which is what a manager
 * needs to see in order to act on the refusal.
 */
export async function getPaymentStagesForProject(projectId: string): Promise<Map<string, string[]>> {
  const contracts = await getMany<Contract>(query(collectionRef(PATH), where('projectId', '==', projectId)));
  const byPhase = new Map<string, string[]>();

  for (const contract of contracts) {
    for (const milestone of await getMilestones(contract.id)) {
      if (milestone.phaseId === undefined) continue;
      const label = `${contract.contractNo}: ${milestone.name}`;
      byPhase.set(milestone.phaseId, [...(byPhase.get(milestone.phaseId) ?? []), label]);
    }
  }

  return byPhase;
}

/** Re-point a milestone at a different stage, so the stage it was on can go. */
export async function setMilestoneStage(
  contractId: string,
  milestoneId: string,
  phaseId: string | null,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, milestonePath(contractId), milestoneId), {
    ...(phaseId === null ? { phaseId: deleteField() } : { phaseId }),
    ...stampUpdate(uid),
  });
}

export async function createContract(
  input: ContractInput,
  shares: readonly MilestoneShare[],
  uid: string,
): Promise<string> {
  const derived = deriveContractFields(input);
  const contractId = newId(PATH);
  const batch = writeBatch(db);

  batch.set(doc(db, PATH, contractId), {
    ...stripReserved(input),
    ...derived,
    ...stampCreate(uid),
  });

  // allocateMilestones throws if the shares do not sum to 100%, before anything
  // is written — a contract with a gap in its payment schedule never reaches
  // Firestore.
  const allocated = allocateMilestones(
    { netSantim: derived.valueNetSantim, vatSantim: derived.vatSantim, grossSantim: derived.valueGrossSantim, vatRateBps: input.vatRateBps },
    shares,
  );

  for (const milestone of allocated) {
    batch.set(doc(db, milestonePath(contractId), newId(milestonePath(contractId))), {
      seq: milestone.seq,
      name: milestone.name,
      ...(milestone.phaseId === undefined ? {} : { phaseId: milestone.phaseId }),
      shareBps: milestone.shareBps,
      netSantim: milestone.netSantim,
      vatSantim: milestone.vatSantim,
      grossSantim: milestone.grossSantim,
      dueDate: null,
      status: 'pending',
      ...stampCreate(uid),
    });
  }

  await batch.commit();
  return contractId;
}

export async function updateContract(
  id: string,
  input: Partial<ContractInput> & Pick<ContractInput, 'valueNetSantim' | 'vatRateBps' | 'valueEnteredInclusive' | 'endDate' | 'renewalWindowDays'>,
  uid: string,
): Promise<void> {
  const derived = deriveContractFields(input as ContractInput);
  await updateDoc(doc(db, PATH, id), { ...stripReserved(input), ...derived, ...stampUpdate(uid) });
}

/**
 * Re-allocate the payment schedule. Replaces every milestone in one batch, so
 * the schedule is never partially rewritten.
 *
 * Milestones already invoiced or paid are refused — rewriting the value of a
 * milestone a client has already been billed for would break the audit trail.
 */
export async function replaceMilestones(
  contractId: string,
  contract: Pick<Contract, 'valueNetSantim' | 'vatSantim' | 'valueGrossSantim' | 'vatRateBps'>,
  shares: readonly MilestoneShare[],
  uid: string,
): Promise<void> {
  const existing = await getDocs(query(collectionRef(milestonePath(contractId)), orderBy('seq')));

  const locked = existing.docs.filter((d) => {
    const status = (d.data() as PaymentMilestone).status;
    return status === 'invoiced' || status === 'paid';
  });
  if (locked.length > 0) {
    throw new Error(
      `${locked.length} milestone${locked.length === 1 ? ' has' : 's have'} already been invoiced — ` +
        `the payment schedule can no longer be rewritten. Raise a variation instead.`,
    );
  }

  const allocated = allocateMilestones(
    {
      netSantim: contract.valueNetSantim,
      vatSantim: contract.vatSantim,
      grossSantim: contract.valueGrossSantim,
      vatRateBps: contract.vatRateBps,
    },
    shares,
  );

  const batch = writeBatch(db);
  for (const d of existing.docs) batch.delete(d.ref);
  for (const milestone of allocated) {
    batch.set(doc(db, milestonePath(contractId), newId(milestonePath(contractId))), {
      seq: milestone.seq,
      name: milestone.name,
      ...(milestone.phaseId === undefined ? {} : { phaseId: milestone.phaseId }),
      shareBps: milestone.shareBps,
      netSantim: milestone.netSantim,
      vatSantim: milestone.vatSantim,
      grossSantim: milestone.grossSantim,
      dueDate: null,
      status: 'pending',
      ...stampCreate(uid),
    });
  }
  await batch.commit();
}

export async function setRenewalStatus(
  contractId: string,
  renewalStatus: Contract['renewalStatus'],
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, PATH, contractId), { renewalStatus, ...stampUpdate(uid) });
}

/** Only a draft contract may be deleted; anything else is terminated. */
export async function deleteDraftContract(id: string): Promise<void> {
  await deleteDoc(doc(db, PATH, id));
}

/**
 * Change only the status.
 *
 * `updateContract` recomputes the VAT split, so it needs the whole priced
 * input; changing a contract from active to terminated should not require
 * re-entering its value. The security rules still check that VAT reconciles —
 * on a partial update they see the merged document, so the stored figures are
 * what gets validated, and this cannot be used to slip past them.
 */
export async function updateContractStatus(
  id: string,
  status: Contract['status'],
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, PATH, id), { status, ...stampUpdate(uid) });
}
