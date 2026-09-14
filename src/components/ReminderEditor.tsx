/**
 * Dates somebody wants warning about.
 *
 * The lead time is the part people skip and the part that matters. A reminder
 * that fires on the day a warranty ends has told you about a warranty that has
 * ended. So the form asks for the warning distance as prominently as the date,
 * offers a sane default per kind of date, and says why that default is what it is.
 */

import { useState, type FormEvent } from 'react';
import {
  SUGGESTED_LEAD_DAYS,
  sortReminders,
  validateReminder,
  type ReminderInput,
} from '../lib/reminders.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { toTimestamp } from '../firebase.js';
import { formatDual } from '../lib/ethiopic.js';
import type { Reminder } from '../lib/schema.js';

const STATE_LABEL = {
  overdue: 'Overdue',
  due: 'Due',
  sleeping: 'Scheduled',
  done: 'Done',
} as const;

export function ReminderEditor({
  reminders,
  onChange,
  sourceLabel,
  disabled = false,
}: {
  reminders: readonly Reminder[];
  onChange: (next: Reminder[]) => void;
  sourceLabel: string;
  disabled?: boolean;
}) {
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');
  const [leadDays, setLeadDays] = useState(60);
  const [error, setError] = useState<string | null>(null);

  const asOf = new Date();

  const views = sortReminders(
    reminders.map<ReminderInput>((r) => ({
      id: r.id,
      label: r.label,
      dueDate: r.dueDate.at.toDate(),
      leadDays: r.leadDays,
      doneAt: r.doneAt?.toDate() ?? null,
      sourceKind: 'contract',
      sourceId: '',
      sourceLabel,
    })),
    asOf,
  );

  function add(event: FormEvent) {
    event.preventDefault();
    const check = validateReminder({ label, leadDays });
    if (!check.ok) return setError(check.error);
    if (date === '') return setError('Pick the date itself.');

    const due = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(due.getTime())) return setError('That is not a date.');

    setError(null);
    onChange([
      ...reminders,
      {
        id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        label: label.trim(),
        dueDate: dualDateFromGregorian(due, toTimestamp, 'GC'),
        leadDays,
        doneAt: null,
      },
    ]);
    setLabel('');
    setDate('');
  }

  return (
    <div className="reminders">
      <h3>Alert points</h3>
      <p className="hint">
        Dates you want warning about — a warranty running out, a bond to release, a permit to renew.
        The system already watches the contract end date; these are the ones only you know.
      </p>

      {views.length > 0 && (
        <ul className="reminder-list">
          {views.map((view) => (
            <li key={view.id} className={`reminder-row state-${view.state}`}>
              <span className="reminder-label">{view.label}</span>
              <span className="chip">{STATE_LABEL[view.state]}</span>
              <span className="muted">
                {formatDual(view.dueDate)} · warns {view.leadDays} days before
              </span>
              <span className="reminder-when muted">
                {view.daysRemaining < 0
                  ? `${Math.abs(view.daysRemaining)} days ago`
                  : `in ${view.daysRemaining} days`}
              </span>
              {!disabled && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${view.label}`}
                  onClick={() => onChange(reminders.filter((r) => r.id !== view.id))}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!disabled && (
        <div className="reminder-add">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="rem-label">What the date is for</label>
              <input
                id="rem-label"
                value={label}
                placeholder="Warranty ends"
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="rem-date">The date</label>
              <input id="rem-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rem-lead">Warn me this many days before</label>
              <input
                id="rem-lead"
                type="number"
                className="num"
                min={0}
                max={365}
                value={leadDays}
                onChange={(e) => setLeadDays(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
              />
              <p className="hint">A warning on the day is not a warning.</p>
            </div>
          </div>

          <div className="lead-suggestions">
            {SUGGESTED_LEAD_DAYS.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                title={suggestion.why}
                onClick={() => {
                  setLabel(suggestion.label);
                  setLeadDays(suggestion.leadDays);
                }}
              >
                {suggestion.label} · {suggestion.leadDays}d
              </button>
            ))}
          </div>

          {error !== null && <p className="error" role="alert">{error}</p>}

          <div className="form-actions">
            <button type="button" onClick={add}>Add alert point</button>
          </div>
        </div>
      )}
    </div>
  );
}
