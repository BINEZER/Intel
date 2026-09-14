/**
 * Programs: projects that belong together.
 *
 * A tower with four lifts is four projects and one commitment. Reported
 * separately they look like four modest jobs; together they are often the
 * largest thing the company is carrying, and the one whose slippage matters most.
 *
 * A program holds no money of its own — every figure here is the sum of its
 * projects, so it can never disagree with what is inside it.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  createProgram,
  deleteProgram,
  setProjectProgram,
  subscribePrograms,
} from '../data/programs.js';
import { subscribeProjects } from '../data/projects.js';
import { subscribeClients } from '../data/clients.js';
import { subscribeContracts } from '../data/contracts.js';
import { subscribeInvoices } from '../data/invoices.js';
import { assessPortfolioRisk } from '../data/project-risk.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { rollUpProgramAsOf, sortPrograms, type ProgramProject, type ProgramRollup } from '../lib/program.js';
import { formatETB } from '../lib/money.js';
import { formatBps } from '../lib/kpi.js';
import { DualDateInput, DualDateText } from '../components/DualDateInput.js';
import type { Client, Contract, DualDate, Invoice, Program, Project } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';
import { PrintButton, PrintHeader } from '../components/PrintButton.js';
import { FormPanel } from '../components/FormPanel.js';

/** Everything both the list and the detail page need, computed once. */
function usePrograms() {
  const programs = useCollection<Program>((d, e) => subscribePrograms(d, e), [], 'load programs');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const invoices = useCollection<Invoice>((d, e) => subscribeInvoices(d, e), [], 'load invoices');

  const asOf = useMemo(() => new Date(), []);

  const rows = useMemo(() => {
    const risks = assessPortfolioRisk(projects.rows, contracts.rows, invoices.rows, asOf);
    const riskById = new Map(risks.map((r) => [r.project.id, r]));

    const toProgramProject = (project: WithId<Project>): ProgramProject => {
      const row = riskById.get(project.id);
      return {
        id: project.id,
        projectNo: project.projectNo,
        title: project.title,
        clientName: project.clientName,
        status: project.status,
        progressBps: project.progressBps,
        contractNetSantim: row?.contract?.valueNetSantim ?? project.financials?.contractNetSantim ?? 0,
        invoicedNetSantim: (row?.invoices ?? []).reduce((a, i) => a + i.netSantim, 0),
        collectedGrossSantim: (row?.invoices ?? []).reduce((a, i) => a + i.paidGrossSantim, 0),
        subcontractNetSantim: project.financials?.subcontractCostNetSantim ?? 0,
        plannedEnd: project.plannedEnd.at.toDate(),
        actualEnd: project.actualEnd?.at.toDate() ?? null,
        inDanger: row?.risk.inDanger ?? false,
      };
    };

    return programs.rows.map((program) => {
      const members = projects.rows.filter((p) => p.programId === program.id).map(toProgramProject);
      return { program, members, rollup: rollUpProgramAsOf(members, asOf) };
    });
  }, [programs.rows, projects.rows, contracts.rows, invoices.rows, asOf]);

  return {
    rows,
    unassigned: projects.rows.filter((p) => p.programId === undefined || p.programId === null),
    loading: programs.loading || projects.loading || contracts.loading || invoices.loading,
    error: programs.error ?? projects.error ?? contracts.error ?? invoices.error,
  };
}

