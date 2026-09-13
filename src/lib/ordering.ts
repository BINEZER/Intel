/**
 * Sparse ordering for drag-and-drop.
 *
 * THE POINT OF THIS FILE
 *
 *   Moving one card must write ONE document. The naive approach — store
 *   position 0,1,2,3 and renumber on every drag — writes the whole column on
 *   every move. On a board with 40 cards that is 40 writes for one drag, it
 *   races two people reordering at once, and it bills for all of it.
 *
 *   So orders are sparse integers spaced 1024 apart, and an insertion takes the
 *   midpoint of its neighbours. Only the moved card is written.
 *
 * Integers rather than fractions: a float midpoint exhausts double precision
 * after about fifty insertions at the same spot and then silently stops
 * separating cards. An integer midpoint either fits or it does not, and when it
 * does not this module says so out loud and asks for a rebalance.
 */

/** Distance between freshly seeded neighbours. */
export const ORDER_GAP = 1024;

export interface Ordered {
  id: string;
  order: number;
}

/** Seed orders for a new column: 1024, 2048, 3072... */
export function seedOrders(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * ORDER_GAP);
}

export type OrderResult = { ok: true; order: number } | { ok: false; reason: 'no_gap' };

/**
 * An order that sorts strictly between `prev` and `next`.
 *
 * `null` means "no neighbour on that side" — the start or the end of a column.
 * Returns `no_gap` when the neighbours are adjacent integers and nothing can be
 * placed between them; the caller must rebalance.
 */
export function orderBetween(prev: number | null, next: number | null): OrderResult {
  if (prev === null && next === null) return { ok: true, order: ORDER_GAP };
  if (prev === null) return { ok: true, order: (next as number) - ORDER_GAP };
  if (next === null) return { ok: true, order: prev + ORDER_GAP };

  if (next - prev <= 1) return { ok: false, reason: 'no_gap' };
  return { ok: true, order: Math.floor((prev + next) / 2) };
}

/** Evenly respace a column, restoring room to insert. */
export function rebalance<T extends Ordered>(items: readonly T[]): { id: string; order: number }[] {
  return [...items]
    .sort(byOrder)
    .map((item, i) => ({ id: item.id, order: (i + 1) * ORDER_GAP }));
}

export function byOrder(a: Ordered, b: Ordered): number {
  // Ties break on id so the sort is total and stable across clients — two cards
  // sharing an order must not swap places depending on who is looking.
  return a.order - b.order || a.id.localeCompare(b.id);
}

export type MovePlan =
  | { kind: 'noop' }
  | { kind: 'update'; id: string; order: number }
  | { kind: 'rebalance'; writes: { id: string; order: number }[] };

/**
 * Plan a move of `itemId` to `targetIndex` within `items`.
 *
 * `targetIndex` is the position in the list AFTER the item is removed from
 * wherever it was — which is what a drop between two cards means, and avoids
 * the classic off-by-one where dragging a card one place down does nothing.
 *
 * Returns the smallest write that achieves the move: usually one document,
 * occasionally a whole-column rebalance when the gap has been used up.
 */
export function planMove<T extends Ordered>(
  items: readonly T[],
  itemId: string,
  targetIndex: number,
): MovePlan {
  const sorted = [...items].sort(byOrder);
  const currentIndex = sorted.findIndex((i) => i.id === itemId);
  if (currentIndex === -1) return { kind: 'noop' };

  const without = sorted.filter((i) => i.id !== itemId);
  const index = Math.max(0, Math.min(without.length, targetIndex));

  // Already there: dropping a card back where it came from is not a write.
  if (currentIndex === index && sorted[currentIndex]?.id === itemId) {
    const unchanged = without[index - 1]?.order ?? null;
    const following = without[index]?.order ?? null;
    const existing = sorted[currentIndex] as T;
    if (
      (unchanged === null || existing.order > unchanged) &&
      (following === null || existing.order < following)
    ) {
      return { kind: 'noop' };
    }
  }

  const prev = index > 0 ? (without[index - 1] as T).order : null;
  const next = index < without.length ? (without[index] as T).order : null;
  const result = orderBetween(prev, next);

  if (result.ok) return { kind: 'update', id: itemId, order: result.order };

  // No room. Respace the column with the card already in its new position, so
  // the rebalance and the move are one atomic write rather than two.
  const reordered = [...without.slice(0, index), sorted[currentIndex] as T, ...without.slice(index)];
  return {
    kind: 'rebalance',
    writes: reordered.map((item, i) => ({ id: item.id, order: (i + 1) * ORDER_GAP })),
  };
}

/**
 * Plan a move into a different column.
 *
 * The card's column changes and its order is computed against its NEW
 * neighbours — a card's order is only meaningful within its own column.
 */
export function planColumnMove<T extends Ordered>(
  targetColumnItems: readonly T[],
  itemId: string,
  targetIndex: number,
): { order: number } | { rebalance: { id: string; order: number }[]; order: number } {
  const sorted = [...targetColumnItems].filter((i) => i.id !== itemId).sort(byOrder);
  const index = Math.max(0, Math.min(sorted.length, targetIndex));

  const prev = index > 0 ? (sorted[index - 1] as T).order : null;
  const next = index < sorted.length ? (sorted[index] as T).order : null;
  const result = orderBetween(prev, next);

  if (result.ok) return { order: result.order };

  const orders = seedOrders(sorted.length + 1);
  const writes = sorted.map((item, i) => ({
    id: item.id,
    order: (orders[i < index ? i : i + 1] as number),
  }));
  return { rebalance: writes, order: orders[index] as number };
}

/** How much room is left in the tightest gap — surfaces a column needing a rebalance. */
export function smallestGap(items: readonly Ordered[]): number {
  const sorted = [...items].sort(byOrder);
  if (sorted.length < 2) return ORDER_GAP;
  let smallest = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    smallest = Math.min(smallest, (sorted[i] as Ordered).order - (sorted[i - 1] as Ordered).order);
  }
  return smallest;
}
