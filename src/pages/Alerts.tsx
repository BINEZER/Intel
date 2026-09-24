/**
 * Alerts: the things that stop being fixable if nobody looks today.
 *
 * The page exists to be short. Only something with a deadline AND an action
 * appears, because a list that shows everything gets read once. Each row says
 * what is happening, what to do, and links to the place to do it.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { subscribeContracts } from '../data/contracts.js';
import { subscribeInvoices } from '../data/invoices.js';
import { subscribeProjects } from '../data/projects.js';
import { subscribeUnits } from '../data/units.js';
import { subscribeAllVisits } from '../data/service.js';
import { assessPortfolioRisk } from '../data/project-risk.js';
import { useCollection } from '../data/useCollection.js';
import {
  type AlertServicedUnit,
  buildAlerts,
  countBySeverity,
  type Alert,
  type AlertProject,
  type AlertReminder,
  type AlertWarranty,
} from '../lib/alerts.js';
import { activeReminders, viewWarranty, type ReminderInput } from '../lib/reminders.js';
import { formatETB } from '../lib/money.js';
import { ExtensionLetter } from '../components/ExtensionLetter.js';
import type {
  Contract,
  ElevatorUnit,
  Invoice,
  MaintenanceVisit,
  Project,
  RiskSeverity,
} from '../lib/schema.js';
import type { WithId } from '../data/repository.js';
import { PrintButton, PrintHeader } from '../components/PrintButton.js';

/** Stored reminders into the shape `lib/reminders` reasons about. */
function toReminderInputs(
  reminders: readonly { id: string; label: string; dueDate: { at: { toDate: () => Date } }; leadDays: number; doneAt: { toDate: () => Date } | null }[],
  sourceKind: 'contract' | 'project',
  sourceId: string,
  sourceLabel: string,
): ReminderInput[] {
  return reminders.map((r) => ({
    id: r.id,
    label: r.label,
    dueDate: r.dueDate.at.toDate(),
    leadDays: r.leadDays,
    doneAt: r.doneAt?.toDate() ?? null,
    sourceKind,
    sourceId,
    sourceLabel,
  }));
}

