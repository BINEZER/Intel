import { describe, expect, it } from 'vitest';
import {
  byOrder,
  ORDER_GAP,
  orderBetween,
  planColumnMove,
  planMove,
  rebalance,
  seedOrders,
  smallestGap,
  type Ordered,
} from '../ordering.js';

const card = (id: string, order: number): Ordered => ({ id, order });
const ids = (items: readonly Ordered[]) => [...items].sort(byOrder).map((i) => i.id);

/** Apply a plan and return the resulting column, so tests assert on outcomes. */
function apply(items: readonly Ordered[], plan: ReturnType<typeof planMove>): Ordered[] {
  if (plan.kind === 'noop') return [...items];
  if (plan.kind === 'update') {
    return items.map((i) => (i.id === plan.id ? { ...i, order: plan.order } : i));
  }
  const byId = new Map(plan.writes.map((w) => [w.id, w.order]));
  return items.map((i) => ({ ...i, order: byId.get(i.id) ?? i.order }));
}

describe('orderBetween', () => {
  it('places a card between its neighbours', () => {
    expect(orderBetween(1024, 2048)).toEqual({ ok: true, order: 1536 });
  });

  it('places a card before the first and after the last', () => {
    expect(orderBetween(null, 1024)).toEqual({ ok: true, order: 0 });
    expect(orderBetween(3072, null)).toEqual({ ok: true, order: 3072 + ORDER_GAP });
  });

  it('handles the first card in an empty column', () => {
    expect(orderBetween(null, null)).toEqual({ ok: true, order: ORDER_GAP });
  });

  it('reports no gap when neighbours are adjacent integers', () => {
    // An integer midpoint either fits or it does not — no silent collapse.
    expect(orderBetween(100, 101)).toEqual({ ok: false, reason: 'no_gap' });
    expect(orderBetween(100, 100)).toEqual({ ok: false, reason: 'no_gap' });
  });

  it('goes negative before the first card rather than renumbering', () => {
    expect(orderBetween(null, 0)).toEqual({ ok: true, order: -ORDER_GAP });
  });
});

