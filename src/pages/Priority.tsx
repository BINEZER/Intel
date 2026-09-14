/**
 * Priority board, driven entirely by live records.
 *
 * Every figure here traces to a project, a contract or an invoice that exists.
 * There is no seeded data: an empty board means no projects, which is the truth
 * and is more useful than a convincing fiction.
 */

import { useMemo } from 'react';
import { subscribeProjects } from '../data/projects.js';
import { subscribeContracts } from '../data/contracts.js';
import { subscribeInvoices } from '../data/invoices.js';
import { useCollection } from '../data/useCollection.js';
import { computeProjectKpis } from '../lib/kpi.js';
import { assessProjectRisk } from '../lib/risk.js';
import { DEFAULT_PRIORITY_CONFIG, rankProjects, type PriorityInput } from '../lib/priority.js';
import { PriorityBoard, type PriorityRow } from './PriorityBoard.js';
import type { Contract, Invoice, Project } from '../lib/schema.js';
import { PrintButton, PrintHeader } from '../components/PrintButton.js';

export function Priority() {
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const invoices = useCollection<Invoice>((d, e) => subscribeInvoices(d, e), [], 'load invoices');

  const now = new Date();
  const asOf = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  const rows: PriorityRow[] = useMemo(() => {
    const scored: (PriorityInput & { title: string; clientName: string })[] = projects.rows.map(
      (project) => {
        const contract = contracts.rows.find((c) => c.id === project.contractId) ?? null;
        const projectInvoices = invoices.rows.filter((i) => i.projectId === project.id);

        const invoicedGrossSantim = projectInvoices
          .filter((i) => i.status !== 'draft' && i.status !== 'void')
          .reduce((a, i) => a + i.grossSantim, 0);
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
            : Math.max(
                ...overdue.map((i) =>
                  Math.round((asOf.getTime() - i.dueDate.at.toDate().getTime()) / 86_400_000),
                ),
              );

        return {
          projectId: project.id,
          title: project.title,
          clientName: project.clientName,
          contractNetSantim: contract?.valueNetSantim ?? 0,
          contractGrossSantim: contract?.valueGrossSantim ?? 0,
          invoicedGrossSantim,
          invoices: projectInvoices.map((i) => ({
            grossSantim: i.grossSantim,
            paidGrossSantim: i.paidGrossSantim,
            dueDate: i.dueDate.at.toDate(),
            status: i.status,
          })),
          milestones: [],
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
      },
    );

    return rankProjects(scored, asOf, DEFAULT_PRIORITY_CONFIG).map((ranked) => {
      const source = scored.find((s) => s.projectId === ranked.projectId);
      return {
        ...ranked,
        title: source?.title ?? ranked.projectId,
        clientName: source?.clientName ?? '',
      };
    });
  }, [projects.rows, contracts.rows, invoices.rows, asOf]);

  const loading = projects.loading || contracts.loading || invoices.loading;
  const error = projects.error ?? contracts.error ?? invoices.error;

  if (error !== null) return <p className="error" role="alert">{error}</p>;
  if (loading) return <p className="muted">Loading…</p>;

  if (rows.length === 0) {
    return (
      <>
        <h1>Priority</h1>
      {/* print-only */}
      <PrintHeader title="Priority" />
      <div className="page-actions no-print"><PrintButton label="Print this page" /></div>
        <p className="muted">
          Nothing to rank yet. Add a client, then a contract, then a project, and
          projects will appear here ordered by the cash they can realistically bring
          in.
        </p>
      </>
    );
  }

  return <PriorityBoard rows={rows} horizonDays={DEFAULT_PRIORITY_CONFIG.horizonDays} />;
}