const SEVERITY_LABEL: Record<RiskSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function Alerts() {
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const invoices = useCollection<Invoice>((d, e) => subscribeInvoices(d, e), [], 'load invoices');
  const units = useCollection<ElevatorUnit>((d, e) => subscribeUnits(d, e), [], 'load lifts');
  /*
   * Every visit, not just the ones in the diary.
   *
   * Both halves of the question need them: the SOONEST scheduled visit says
   * whether one is due or overdue, and the LATEST completed one says whether a
   * lift with nothing booked has slipped or was simply serviced last week.
   */
  const visits = useCollection<MaintenanceVisit>(
    (d, e) => subscribeAllVisits(d, e),
    [],
    'load maintenance visits',
  );
  const [letterFor, setLetterFor] = useState<WithId<Contract> | null>(null);

  const asOf = useMemo(() => new Date(), []);

  // Risk is derived, never stored: a saved verdict is stale the moment an
  // invoice goes overdue. The same derivation feeds the priority board.
  const risks = useMemo(
    () => assessPortfolioRisk(projects.rows, contracts.rows, invoices.rows, asOf),
    [projects.rows, contracts.rows, invoices.rows, asOf],
  );

  /**
   * Lifts under a live maintenance contract, with their visit history.
   *
   * Only serviced lifts: a machine we installed and do not maintain is not ours
   * to schedule, and alerting on it would be telling somebody off for a job they
   * were never given.
   */
  const servicedUnits = useMemo<AlertServicedUnit[]>(() => {
    const soonest = new Map<string, Date>();
    const latest = new Map<string, Date>();
    for (const visit of visits.rows) {
      const key = `${visit.siteName}::${visit.unitTag}`;
      if (visit.status === 'scheduled') {
        const at = visit.scheduledDate.at.toDate();
        const have = soonest.get(key);
        if (have === undefined || at < have) soonest.set(key, at);
      }
      if (visit.status === 'completed' && visit.completedDate !== null) {
        const at = visit.completedDate.at.toDate();
        const have = latest.get(key);
        if (have === undefined || at > have) latest.set(key, at);
      }
    }

    return units.rows
      .filter((u) => u.maintenanceContractId !== null && u.status === 'in_service')
      .map<AlertServicedUnit>((u) => {
        const key = `${u.siteName}::${u.tag}`;
        return {
          id: u.id,
          tag: u.tag,
          siteName: u.siteName,
          nextScheduled: soonest.get(key) ?? null,
          lastCompleted: latest.get(key) ?? null,
        };
      });
  }, [units.rows, visits.rows]);

  const alerts = useMemo(
    () =>
      buildAlerts(
        {
          contracts: contracts.rows.map((c) => ({
            id: c.id,
            contractNo: c.contractNo,
            clientName: c.clientName,
            type: c.type,
            endDate: c.endDate.at.toDate(),
            renewalWindowDays: c.renewalWindowDays ?? 90,
            renewalStatus: c.renewalStatus ?? 'not_due',
            status: c.status,
            valueGrossSantim: c.valueGrossSantim,
          })),
          projects: risks.map<AlertProject>(({ project, risk }) => ({
            id: project.id,
            projectNo: project.projectNo,
            title: project.title,
            clientName: project.clientName,
            status: project.status,
            inDanger: risk.inDanger,
            severity: risk.level,
            flags: risk.flags,
            plannedEnd: project.plannedEnd.at.toDate(),
          })),
          // Warranty and the dates somebody asked to be warned about. Both are
          // resolved here — stored dual dates turned into real ones — because
          // the alert engine ranks and phrases; it does not recompute what
          // lib/reminders already knows.
          warranties: contracts.rows.flatMap<AlertWarranty>((c) => {
            const view = viewWarranty(
              c.warranty == null
                ? null
                : {
                    months: c.warranty.months,
                    startsOn: c.warranty.startsOn?.at.toDate() ?? null,
                    endsOn: c.warranty.endsOn?.at.toDate() ?? null,
                    alertDays: c.warranty.alertDays,
                  },
              asOf,
            );
            return view.endsOn === null || view.state === 'not_started'
              ? []
              : [{
                  contractId: c.id,
                  contractNo: c.contractNo,
                  clientName: c.clientName,
                  endsOn: view.endsOn,
                  state: view.state,
                  message: view.message,
                }];
          }),
          reminders: [
            ...contracts.rows.flatMap((c) =>
              toReminderInputs(c.reminders ?? [], 'contract', c.id, `${c.contractNo} · ${c.clientName}`),
            ),
            ...projects.rows.flatMap((p) =>
              toReminderInputs(p.reminders ?? [], 'project', p.id, `${p.projectNo} · ${p.title}`),
            ),
          ]
            .flatMap((input) => activeReminders([input], asOf))
            .map<AlertReminder>((view) => ({
              id: view.id,
              label: view.label,
              message: view.message,
              daysRemaining: view.daysRemaining,
              state: view.state === 'overdue' ? 'overdue' : 'due',
              sourceKind: view.sourceKind,
              sourceId: view.sourceId,
              sourceLabel: view.sourceLabel,
            })),
          units: units.rows.map((u) => ({
            id: u.id,
            unitCode: u.unitCode,
            tag: u.tag,
            siteName: u.siteName,
            // Health is assessed on the unit's own page, where its history is
            // loaded. Here only the certificate date is known, which is the alert
            // that matters most anyway.
            verdict: 'healthy' as const,
            reasons: [],
            certificateExpiresOn: u.certificate?.expiresOn?.at.toDate() ?? null,
          })),
          servicedUnits,
        },
        asOf,
      ),
    [contracts.rows, projects.rows, risks, units.rows, servicedUnits, asOf],
  );

  const counts = countBySeverity(alerts);
  const loading =
    contracts.loading || projects.loading || invoices.loading || units.loading || visits.loading;
  const error = contracts.error ?? projects.error ?? invoices.error ?? units.error;

  const expiring = alerts.filter((a) => a.kind === 'contract_expiring' || a.kind === 'contract_lapsed');

  return (
    <>
      <h1>Alerts</h1>
      {/* print-only */}
      <PrintHeader title="Alerts" subtitle="things needing attention" />
      <div className="page-actions no-print"><PrintButton label="Print this page" /></div>
      <p className="muted">
        Only things with a deadline and something to do about them. A contract expiring
        in three weeks is here because a letter written today still works and one written
        in four weeks does not.
      </p>

      {error !== null && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      <section className="kpis">
        {(['critical', 'high', 'medium', 'low'] as RiskSeverity[]).map((severity) => (
          <div key={severity} className={`metric-tile alert-count tone-${severity}`}>
            <p className="metric-label">{SEVERITY_LABEL[severity]}</p>
            <p className="metric-value">{counts[severity]}</p>
          </div>
        ))}
      </section>

      {alerts.length === 0 && !loading ? (
        <p className="muted">
          Nothing needs attention today. No contract is inside its renewal window, no project
          is flagged in danger, and no certificate is close to expiring.
        </p>
      ) : (
        <ul className="alert-list">
          {alerts.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              onDraftLetter={
                alert.kind === 'contract_expiring' || alert.kind === 'contract_lapsed'
                  ? () => setLetterFor(contracts.rows.find((c) => `contract-${c.id}` === alert.id) ?? null)
                  : null
              }
            />
          ))}
        </ul>
      )}

      {expiring.length > 0 && (
        <p className="muted">
          {expiring.length === 1 ? 'One contract needs' : `${expiring.length} contracts need`} an
          extension letter. Drafting one from here fills in the contract, the site, the dates and
          the value — you edit the rest.
        </p>
      )}

      {letterFor !== null && (
        <ExtensionLetter contract={letterFor} onClose={() => setLetterFor(null)} />
      )}
    </>
  );
}

function AlertRow({ alert, onDraftLetter }: { alert: Alert; onDraftLetter: (() => void) | null }) {
  return (
    <li className={`alert-row sev-${alert.severity}`}>
      <div className="alert-head">
        <strong>{alert.subject}</strong>
        <span className={`chip sev-chip-${alert.severity}`}>{SEVERITY_LABEL[alert.severity]}</span>
        {alert.daysRemaining !== null && (
          <span className="muted">
            {alert.daysRemaining < 0
              ? `${Math.abs(alert.daysRemaining)} days overdue`
              : `${alert.daysRemaining} days left`}
          </span>
        )}
        {alert.amountSantim !== undefined && (
          <span className="muted alert-amount">{formatETB(alert.amountSantim)}</span>
        )}
      </div>
      <p>{alert.message}</p>
      <p className="alert-action">→ {alert.action}</p>
      <div className="alert-links">
        <Link to={alert.href}>Open</Link>
        {onDraftLetter !== null && (
          <button type="button" onClick={onDraftLetter}>Draft extension letter</button>
        )}
      </div>
    </li>
  );
}
