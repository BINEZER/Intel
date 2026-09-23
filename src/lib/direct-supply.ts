/**
 * Equipment the client pays the manufacturer for directly.
 *
 * WHAT THIS IS
 *   On some contracts IntelMotion supplies the installation and nothing else:
 *   the lift itself is bought by the client straight from the factory, in US
 *   dollars, and that money never passes through this company. The figure is
 *   worth recording — it says how big the job really is, and a contract for
 *   four lifts reads very differently next to the equipment they cost — but it
 *   is not revenue, not a receivable, and not part of any total.
 *
 * WHY IT DOES NOT REUSE `ForeignAmount`
 *   That type exists for money that IS ours but was invoiced in a foreign
 *   currency. It carries a rate, because its whole purpose is to produce the
 *   ETB figure that VAT and the returns are computed from.
 *
 *   Reusing it here would manufacture precisely the number that must not exist:
 *   a birr amount, sitting on a contract, indistinguishable from the birr
 *   amounts around it, one careless `+` away from the order book. So this type
 *   carries NO rate and NO ETB equivalent. There is nothing to add up, which is
 *   a stronger guarantee than a comment asking people not to.
 *
 * THE NAMING RULE THIS RELIES ON
 *   Every ETB amount in the schema ends `...Santim`. This one ends
 *   `...UsdCents` and always will. Anything summing money looks for the first
 *   suffix and cannot reach the second by accident.
 */

/** Money the client pays somebody else. Never ours. */
export interface DirectSupply {
  /** Integer cents. Never converted to birr; see the header. */
  amountUsdCents: number;
  /** Who it is paid to, where it is known — the factory or the trader. */
  paidTo?: string;
  /** What it covers, in the words on the agreement. */
  note?: string;
}

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `USD 118,500.00`. Spelled out, never `$`, so it cannot be read as birr. */
export function formatUSD(cents: number): string {
  return `USD ${USD.format(cents / 100).replace(/^\$/, '')}`;
}

/**
 * Dollars as typed into a form, as integer cents.
 *
 * Returns null for anything that is not a number, rather than 0 — a blank box
 * and a genuine zero are different answers, and storing one as the other would
 * put "USD 0.00" on a contract nobody has recorded a figure for.
 */
export function usdCentsFrom(input: string): number | null {
  const trimmed = input.trim().replace(/,/g, '');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Cents back to the plain number a form field shows. */
export function usdCentsToInput(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '' : (cents / 100).toFixed(2);
}

/**
 * What a contract carries, or null where it carries nothing.
 *
 * A zero is treated as nothing: somebody who typed 0 meant "none", and a
 * contract showing "USD 0.00 paid direct" invites the question of what happened
 * to the money.
 */
export function directSupplyOf(
  contract: { equipmentPaidDirect?: DirectSupply | null } | null | undefined,
): DirectSupply | null {
  const found = contract?.equipmentPaidDirect;
  if (found === null || found === undefined) return null;
  return found.amountUsdCents > 0 ? found : null;
}

/**
 * The total across a set of contracts, for a line that says what it is.
 *
 * Returned in CENTS, and deliberately never alongside a birr figure: every
 * place this is shown says "paid to the manufacturer" beside it, because a
 * number on its own in a finance screen is read as money we are owed.
 */
export function totalDirectUsdCents(
  contracts: readonly { equipmentPaidDirect?: DirectSupply | null }[],
): number {
  return contracts.reduce((sum, contract) => sum + (directSupplyOf(contract)?.amountUsdCents ?? 0), 0);
}

/** How many of them carry one. */
export function countWithDirectSupply(
  contracts: readonly { equipmentPaidDirect?: DirectSupply | null }[],
): number {
  return contracts.filter((contract) => directSupplyOf(contract) !== null).length;
}

/** One line for a contract row, or null when there is nothing to say. */
export function describeDirectSupply(supply: DirectSupply | null): string | null {
  if (supply === null) return null;
  const who = supply.paidTo === undefined || supply.paidTo.trim() === '' ? 'the manufacturer' : supply.paidTo;
  return `${formatUSD(supply.amountUsdCents)} paid by the client directly to ${who} — not ours, and not in any figure here.`;
}
