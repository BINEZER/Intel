import { describe, expect, it } from 'vitest';
import {
  estimateInstallationCrewDays,
  matchInstallationStandard,
  validateInstallationStandard,
  type InstallationDurationStandard,
} from './installation-planning.js';

const standard: InstallationDurationStandard = {
  id: 'standard-1',
  label: 'Passenger lift 1–8 stops / up to 1000 kg',
  minStops: 1,
  maxStops: 8,
  minCapacityKg: 0,
  maxCapacityKg: 1000,
  elevatorType: 'Passenger',
  minSpeedMps: null,
  maxSpeedMps: null,
  mechanicalDays: 12,
  electricalDays: 5,
  commissioningDays: 2,
};

describe('installation duration standards', () => {
  it('validates ranges and positive duration', () => {
    expect(validateInstallationStandard(standard)).toBeNull();
    expect(validateInstallationStandard({ ...standard, maxStops: 0 })).toContain('Stop range');
    expect(validateInstallationStandard({ ...standard, mechanicalDays: 0, electricalDays: 0, commissioningDays: 0 })).toContain('positive duration');
  });

  it('matches on stop count, rated capacity and type', () => {
    expect(matchInstallationStandard({ stops: 8, capacityKg: 1000, type: 'Passenger' }, [standard])).toEqual(standard);
    expect(matchInstallationStandard({ stops: 9, capacityKg: 1000, type: 'Passenger' }, [standard])).toBeNull();
    expect(matchInstallationStandard({ stops: 8, capacityKg: 1001, type: 'Passenger' }, [standard])).toBeNull();
    expect(matchInstallationStandard({ stops: 8, capacityKg: 800, type: 'Goods' }, [standard])).toBeNull();
  });

  it('does not guess when lift specification is incomplete or standards overlap', () => {
    expect(estimateInstallationCrewDays({ stops: 8 }, [standard])).toBeNull();
    expect(matchInstallationStandard({ stops: 8, capacityKg: 800, type: 'Passenger' }, [standard, { ...standard, id: 'overlap' }])).toBeNull();
  });

  it('returns separate crew-day estimates for each discipline', () => {
    expect(estimateInstallationCrewDays({ stops: 8, capacityKg: 800, type: 'Passenger' }, [standard])).toMatchObject({
      mechanicalCrewDays: 12,
      electricalCrewDays: 5,
      commissioningCrewDays: 2,
      totalCrewDays: 19,
    });
  });
});
