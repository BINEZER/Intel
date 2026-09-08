/**
 * ETB money and Ethiopian tax arithmetic.
 *
 * DESIGN RULE FOR THIS CODEBASE:
 *   Money is NEVER a float. Every amount is an integer count of santim
 *   (1 ETB = 100 santim) stored in a field suffixed `...Santim`.
 *   Rates are integer basis points (bps) in a field suffixed `...Bps`:
 *   15% VAT = 1500 bps, 2% WHT = 200 bps.
 *
 * This makes contract totals, VAT and WHT reconcile to the santim, which is
 * what an ERCA audit actually checks.
 */

export const CURRENCY = 'ETB' as const;

/** Standard Ethiopian VAT rate. Overridable per-tenant via `config/tax`. */
export const VAT_RATE_BPS = 1500;

/**
 * Domestic withholding tax rates (Income Tax Proclamation 979/2016 and its
 * regulations). Thresholds and rates live in `config/tax` so finance can
 * adjust them without a deploy — CONFIRM current values with the company's
 * tax advisor before go-live.
 */
export const WHT = {
  /** Supply of goods. */
  GOODS_BPS: 200,
  /** Services / works. */
  SERVICES_BPS: 300,
  /** Penalty rate applied when the supplier cannot produce a TIN. */
  NO_TIN_BPS: 3000,
  /** Below this per-transaction value, no WHT is withheld on goods. */
  GOODS_THRESHOLD_SANTIM: 10_000_00,
  /** Below this per-transaction value, no WHT is withheld on services. */
  SERVICES_THRESHOLD_SANTIM: 3_000_00,
} as const;

export type WhtCategory = 'goods' | 'services' | 'exempt';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Multiply a santim amount by a basis-point rate, rounding half-up to the santim. */
export function applyBps(santim: number, bps: number): number {
  assertSantim(santim);
  if (!Number.isInteger(bps) || bps < 0) throw new RangeError(`bps must be a non-negative integer, got ${bps}`);
  const sign = santim < 0 ? -1 : 1;
  return sign * Math.round((Math.abs(santim) * bps) / 10_000);
}

export function birrToSantim(birr: number): number {
  if (!Number.isFinite(birr)) throw new TypeError(`birr must be finite, got ${birr}`);
  return Math.round(birr * 100);
}

export function santimToBirr(santim: number): number {
  assertSantim(santim);
  return santim / 100;
}