export function Programs() {
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects') && user !== null;
  const [creating, setCreating] = useState(false);
  const { rows, loading, error } = usePrograms();

  const sorted = sortPrograms(rows);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Programs</h1>
      {/* print-only */}
      <PrintHeader title="Programs" subtitle="programs" />
          <p className="muted">
            Projects that belong together — the lifts of one building, the phases of one
            development, a framework with one client. Ranked by what needs attention, not by size.
          </p>
        </div>
        <PrintButton label="Print list" />
        {editable && (
          <button type="button" className="primary" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : 'New program'}
          </button>
        )}
      </div>

      {error !== null && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      {creating && user !== null && <ProgramForm uid={user.uid} onDone={() => setCreating(false)} />}

      {sorted.length === 0 && !loading ? (
        <p className="muted">
          No programs yet. Create one, then set a project's program on the project form to group
          them.
        </p>
      ) : (
        <ul className="program-list">
          {sorted.map(({ program, rollup }) => (
            <li key={program.id} className={`program-card ${rollup.inDanger > 0 ? 'is-danger' : ''}`}>
              <div className="program-head">
                <div>
                  <Link to={`/programs/${program.id}`}><strong>{program.name}</strong></Link>
                  <span className="muted"> · {program.programNo} · {program.kind}</span>
                </div>
                <span className="chip">{program.status.replace(/_/g, ' ')}</span>
              </div>

              <p className="muted">{program.description}</p>
              <ProgramFigures rollup={rollup} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ProgramFigures({ rollup }: { rollup: ProgramRollup }) {
  return (
    <>
      <div className="program-bar" role="img" aria-label={`${formatBps(rollup.progressBps, 0)} complete`}>
        <span style={{ width: `${rollup.progressBps / 100}%` }} />
      </div>
      <dl className="program-figures">
        <div>
          <dt>Progress</dt>
          <dd>
            {formatBps(rollup.progressBps, 0)}
            {/* Saying which average it is matters: a count-average and a
                value-average of the same projects can differ by forty points. */}
            <span className="muted">
              {rollup.weightedBy === 'value' ? ' weighted by value' : rollup.weightedBy === 'count' ? ' simple average' : ''}
            </span>
          </dd>
        </div>
        <div><dt>Contract value</dt><dd>{formatETB(rollup.contractNetSantim)}</dd></div>
        <div><dt>Still to bill</dt><dd>{formatETB(rollup.unbilledNetSantim)}</dd></div>
        <div><dt>Outstanding</dt><dd>{formatETB(rollup.outstandingNetSantim)}</dd></div>
        <div><dt>Projects</dt><dd>{rollup.projects} · {rollup.live} live</dd></div>
        <div>
          <dt>Needs attention</dt>
          <dd>
            {rollup.inDanger === 0 && rollup.overdue === 0
              ? 'None'
              : [
                  rollup.inDanger > 0 ? `${rollup.inDanger} in danger` : null,
                  rollup.overdue > 0 ? `${rollup.overdue} overdue` : null,
                ].filter((x) => x !== null).join(', ')}
          </dd>
        </div>
      </dl>
    </>
  );
}

export function ProgramDetail() {
  const { programId } = useParams<{ programId: string }>();
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects') && user !== null;
  const { rows, unassigned, loading, error } = usePrograms();
  const { busy, error: actionError, run } = useAsyncAction('change this program');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const entry = rows.find((r) => r.program.id === programId);

  if (error !== null) return <p className="error" role="alert">{error}</p>;
  if (entry === undefined) {
    return loading ? <p className="muted">Loading…</p> : (
      <>
        <p className="error" role="alert">That program does not exist.</p>
        <Link to="/programs">Back to programs</Link>
      </>
    );
  }

  const { program, members, rollup } = entry;
  const uid = user?.uid ?? '';

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted"><Link to="/programs">Programs</Link></p>
          <h1>{program.name}</h1>
          <p className="muted">
            {program.programNo} · {program.clientName ?? 'multiple clients'} · closes{' '}
            <DualDateText value={program.plannedEnd} />
          </p>
        </div>
        <span className="chip">{program.status.replace(/_/g, ' ')}</span>
      </div>

      {actionError !== null && <p className="error" role="alert">{actionError}</p>}

      <section className="card">
        <h2>Across the program</h2>
        <ProgramFigures rollup={rollup} />
      </section>

      <section className="card">
        <h2>Projects in this program</h2>
        {members.length === 0 ? (
          <p className="muted">No project has been added yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <caption>Member projects</caption>
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Client</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Progress</th>
                  <th scope="col" className="num">Contract</th>
                  <th scope="col" className="num">Outstanding</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className={member.inDanger ? 'row-danger' : ''}>
                    <td><Link to={`/projects/${member.id}`}>{member.projectNo} {member.title}</Link></td>
                    <td>{member.clientName}</td>
                    <td><span className="chip">{member.status.replace(/_/g, ' ')}</span></td>
                    <td className="num">{formatBps(member.progressBps, 0)}</td>
                    <td className="num">{formatETB(member.contractNetSantim)}</td>
                    <td className="num">{formatETB(Math.max(0, member.invoicedNetSantim - member.collectedGrossSantim))}</td>
                    <td>
                      {editable && (
                        <button type="button" disabled={busy}
                          onClick={() => void run(() => setProjectProgram(member.id, null, uid))}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editable && (
        <section className="card">
          <h2>Add a project</h2>
          {unassigned.length === 0 ? (
            <p className="muted">Every project already belongs to a program.</p>
          ) : (
            <ul className="pick-list">
              {unassigned.map((project) => (
                <li key={project.id}>
                  <span>{project.projectNo} · {project.title} <span className="muted">({project.clientName})</span></span>
                  <button type="button" disabled={busy}
                    onClick={() => void run(() => setProjectProgram(project.id, program.id, uid))}>
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {editable && (
        <section className="card">
          <h2>Delete this program</h2>
          <p className="muted">
            The projects are not deleted. They keep every stage, invoice and payment — they simply
            stop being grouped.
          </p>
          {confirmDelete ? (
            <div className="form-actions">
              <button type="button" className="danger" disabled={busy}
                onClick={() => void run(() => deleteProgram(program.id, uid))}>
                Delete the program, keep the {members.length} project{members.length === 1 ? '' : 's'}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep it</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)}>Delete program</button>
          )}
        </section>
      )}
    </>
  );
}

function ProgramForm({ uid, onDone }: { uid: string; onDone: () => void }) {
  const clients = useCollection<Client>((d, e) => subscribeClients(d, e), [], 'load clients').rows;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<Program['kind']>('program');
  const [clientId, setClientId] = useState('');
  const [plannedStart, setPlannedStart] = useState<DualDate | null>(null);
  const [plannedEnd, setPlannedEnd] = useState<DualDate | null>(null);
  const { busy, error, run } = useAsyncAction('create this program');

  const ready = name.trim() !== '' && plannedStart !== null && plannedEnd !== null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const client = clients.find((c) => c.id === clientId);

    const result = await run(() =>
      createProgram(
        {
          programNo: `PG-${Date.now()}`,
          name: name.trim(),
          description: description.trim(),
          clientId: clientId === '' ? null : clientId,
          clientName: client?.name ?? null,
          kind,
          status: 'active',
          plannedStart: plannedStart as DualDate,
          plannedEnd: plannedEnd as DualDate,
          ownerUid: uid,
        },
        uid,
      ),
    );
    if (result !== null) onDone();
  }

  return (
    <FormPanel
      title="New program"
      description="Group the lifts of one building or the phases of one development so they report as a single commitment."
      onClose={onDone}
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="pg-name">Name <span className="req" aria-hidden="true">*</span></label>
            <input id="pg-name" required value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Bole Tower — all lifts" />
          </div>
          <div className="field">
            <label htmlFor="pg-kind">Kind</label>
            <select id="pg-kind" value={kind} onChange={(e) => setKind(e.target.value as Program['kind'])}>
              <option value="program">Program — one building or development</option>
              <option value="portfolio">Portfolio — a client's whole estate</option>
              <option value="framework">Framework — a standing agreement</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="pg-client">Client</label>
            <select id="pg-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Spans several clients</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pg-desc">Description</label>
            <input id="pg-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <div className="form-grid dates">
          <DualDateInput label="Planned start" value={plannedStart} onChange={setPlannedStart} required />
          <DualDateInput label="Planned close" value={plannedEnd} onChange={setPlannedEnd} required />
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy || !ready}>
            {busy ? 'Creating…' : 'Create program'}
          </button>
          <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
        </div>
      </form>
    </FormPanel>
  );
}
