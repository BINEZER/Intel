/**
 * The things that no longer agree with each other.
 *
 * A status is a claim about the world, and four records make claims about the
 * same lift: the client, the contract, the project and the machine. They drift
 * apart within weeks of anyone touching them. This page is where the
 * disagreements collect, each with the fix attached.
 *
 * Nothing here happens on its own. That is deliberate — a status is sometimes
 * deliberately out of step, and software that rewrites those quietly is
 * software people route around. A persistent list means nothing is forgotten
 * either, which is the other half of the problem.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { subscribeClients } from '../data/clients.js';
import { subscribeContracts } from '../data/contracts.js';
import { subscribeProjects } from '../data/projects.js';
import { subscribeUnits } from '../data/units.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { applyConsequence, declineService, startWarranty } from '../data/lifecycle.js';
import { PrintButton, PrintHeader } from '../components/PrintButton.js';
import { KpiTile } from '../components/KpiTile.js';
import { ServiceConversionForm } from '../components/ServiceConversionForm.js';
import {
  findConsequences,
  summariseConsequences,
  type Consequence,
  type ConsequenceAction,
} from '../lib/lifecycle.js';
import type { Client, Contract, ElevatorUnit, Project } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

const SEVERITY_LABEL: Record<Consequence['severity'], string> = {
  decision: 'Decision',
  high: 'Soon',
  medium: 'Tidy up',
  low: 'Tidy up',
};

export function FollowUps() {
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects') && user !== null;
  const { busy, error, run } = useAsyncAction('apply the change');
  const [converting, setConverting] = useState<WithId<Contract> | null>(null);

  const clients = useCollection<Client>((d, e) => subscribeClients(d, e), [], 'load clients');
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const units = useCollection<ElevatorUnit>((d, e) => subscribeUnits(d, e), [], 'load lifts');

  const consequences = useMemo(
    () =>
      findConsequences({
        clients: clients.rows.map((c) => ({ id: c.id, name: c.name, status: c.status })),
        contracts: contracts.rows.map((k) => ({
          id: k.id,
          contractNo: k.contractNo,
          clientId: k.clientId,
          clientName: k.clientName,
          type: k.type,
          status: k.status,
          endDate: k.endDate.at.toDate(),
          warranty:
            k.warranty === undefined
              ? null
              : {
                  months: k.warranty.months,
                  startsOn: k.warranty.startsOn?.at.toDate() ?? null,
                  endsOn: k.warranty.endsOn?.at.toDate() ?? null,
                  alertDays: k.warranty.alertDays,
                },
          succeededByContractId: k.succeededByContractId ?? null,
          serviceDeclined: k.serviceDeclined === true,
        })),
        projects: projects.rows.map((p) => ({
          id: p.id,
          projectNo: p.projectNo,
          title: p.title,
          clientId: p.clientId,
          contractId: p.contractId,
          status: p.status,
          progressBps: p.progressBps,
          // A project at 100% has every checkpoint ticked, and the last one on
          // the last stage IS the signed client acceptance. Reading the
          // checkpoint itself would mean loading the phase subcollection of
          // every project on the page to learn something the total already says.
          handoverSigned: p.progressBps >= 10_000,
        })),
        units: units.rows.map((u) => ({
          id: u.id,
          tag: u.tag,
          siteName: u.siteName,
          clientId: u.clientId,
          installedByProjectId: u.installedByProjectId,
          maintenanceContractId: u.maintenanceContractId,
          status: u.status,
        })),
        asOf: new Date(),
      }),
    [clients.rows, contracts.rows, projects.rows, units.rows],
  );

  const summary = summariseConsequences(consequences);
  const loading = clients.loading || contracts.loading || projects.loading || units.loading;

  async function apply(action: ConsequenceAction) {
    if (user === null) return;
    if (action.kind === 'convert_to_service') {
      const contract = contracts.rows.find((k) => k.id === action.targetId);
      if (contract !== undefined) setConverting(contract);
      return;
    }
    if (action.kind === 'close_after_warranty') {
      await run(() => declineService(action.targetId, user.uid));
      return;
    }
    if (action.kind === 'start_warranty') {
      const contract = contracts.rows.find((k) => k.id === action.targetId);
      if (contract?.warranty === undefined) return;
      await run(() =>
        startWarranty(action.targetId, contract.warranty!.months, contract.warranty!.alertDays, user.uid),
      );
      return;
    }
    await run(() => applyConsequence(action, user.uid));
  }

  return (
    <div className="page">
      <PrintHeader title="Follow-ups" />
      <div className="page-head">
        <div>
          <h1>Follow-ups</h1>
          <p className="muted">
            Where the records no longer agree with each other, and what to do about it. Nothing here
            changes on its own — a status is sometimes out of step on purpose.
          </p>
        </div>
        <PrintButton label="Print list" />
      </div>

      {error !== null && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      <div className="kpis">
        <KpiTile
          label="Decisions waiting"
          value={summary.decisions}
          status={summary.decisions > 0 ? 'bad' : 'good'}
          detail={<span className="muted">warranty running out</span>}
        />
        <KpiTile
          label="One-click fixes"
          value={summary.oneClick}
          detail={<span className="muted">statuses that disagree</span>}
        />
      </div>

      {converting !== null && user !== null && (
        <ServiceConversionForm
          contract={converting}
          uid={user.uid}
          onDone={() => setConverting(null)}
        />
      )}

      {!loading && consequences.length === 0 ? (
        <section className="card">
          <p className="verdict verdict-healthy">Everything agrees.</p>
          <p className="muted">
            Every project, contract, client and lift is in a status that matches the others. This
            page fills up again as work moves.
          </p>
        </section>
      ) : (
        <ul className="followup-list">
          {consequences.map((item) => (
            <li key={item.id} className={`card followup followup-${item.severity}`}>
              <div className="followup-head">
                <div>
                  <span className={`chip followup-chip-${item.severity}`}>
                    {SEVERITY_LABEL[item.severity]}
                  </span>{' '}
                  <Link to={item.href}><strong>{item.subject}</strong></Link>
                </div>
              </div>
              <p>{item.detail}</p>

              {item.action !== null && (
                <div className="followup-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !editable}
                    onClick={() => void apply(item.action as ConsequenceAction)}
                  >
                    {item.action.label}
                  </button>
                  <span className="muted">{item.action.effect}</span>
                </div>
              )}

              {item.choices.length > 0 && (
                <div className="followup-choices">
                  {item.choices.map((choice) => (
                    <div key={choice.kind} className="followup-choice">
                      <button
                        type="button"
                        className={choice.kind === 'convert_to_service' ? 'primary' : undefined}
                        disabled={busy || !editable}
                        onClick={() => void apply(choice)}
                      >
                        {choice.label}
                      </button>
                      <span className="muted">{choice.effect}</span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
