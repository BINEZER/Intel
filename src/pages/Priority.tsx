/**
 * Priority route. Assembles the KPI, risk and priority engines over the
 * portfolio — the same composition a Cloud Function will do nightly once the
 * collections are live.
 */

import { computeProjectKpis } from '../lib/kpi.js';
import { assessProjectRisk } from '../lib/risk.js';
import { DEFAULT_PRIORITY_CONFIG, rankProjects } from '../lib/priority.js';
import { PriorityBoard, type PriorityRow } from './PriorityBoard.js';
import { SAMPLE_PORTFOLIO, SAMPLE_PROJECT } from './sample-kpi-data.js';

export function Priority() {
  const now = new Date();
  const asOf = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  // 1. KPIs per project, 2. risk from those KPIs, 3. rank on cash + risk.
  const scored = SAMPLE_PORTFOLIO.map((sample) => {
    const kpi = { ...computeProjectKpis(SAMPLE_PROJECT, asOf), ...sample.kpiOverrides };
    const risk = assessProjectRisk({ ...sample.risk, kpi });
    return { ...sample.priority, risk };
  });

  const ranked = rankProjects(scored, asOf, DEFAULT_PRIORITY_CONFIG);

  const rows: PriorityRow[] = ranked.map((r) => {
    const source = scored.find((s) => s.projectId === r.projectId);
    return { ...r, title: source?.title ?? r.projectId, clientName: source?.clientName ?? '' };
  });

  return <PriorityBoard rows={rows} horizonDays={DEFAULT_PRIORITY_CONFIG.horizonDays} />;
}