describe('a move writes one document', () => {
  const column = [card('a', 1024), card('b', 2048), card('c', 3072), card('d', 4096)];

  it('moves a card down with a single update', () => {
    // The whole point: 40 cards must not mean 40 writes.
    const plan = planMove(column, 'a', 2);
    expect(plan.kind).toBe('update');
    expect(ids(apply(column, plan))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves a card up with a single update', () => {
    const plan = planMove(column, 'd', 1);
    expect(plan.kind).toBe('update');
    expect(ids(apply(column, plan))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves a card to the top', () => {
    expect(ids(apply(column, planMove(column, 'c', 0)))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('moves a card to the bottom', () => {
    expect(ids(apply(column, planMove(column, 'a', 3)))).toEqual(['b', 'c', 'd', 'a']);
  });

  it('treats a drop back in place as a no-op, not a write', () => {
    expect(planMove(column, 'b', 1).kind).toBe('noop');
  });

  it('handles the classic one-place-down off-by-one', () => {
    // Target index is the position AFTER removal, so this really moves.
    expect(ids(apply(column, planMove(column, 'a', 1)))).toEqual(['b', 'a', 'c', 'd']);
  });

  it('clamps a target index beyond the ends', () => {
    expect(ids(apply(column, planMove(column, 'a', 99)))).toEqual(['b', 'c', 'd', 'a']);
    expect(ids(apply(column, planMove(column, 'd', -5)))).toEqual(['d', 'a', 'b', 'c']);
  });

  it('ignores a card that is not in the column', () => {
    expect(planMove(column, 'ghost', 0)).toEqual({ kind: 'noop' });
  });

  it('handles a single-card column', () => {
    expect(planMove([card('a', 1024)], 'a', 0).kind).toBe('noop');
  });
});

describe('rebalancing when the gap runs out', () => {
  it('rebalances rather than silently failing to separate cards', () => {
    const tight = [card('a', 100), card('b', 101), card('c', 5000)];
    const plan = planMove(tight, 'c', 1);
    expect(plan.kind).toBe('rebalance');
    expect(ids(apply(tight, plan))).toEqual(['a', 'c', 'b']);
  });

  it('respaces evenly so there is room again', () => {
    const respaced = rebalance([card('a', 1), card('b', 2), card('c', 3)]);
    expect(respaced.map((r) => r.order)).toEqual([1024, 2048, 3072]);
  });

  it('survives repeated insertion at the same spot', () => {
    // Midpointing the same gap is what exhausts a float scheme. Here it
    // eventually asks for a rebalance and carries on.
    let column: Ordered[] = [card('a', 1024), card('z', 2048)];
    for (let i = 0; i < 60; i++) {
      const id = `n${i}`;
      const sorted = [...column].sort(byOrder);
      const prev = sorted[0]!.order;
      const next = sorted[1]!.order;
      const result = orderBetween(prev, next);
      if (result.ok) {
        column = [...column, card(id, result.order)];
      } else {
        const respaced = rebalance(column);
        const byId = new Map(respaced.map((r) => [r.id, r.order]));
        column = column.map((c) => ({ ...c, order: byId.get(c.id) ?? c.order }));
        const s = [...column].sort(byOrder);
        const retry = orderBetween(s[0]!.order, s[1]!.order);
        expect(retry.ok).toBe(true);
        if (retry.ok) column = [...column, card(id, retry.order)];
      }
      // Every card keeps a distinct position, which is the property that matters.
      const orders = column.map((c) => c.order);
      expect(new Set(orders).size).toBe(orders.length);
    }
    expect(column).toHaveLength(62);
  });

  it('reports the tightest gap so a column needing attention is visible', () => {
    expect(smallestGap([card('a', 1024), card('b', 2048)])).toBe(1024);
    expect(smallestGap([card('a', 100), card('b', 101), card('c', 5000)])).toBe(1);
    expect(smallestGap([card('a', 1024)])).toBe(ORDER_GAP);
  });
});

describe('moving between columns', () => {
  const target = [card('x', 1024), card('y', 2048)];

  it('orders the card against its NEW neighbours', () => {
    const plan = planColumnMove(target, 'moved', 1);
    expect('order' in plan && plan.order).toBe(1536);
  });

  it('appends to the end of the target column', () => {
    const plan = planColumnMove(target, 'moved', 2);
    expect('order' in plan && plan.order).toBe(2048 + ORDER_GAP);
  });

  it('handles an empty target column', () => {
    expect(('order' in planColumnMove([], 'moved', 0)) && planColumnMove([], 'moved', 0).order)
      .toBe(ORDER_GAP);
  });

  it('rebalances the target when it has no room', () => {
    const tight = [card('x', 100), card('y', 101)];
    const plan = planColumnMove(tight, 'moved', 1);
    expect('rebalance' in plan).toBe(true);
    if ('rebalance' in plan) {
      const all = [...plan.rebalance, { id: 'moved', order: plan.order }];
      expect(ids(all)).toEqual(['x', 'moved', 'y']);
    }
  });

  it('ignores the card itself if it is already in the target column', () => {
    const plan = planColumnMove([card('x', 1024), card('moved', 2048)], 'moved', 0);
    expect('order' in plan && plan.order).toBe(0);
  });
});

describe('sorting is total', () => {
  it('breaks ties on id so two clients never disagree on order', () => {
    const tied = [card('b', 1024), card('a', 1024)];
    expect(ids(tied)).toEqual(['a', 'b']);
  });

  it('seeds a column with room between every card', () => {
    expect(seedOrders(3)).toEqual([1024, 2048, 3072]);
    expect(seedOrders(0)).toEqual([]);
  });
});
