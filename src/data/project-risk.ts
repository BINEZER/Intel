/**
 * Portfolio risk, computed once.
 *
 * `project.risk` is not a stored field — the schema has no such thing, and a
 * stored verdict would be stale the moment an invoice went overdue. So risk is
 * derived from the records every time it is shown.
 *
 * This file exists because that derivation was being written out at each call
 * site. Two pages computing "in danger" from the same inputs by slightly
 * different routes is how a project ends up flagged on one screen and clear on
 * the next, and no one can say which is right.
 */

import { computeProjectKpis } from '../lib/kpi.js';
import { assessProjectRisk } from '../lib/risk.js';
import type { Contract, Invoice, Project, RiskAssessment } from '../lib/schema.js';
import type { WithId } from './repository.js';

export interface ProjectRiskRow {
  project: WithId<Project>;
  contract: WithId<Contract> | undefined;
  invoices: WithId<Invoice>[];
  overdueReceivableSantim: number;
  oldestOverdueDays: number | null;
  risk: RiskAssessment;
}

const DAY_MS = 86_400_000;

export function assessPortfolioRisk(
  projects: readonly WithId<Project>[],
  contracts: readonly WithId<Contract>[],
  invoices: readonly WithId<Invoice>[],
  asOf: Date,
): ProjectRiskRow[] {
  // A project and its contract are linked from BOTH sides — contracts carry
  // projectId, projects carry contractId — and different parts of the app were
  // written against different ones. Honouring both is the only way this returns
  // the same contract the rest of the app would.
  const contractByProject = new Map(
    contracts.filter((c) => c.projectId !== undefined).map((c) => [c.projectId as string, c]),
  );
  const contractById = new Map(contracts.map((c) => [c.id, c]));

  const invoicesByProject = new Map<string, WithId<Invoice>[]>();
  for (const invoice of invoices) {
    if (invoice.projectId === null) continue;
    invoicesByProject.set(invoice.projectId, [...(invoicesByProject.get(invoice.projectId) ?? []), invoice]);
  }

  return projects.map((project) => {
    const contract =
      contractByProject.get(project.id) ??
      (project.contractId === null ? undefined : contractById.get(project.contractId));
    const projectInvoices = invoicesByProject.get(project.id) ?? [];

    const invoicedGrossSantim = projectInvoices.reduce((a, i) => a + i.grossSantim, 0);
    const collectedGrossSantim = projectInvoices.reduce((a, i) => a + i.paidGrossSantim, 0);

    const kpi = computeProjectKpis(
      {
        plannedStart: project.plannedStart.at.toDate(),
        plannedEnd: project.plannedEnd.at.toDate(),
        actualStart: project.actualStart?.at.toDate() ?? null,
        actualEnd: project.actualEnd?.at.toDate() ?? null,
        progressBps: project.progressBps,
        status: project.status,
        contractNetSantim: contract?.valueNetSantim ?? 0,
        subcontractCostNetSantim: project.financials?.subcontractCostNetSantim ?? 0,
        invoicedNetSantim: projectInvoices.reduce((a, i) => a + i.netSantim, 0),
        invoicedGrossSantim,
        collectedGrossSantim,
        phases: [],
        settledInvoices: [],
      },
      asOf,
    );

    // A draft was never issued and a void was cancelled; neither is a debt.
    const overdue = projectInvoices.filter(
      (i) =>
        i.status !== 'draft' &&
        i.status !== 'void' &&
        i.balanceGrossSantim > 0 &&
        i.dueDate.at.toDate() < asOf,
    );

    const oldestOverdueDays =
      overdue.length === 0
        ? null
        : Math.max(...overdue.map((i) => Math.round((asOf.getTime() - i.dueDate.at.toDate().getTime()) / DAY_MS)));

    return {
      project,
      contract,
      invoices: projectInvoices,
      overdueReceivableSantim: overdue.reduce((a, i) => a + i.balanceGrossSantim, 0),
      oldestOverdueDays,
      risk: assessProjectRisk({
        kpi,
        status: project.status,
        overdueReceivableSantim: overdue.reduce((a, i) => a + i.balanceGrossSantim, 0),
        oldestOverdueDays,
        assignedTechnicians: 0,
        expiredCertifications: 0,
        teamRepeatCalloutBps: null,
        daysSinceProgressChange: null,
      }),
    };
  });
}
