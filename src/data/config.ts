/**
 * Configuration singletons under `config/`.
 *
 * Tax rates, KPI targets, scorecard weights and priority tunables all live here
 * so finance and management can change them without a deploy. Admin-only, by
 * the security rules.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { KpiTargets, PriorityConfig, ProjectKpiWeights, TaxConfig, TechnicianKpiWeights } from '../lib/schema.js';
import { VAT_RATE_BPS, WHT } from '../lib/money.js';
import { DEFAULT_KPI_TARGETS } from '../lib/kpi.js';
import { DEFAULT_PRIORITY_CONFIG } from '../lib/priority.js';
import { DEFAULT_PROJECT_WEIGHTS, DEFAULT_TECHNICIAN_WEIGHTS, assertWeightsValid } from '../lib/scorecard.js';
import { stampUpdate } from './audit.js';
import { db } from '../firebase.js';

const PATH = 'config';

export const DEFAULT_TAX_CONFIG: Omit<TaxConfig, 'effectiveFrom'> = {
  vatRateBps: VAT_RATE_BPS,
  whtGoodsBps: WHT.GOODS_BPS,
  whtServicesBps: WHT.SERVICES_BPS,
  whtNoTinBps: WHT.NO_TIN_BPS,
  whtGoodsThresholdSantim: WHT.GOODS_THRESHOLD_SANTIM,
  whtServicesThresholdSantim: WHT.SERVICES_THRESHOLD_SANTIM,
  companyTin: '',
  companyVatRegNo: '',
};

/**
 * Read a config document, falling back to the shipped defaults.
 *
 * The fallback matters: the app must work on a freshly created Firebase project
 * before anyone has opened Settings, and a missing config document should not
 * mean a broken VAT calculation.
 */
async function readWithDefault<T>(docId: string, fallback: T): Promise<T> {
  const snapshot = await getDoc(doc(db, PATH, docId));
  if (!snapshot.exists()) return fallback;
  return { ...fallback, ...(snapshot.data() as Partial<T>) };
}

export function getTaxConfig() {
  return readWithDefault('tax', DEFAULT_TAX_CONFIG);
}

export function getKpiTargets() {
  return readWithDefault<KpiTargets>('kpiTargets', { ...DEFAULT_KPI_TARGETS });
}

export function getPriorityConfig() {
  return readWithDefault<PriorityConfig>('priority', { ...DEFAULT_PRIORITY_CONFIG });
}

export function getKpiWeights() {
  return readWithDefault<{ project: ProjectKpiWeights; technician: TechnicianKpiWeights }>('kpiWeights', {
    project: { ...DEFAULT_PROJECT_WEIGHTS },
    technician: { ...DEFAULT_TECHNICIAN_WEIGHTS },
  });
}

export async function saveTaxConfig(config: Partial<TaxConfig>, uid: string): Promise<void> {
  await setDoc(doc(db, PATH, 'tax'), { ...config, ...stampUpdate(uid) }, { merge: true });
}

export async function saveKpiTargets(targets: Partial<KpiTargets>, uid: string): Promise<void> {
  await setDoc(doc(db, PATH, 'kpiTargets'), { ...targets, ...stampUpdate(uid) }, { merge: true });
}

export async function savePriorityConfig(config: Partial<PriorityConfig>, uid: string): Promise<void> {
  await setDoc(doc(db, PATH, 'priority'), { ...config, ...stampUpdate(uid) }, { merge: true });
}

/**
 * Weights are validated before they are stored. A composite built on weights
 * that do not sum to 100% silently means something other than what it claims,
 * and the place to catch that is the write, not the read.
 */
export async function saveKpiWeights(
  weights: { project: ProjectKpiWeights; technician: TechnicianKpiWeights },
  uid: string,
): Promise<void> {
  assertWeightsValid(weights.project as unknown as Record<string, number>);
  assertWeightsValid(weights.technician as unknown as Record<string, number>);
  await setDoc(doc(db, PATH, 'kpiWeights'), { ...weights, ...stampUpdate(uid) }, { merge: true });
}
