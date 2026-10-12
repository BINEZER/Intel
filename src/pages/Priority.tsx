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
import { usePortfolioDetail } from '../data/portfolio.js';
import { pipelineInputs } from '../data/pipeline.js';
import { rankMaintenance, readyToInvoice, termsByProject } from '../lib/cash-pipeline.js';
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

  // The payment terms and stages live in subcollections, so they are read in the
  // background. Until they arrive the board still draws, from the invoices alone.
  const detail = usePortfolioDetail(projects.rows, contracts.rows, invoices.rows);

  // Fixed for the life of the page. A new Date on every render would make every
  // memo below recompute on every render.
  const asOf = useMemo(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }, []);

  const pipeline = useMemo(
    () => pipelineInputs(contracts.rows, invoices.rows, detail),
    [contracts.rows, invoices.rows, detail],
  );
  const ready = useMemo(
    () => readyToInvoice(pipeline.contracts, pipeline.terms, pipeline.stages, pipeline.invoices, asOf),
    [pipeline, asOf],
  );
  const maintenance = useMemo(
    () => rankMaintenance(pipeline.contracts, pipeline.terms, pipeline.invoices, asOf, DEFAULT_PRIORITY_CONFIG),
    [pipeline, asOf],
  );

  const rows: PriorityRow[] = useMemo(() => {
    // Each payment term is credited to ONE project — see `termsByProject`.
    const termsOf = termsByProject(
      projects.rows.map((p) => ({ id: p.id, contractId: p.contractId })),
      pipeline.terms,
      pipeline.stages,
      new Set(ready.map((r) => r.termId)),
    );
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
          milestones: termsOf.get(project.id) ?? [],
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
      const mine = source?.milestones ?? [];
      return {
        ...ranked,
        title: source?.title ?? ranked.projectId,
        clientName: source?.clientName ?? '',
        readyToInvoiceSantim: mine
          .filter((m) => m.status === 'ready_to_invoice')
          .reduce((a, m) => a + m.grossSantim, 0),
      };
    });
  }, [projects.rows, contracts.rows, invoices.rows, pipeline, ready, asOf]);

  const loading = projects.loading || contracts.loading || invoices.loading;
  const error = projects.error ?? contracts.error ?? invoices.error;

  if (error !== null) return <p className="error" role="alert">{error}</p>;
  if (loading) return <p className="muted">Loading…</p>;

  if (rows.length === 0 && maintenance.length === 0) {
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

  return (
    <PriorityBoard
      rows={rows}
      horizonDays={DEFAULT_PRIORITY_CONFIG.horizonDays}
      ready={ready}
      maintenance={maintenance}
      termsLoading={detail.loading}
    />
  );
}
