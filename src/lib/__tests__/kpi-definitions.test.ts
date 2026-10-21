import { describe, expect, it } from 'vitest';
import { DEFAULT_KPI_DEFINITIONS } from '../kpi-definitions.js';

describe('KPI definitions', () => {
  it('ships a unique, named catalogue of built-in measurements', () => {
    const keys = DEFAULT_KPI_DEFINITIONS.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(DEFAULT_KPI_DEFINITIONS.every((item) => item.label.trim() !== '')).toBe(true);
    expect(DEFAULT_KPI_DEFINITIONS.every((item) => item.builtIn)).toBe(true);
  });

  it('separates project and service measures by default', () => {
    expect(DEFAULT_KPI_DEFINITIONS.filter((item) => item.scope === 'project').length).toBeGreaterThan(0);
    expect(DEFAULT_KPI_DEFINITIONS.filter((item) => item.scope === 'service').length).toBeGreaterThan(0);
  });
});
