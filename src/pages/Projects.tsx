/**
 * Project list and creation.
 */

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { subscribeClients } from '../data/clients.js';
import { createProject, subscribeProjects } from '../data/projects.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { formatBps } from '../lib/kpi.js';
import { formatETB } from '../lib/money.js';
import { DualDateInput, DualDateText } from '../components/DualDateInput.js';
import { ELEVATOR_STAGE_TEMPLATE } from '../lib/stages.js';
import { ProgressBar } from '../components/KpiTile.js';
import { expectedProgressBps } from '../lib/kpi.js';
import type { Client, DualDate, Project } from '../lib/schema.js';

export function Projects() {
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects');
  const [creating, setCreating] = useState(false);

  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const clients = useCollection<Client>((d, e) => subscribeClients(d, e, { activeOnly: true }), [], 'load clients');

  const asOf = new Date();

  return (
    <>
      <div className="page-head">
        <h1>Projects</h1>
        {editable && !creating && (
          <button type="button" className="primary" onClick={() => setCreating(true)}>New project</button>
        )}
      </div>

      {projects.error && <p className="error" role="alert">{projects.error}</p>}

      {creating && user !== null && (
        <ProjectForm clients={clients.rows} uid={user.uid} onDone={() => setCreating(false)} />
      )}

      {projects.loading && <p className="muted">Loading…</p>}
      {!projects.loading && projects.rows.length === 0 && !projects.error && (
        <p className="muted">No projects yet.</p>
      )}

      <div className="project-cards">
        {projects.rows.map((project) => {
          const expected = expectedProgressBps(
            project.plannedStart.at.toDate(),
            project.plannedEnd.at.toDate(),
            asOf,
          );
          const behind = project.progressBps < expected;
          return (
            <article key={project.id} className="card project-card">
              <div className="page-head">
                <div>
                  <h2><Link to={`/projects/${project.id}`}>{project.title}</Link></h2>
                  <p className="muted">
                    {project.clientName} · {project.site?.name ?? '—'} · {project.units?.length ?? 0} unit
                    {project.units?.length === 1 ? '' : 's'}
                  </p>
                </div>
                <span className="chip">{project.status.replace(/_/g, ' ')}</span>
              </div>

              <ProgressBar progressBps={project.progressBps} expectedBps={expected} />
              <p className="muted">
                {formatBps(project.progressBps, 0)} built · plan says {formatBps(expected, 0)} by now
                {behind && <span className="warn-text"> · behind schedule</span>}
              </p>

              <dl className="kv compact">
                <dt>Planned end</dt>
                <dd><DualDateText value={project.plannedEnd} /></dd>
                <dt>Contract value</dt>
                <dd>{formatETB(project.financials?.contractGrossSantim ?? 0)}</dd>
              </dl>
            </article>
          );
        })}
      </div>
    </>
  );
}

function ProjectForm({
  clients,
  uid,
  onDone,
}: {
  clients: readonly { id: string; name: string }[];
  uid: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [siteName, setSiteName] = useState('');
  const [city, setCity] = useState('Addis Ababa');
  const [units, setUnits] = useState(1);
  const [plannedStart, setPlannedStart] = useState<DualDate | null>(null);
  const [plannedEnd, setPlannedEnd] = useState<DualDate | null>(null);
  const { busy, error, run } = useAsyncAction('create this project');

  const ready = title.trim() !== '' && clientId !== '' && plannedStart !== null && plannedEnd !== null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const client = clients.find((c) => c.id === clientId);
    if (!ready || client === undefined) return;

    const result = await run(() =>
      createProject(
        {
          projectNo: `P-${Date.now()}`,
          type: 'elevator',
          title: title.trim(),
          clientId,
          clientName: client.name,
          contractId: null,
          site: { name: siteName.trim() || title.trim(), city },
          units: Array.from({ length: Math.max(1, units) }, (_, i) => ({
            tag: `LIFT-${String(i + 1).padStart(2, '0')}`,
          })),
          plannedStart: plannedStart as DualDate,
          plannedEnd: plannedEnd as DualDate,
          actualStart: null,
          actualEnd: null,
          status: 'planned',
        },
        uid,
        { plannedStart: plannedStart as DualDate, plannedEnd: plannedEnd as DualDate },
      ),
    );
    if (result !== null) onDone();
  }

  return (
    <section className="card">
      <h2>New project</h2>
      <p className="muted">
        The full project lifecycle is created automatically — fourteen stages from
        site inspection to handover. You can adjust weights, dates and the stage
        list on the project itself once it exists.
      </p>
      <form onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="p-client">Client <span className="req" aria-hidden="true">*</span></label>
            <select id="p-client" required value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select a client…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="p-title">Title <span className="req" aria-hidden="true">*</span></label>
            <input id="p-title" required value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Bole Tower — 3 passenger lifts" />
          </div>

          <div className="field">
            <label htmlFor="p-site">Site</label>
            <input id="p-site" value={siteName} onChange={(e) => setSiteName(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="p-city">City</label>
            <input id="p-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="p-units">Units</label>
            <input id="p-units" type="number" min={1} value={units}
              onChange={(e) => setUnits(Number(e.target.value) || 1)} />
          </div>
        </div>

        <div className="form-grid dates">
          <DualDateInput label="Planned start" value={plannedStart} onChange={setPlannedStart} required />
          <DualDateInput label="Planned end" value={plannedEnd} onChange={setPlannedEnd} required />
        </div>

        <details className="stage-preview">
          <summary>
            Stages that will be created ({ELEVATOR_STAGE_TEMPLATE.length})
          </summary>
          <p className="hint">
            Each stage records who has to move for it to finish. A project stalled in
            customs and one stalled because the crew has not mobilised need different
            interventions, so they are tracked apart. Payment milestones are attached
            to stages on the contract's payment schedule.
          </p>
          <ol className="stage-list">
            {ELEVATOR_STAGE_TEMPLATE.map((stage) => (
              <li key={stage.key}>
                <div>
                  <strong>{stage.name}</strong>
                  <span className="muted"> · {(stage.weightBps / 100).toFixed(0)}%</span>
                  {stage.commonlyGatesPayment && (
                    <span className="chip chip-ok stage-pay">payment</span>
                  )}
                </div>
                <p className="muted">{stage.description}</p>
                <span className={`chip owner-${stage.owner}`}>
                  {stage.owner === 'us' ? 'our crew' : stage.owner}
                </span>
              </li>
            ))}
          </ol>
        </details>

        {error && <p className="error" role="alert">{error}</p>}

        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy || !ready}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
          <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
        </div>
      </form>
    </section>
  );
}
