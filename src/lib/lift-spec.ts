/**
 * A lift's technical data: what it lifts, how fast, how far.
 *
 * WHERE IT LIVES, AND WHY THAT MATTERS
 *   On the LIFT, in `units`, and nowhere else. The machine outlives the project
 *   that installed it and the contract that services it — a lift installed in
 *   2019 is still the same 630 kg, 8-stop machine when a different contractor
 *   maintains it in 2031 — so its specification belongs to the machine.
 *
 *   `Project.units[]` used to carry a second copy of the capacity and the stop
 *   count. Nothing ever read it. Two fields holding one fact drift apart, and
 *   the one that drifts is always the one somebody is looking at, so the copy
 *   is gone and the project reads the lift records instead.
 *
 * MISSING IS NOT ZERO
 *   An unrecorded capacity is unknown, not 0 kg. Every field here is optional
 *   and absent means absent: a spec line says what it knows and leaves out what
 *   it does not, rather than printing a dash for every field the workbook never
 *   carried.
 */

export interface LiftSpec {
  capacityKg?: number;
  personCapacity?: number;
  speedMps?: number;
  stops?: number;
  /** Passenger, goods, bed, panoramic, escalator. */
  type?: string;
  brand?: string;
  model?: string;
}

/** Is there anything recorded at all? */
export function hasSpec(spec: LiftSpec | null | undefined): boolean {
  if (spec === null || spec === undefined) return false;
  return (
    spec.capacityKg !== undefined ||
    spec.personCapacity !== undefined ||
    spec.speedMps !== undefined ||
    spec.stops !== undefined ||
    (spec.type !== undefined && spec.type !== '') ||
    (spec.brand !== undefined && spec.brand !== '') ||
    (spec.model !== undefined && spec.model !== '')
  );
}

/**
 * The specification in one line: `630 kg · 8 persons · 1.0 m/s · 8 stops`.
 *
 * Ordered by what a person asks first. Capacity is the headline — it is how
 * lifts are talked about on site — and the stop count comes last because it is
 * the one people look up rather than remember.
 */
export function describeSpec(spec: LiftSpec | null | undefined): string | null {
  if (!hasSpec(spec)) return null;
  const s = spec as LiftSpec;
  const parts: string[] = [];
  if (s.capacityKg !== undefined) parts.push(`${s.capacityKg.toLocaleString('en-US')} kg`);
  if (s.personCapacity !== undefined) parts.push(`${s.personCapacity} persons`);
  if (s.speedMps !== undefined) parts.push(`${s.speedMps} m/s`);
  if (s.stops !== undefined) parts.push(`${s.stops} stop${s.stops === 1 ? '' : 's'}`);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** The make, where it is known: `Sicher · SC-1000`. */
export function describeMake(spec: LiftSpec | null | undefined): string | null {
  if (spec === null || spec === undefined) return null;
  const parts = [spec.brand, spec.model].filter(
    (part): part is string => part !== undefined && part.trim() !== '',
  );
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * What is not recorded yet, so a page can ask for it rather than showing a row
 * of dashes.
 *
 * Only the four that matter operationally: a crew needs the capacity and the
 * stops to plan, and the speed and person capacity to check against the
 * authority certificate. Brand and model are useful and never blocking.
 */
export function missingSpecFields(spec: LiftSpec | null | undefined): string[] {
  const s = spec ?? {};
  const missing: string[] = [];
  if (s.capacityKg === undefined) missing.push('capacity');
  if (s.stops === undefined) missing.push('stops');
  if (s.speedMps === undefined) missing.push('speed');
  if (s.personCapacity === undefined) missing.push('person capacity');
  return missing;
}

/**
 * One sentence about a set of lifts, for a project or a programme.
 *
 * Says how many share a specification rather than listing each: four identical
 * lifts in one shaft bank is the common case, and repeating the same line four
 * times is noise where "4 × 630 kg · 8 stops" is information.
 */
export function describeFleet(
  lifts: readonly { tag: string; spec: LiftSpec }[],
): string | null {
  if (lifts.length === 0) return null;

  const byLine = new Map<string, number>();
  let unknown = 0;
  for (const lift of lifts) {
    const line = describeSpec(lift.spec);
    if (line === null) unknown += 1;
    else byLine.set(line, (byLine.get(line) ?? 0) + 1);
  }

  const parts = [...byLine.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([line, count]) => (count === 1 ? line : `${count} × ${line}`));

  if (unknown > 0) {
    parts.push(`${unknown} with no specification recorded`);
  }
  return parts.length === 0 ? null : parts.join('; ');
}