/** `ETB 1,150,000.00` — the canonical display format. */
export function formatETB(santim: number, opts: { withSymbol?: boolean } = {}): string {
  assertSantim(santim);
  const body = (santim / 100).toLocaleString('en-ET', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return opts.withSymbol === false ? body : `ETB ${body}`;
}

// ---------------------------------------------------------------------------
// VAT — revenue side (what we charge the client)
// ---------------------------------------------------------------------------

export interface VatBreakdown {
  /** Taxable base, VAT-exclusive. */
  netSantim: number;
  vatRateBps: number;
  vatSantim: number;
  /** What the client actually owes. */
  grossSantim: number;
}

/** Add VAT to a VAT-exclusive figure. This is the normal path for contracts and invoices. */
export function addVat(netSantim: number, vatRateBps: number = VAT_RATE_BPS): VatBreakdown {
  assertSantim(netSantim);
  const vatSantim = applyBps(netSantim, vatRateBps);
  return { netSantim, vatRateBps, vatSantim, grossSantim: netSantim + vatSantim };
}

/**
 * Back out VAT from a VAT-INCLUSIVE figure — needed when a client negotiates
 * "1,150,000 all in" and we must record the taxable base correctly.
 * The net is derived first, then VAT is the remainder, so net + vat === gross
 * always holds exactly with no lost santim.
 */
export function extractVat(grossSantim: number, vatRateBps: number = VAT_RATE_BPS): VatBreakdown {
  assertSantim(grossSantim);
  const sign = grossSantim < 0 ? -1 : 1;
  const netSantim = sign * Math.round((Math.abs(grossSantim) * 10_000) / (10_000 + vatRateBps));
  return { netSantim, vatRateBps, vatSantim: grossSantim - netSantim, grossSantim };
}

/** Sum many VAT-exclusive line amounts, applying VAT once to the total. */
export function sumWithVat(netLineSantim: readonly number[], vatRateBps: number = VAT_RATE_BPS): VatBreakdown {
  return addVat(netLineSantim.reduce((a, b) => a + b, 0), vatRateBps);
}

// ---------------------------------------------------------------------------
// WHT — disbursement side (what we withhold from subcontractors)
// ---------------------------------------------------------------------------

export interface WhtInput {
  /** Subcontractor's taxable base, VAT-EXCLUSIVE. WHT never applies to VAT. */
  netSantim: number;
  category: WhtCategory;
  /** Whether the subcontractor charged us VAT (they must be VAT-registered to do so). */
  supplierVatRegistered: boolean;
  /** No TIN on the invoice triggers the 30% penalty rate. */
  supplierHasTin: boolean;
  /** Override the rate table, e.g. for a rate set in the subcontract. */
  overrideWhtRateBps?: number;
  vatRateBps?: number;
  thresholds?: { goodsSantim: number; servicesSantim: number };
}

export interface DisbursementBreakdown {
  netSantim: number;
  vatRateBps: number;
  /** VAT the subcontractor charges us — recoverable as input VAT. */
  supplierVatSantim: number;
  /** Face value of the subcontractor's invoice. */
  grossSantim: number;
  whtCategory: WhtCategory;
  whtRateBps: number;
  /** Always the VAT-exclusive base. */
  whtBaseSantim: number;
  whtSantim: number;
  /** Cash actually leaving the bank: gross invoice less WHT withheld. */
  netPayableSantim: number;
  /** Set when WHT was skipped, for the audit trail. */
  whtExemptReason?: 'below_threshold' | 'category_exempt';
}

/**
 * Compute a subcontractor phase payment.
 *
 * Worked example — 100,000 ETB of installation services from a VAT-registered
 * subcontractor with a TIN:
 *   net 100,000 + VAT 15,000 = invoice 115,000
 *   WHT 3% of 100,000 = 3,000  (on the net, NOT on the 115,000)
 *   we pay 112,000 and remit 3,000 to ERCA with a withholding certificate.
 */
export function computeDisbursement(input: WhtInput): DisbursementBreakdown {
  assertSantim(input.netSantim);
  const vatRateBps = input.vatRateBps ?? VAT_RATE_BPS;
  const supplierVatSantim = input.supplierVatRegistered ? applyBps(input.netSantim, vatRateBps) : 0;
  const grossSantim = input.netSantim + supplierVatSantim;

  const thresholds = input.thresholds ?? {
    goodsSantim: WHT.GOODS_THRESHOLD_SANTIM,
    servicesSantim: WHT.SERVICES_THRESHOLD_SANTIM,
  };

  const base = {
    netSantim: input.netSantim,
    vatRateBps,
    supplierVatSantim,
    grossSantim,
    whtCategory: input.category,
    whtBaseSantim: input.netSantim,
  };

  if (input.category === 'exempt') {
    return {
      ...base, whtRateBps: 0, whtSantim: 0,
      netPayableSantim: grossSantim, whtExemptReason: 'category_exempt',
    };
  }

  const threshold = input.category === 'goods' ? thresholds.goodsSantim : thresholds.servicesSantim;
  if (input.netSantim < threshold) {
    return {
      ...base, whtRateBps: 0, whtSantim: 0,
      netPayableSantim: grossSantim, whtExemptReason: 'below_threshold',
    };
  }

  const whtRateBps =
    input.overrideWhtRateBps ??
    (!input.supplierHasTin
      ? WHT.NO_TIN_BPS
      : input.category === 'goods'
        ? WHT.GOODS_BPS
        : WHT.SERVICES_BPS);

  const whtSantim = applyBps(input.netSantim, whtRateBps);
  return { ...base, whtRateBps, whtSantim, netPayableSantim: grossSantim - whtSantim };
}

// ---------------------------------------------------------------------------
// Project margin
// ---------------------------------------------------------------------------

export interface ProjectFinancials {
  contractNetSantim: number;
  contractVatSantim: number;
  contractGrossSantim: number;
  /** Subcontractor cost, VAT-exclusive — the figure that hits the P&L. */
  subcontractCostNetSantim: number;
  subcontractInputVatSantim: number;
  whtWithheldSantim: number;
  /** Cash disbursed to subcontractors, net of WHT. */
  cashDisbursedSantim: number;
  /** contractNet - subcontractCostNet. VAT is pass-through and excluded. */
  grossMarginSantim: number;
  /** Margin as basis points of contract net; 0 when the contract has no value. */
  grossMarginBps: number;
  /** Output VAT less input VAT — what we remit to ERCA for the period. */
  netVatPayableSantim: number;
}

export function rollUpProject(
  contract: Pick<VatBreakdown, 'netSantim' | 'vatSantim' | 'grossSantim'>,
  disbursements: readonly DisbursementBreakdown[],
): ProjectFinancials {
  const subcontractCostNetSantim = disbursements.reduce((a, d) => a + d.netSantim, 0);
  const subcontractInputVatSantim = disbursements.reduce((a, d) => a + d.supplierVatSantim, 0);
  const whtWithheldSantim = disbursements.reduce((a, d) => a + d.whtSantim, 0);
  const cashDisbursedSantim = disbursements.reduce((a, d) => a + d.netPayableSantim, 0);
  const grossMarginSantim = contract.netSantim - subcontractCostNetSantim;

  return {
    contractNetSantim: contract.netSantim,
    contractVatSantim: contract.vatSantim,
    contractGrossSantim: contract.grossSantim,
    subcontractCostNetSantim,
    subcontractInputVatSantim,
    whtWithheldSantim,
    cashDisbursedSantim,
    grossMarginSantim,
    grossMarginBps:
      contract.netSantim === 0 ? 0 : Math.round((grossMarginSantim * 10_000) / contract.netSantim),
    netVatPayableSantim: contract.vatSantim - subcontractInputVatSantim,
  };
}

// ---------------------------------------------------------------------------

function assertSantim(n: number): void {
  if (!Number.isInteger(n)) {
    throw new TypeError(`Money must be an integer count of santim, got ${n}. Use birrToSantim().`);
  }
  if (!Number.isSafeInteger(n)) throw new RangeError(`Santim amount exceeds safe integer range: ${n}`);
}
