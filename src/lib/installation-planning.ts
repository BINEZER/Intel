/**
 * Management-configured installation duration benchmarks.
 *
 * Estimates are crew-days, not calendar days. No assumed IntelMotion production
 * rates are shipped: management must enter validated standards before the app
 * presents a forecast. A lift is matched against stops, rated kg, type and speed.
 */

export interface InstallationDurationStandard {
  id: string;
  label: string;
  minStops: number;
  maxStops: number;
  minCapacityKg: number;
  maxCapacityKg: number;
  elevatorType: string;
  minSpeedMps: number | null;
  maxSpeedMps: number | null;
  mechanicalDays: number;
  electricalDays: number;
  commissioningDays: number;
}

export interface InstallationLiftSpec {
  stops?: number;
  capacityKg?: number;
  type?: string;
  speedMps?: number;
}

export interface InstallationDurationEstimate {
  standard: InstallationDurationStandard;
  mechanicalCrewDays: number;
  electricalCrewDays: number;
  commissioningCrewDays: number;
  totalCrewDays: number;
}

export function validateInstallationStandard(row: InstallationDurationStandard): string | null {
  if (!row.label.trim()) return 'Give this benchmark a name.';
  if (!Number.isInteger(row.minStops) || !Number.isInteger(row.maxStops) || row.minStops < 1 || row.maxStops < row.minStops) {
    return 'Stop range must be whole numbers, with the maximum at least the minimum.';
  }
  if (!Number.isFinite(row.minCapacityKg) || !Number.isFinite(row.maxCapacityKg) || row.minCapacityKg < 0 || row.maxCapacityKg < row.minCapacityKg) {
    return 'Rated-capacity range is invalid.';
  }
  if (row.minSpeedMps !== null && (!Number.isFinite(row.minSpeedMps) || row.minSpeedMps < 0)) return 'Minimum speed must be zero or greater.';
  if (row.maxSpeedMps !== null && (!Number.isFinite(row.maxSpeedMps) || row.maxSpeedMps < 0 || (row.minSpeedMps !== null && row.maxSpeedMps < row.minSpeedMps))) return 'Maximum speed is invalid.';
  for (const [label, value] of [['Mechanical', row.mechanicalDays], ['Electrical', row.electricalDays], ['Commissioning', row.commissioningDays]] as const) {
    if (!Number.isFinite(value) || value < 0) return label + ' days must be zero or greater.';
  }
  if (row.mechanicalDays + row.electricalDays + row.commissioningDays <= 0) return 'Enter at least one positive duration.';
  return null;
}

export function matchInstallationStandard(
  spec: InstallationLiftSpec,
  standards: readonly InstallationDurationStandard[],
): InstallationDurationStandard | null {
  if (spec.stops === undefined || spec.capacityKg === undefined) return null;
  const matches = standards.filter((row) =>
    spec.stops! >= row.minStops &&
    spec.stops! <= row.maxStops &&
    spec.capacityKg! >= row.minCapacityKg &&
    spec.capacityKg! <= row.maxCapacityKg &&
    (row.elevatorType === '' || row.elevatorType.toLowerCase() === (spec.type ?? '').toLowerCase()) &&
    (row.minSpeedMps === null || (spec.speedMps !== undefined && spec.speedMps >= row.minSpeedMps)) &&
    (row.maxSpeedMps === null || (spec.speedMps !== undefined && spec.speedMps <= row.maxSpeedMps))
  );
  // Ambiguous overlapping benchmarks are not silently resolved by array order.
  return matches.length === 1 ? matches[0]! : null;
}

export function estimateInstallationCrewDays(
  spec: InstallationLiftSpec,
  standards: readonly InstallationDurationStandard[],
): InstallationDurationEstimate | null {
  const standard = matchInstallationStandard(spec, standards);
  if (standard === null) return null;
  const mechanicalCrewDays = standard.mechanicalDays;
  const electricalCrewDays = standard.electricalDays;
  const commissioningCrewDays = standard.commissioningDays;
  return {
    standard,
    mechanicalCrewDays,
    electricalCrewDays,
    commissioningCrewDays,
    totalCrewDays: mechanicalCrewDays + electricalCrewDays + commissioningCrewDays,
  };
}
