/**
 * Dashboard — module 1 renders the shell and proves the dual-calendar and
 * money primitives end to end. The live figures arrive with modules 2-5.
 */

import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { DualDateInput, DualDateText } from '../components/DualDateInput.js';
import { ethiopianFiscalYear, utcDateToEthiopian } from '../lib/ethiopic.js';
import type { DualDate } from '../lib/schema.js';

export function Dashboard() {
  const { role } = useAuth();
  const [date, setDate] = useState<DualDate | null>(null);

  const today = new Date();
  const utcToday = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const fiscalYear = ethiopianFiscalYear(utcDateToEthiopian(utcToday));

  return (
    <>
      <h1>Dashboard</h1>
      <p className="muted">
        Ethiopian fiscal year <strong>{fiscalYear}</strong> (1 Hamle – 30 Sene).
      </p>

      <section className="card">
        <h2>Dual-calendar date entry</h2>
        <p className="muted">
          Enter a date in either calendar. Firestore always receives the Gregorian
          timestamp; the Ethiopian reading is stored alongside it for reporting.
        </p>

        <DualDateInput
          label="Planned handover"
          value={date}
          onChange={setDate}
          hint="Switch calendars at any time — the date you picked is preserved."
        />

        {date && (
          <dl className="kv">
            <dt>Stored (Gregorian UTC)</dt>
            <dd><code>{date.at.toDate().toISOString()}</code></dd>
            <dt>Displayed</dt>
            <dd><DualDateText value={date} /></dd>
            <dt>Reporting period</dt>
            <dd><code>{date.ecPeriod}</code> · fiscal year <code>{date.ecFiscalYear}</code></dd>
            <dt>Entered in</dt>
            <dd><code>{date.enteredIn}</code></dd>
          </dl>
        )}
      </section>
    </>
  );
}

/** Placeholder for sections delivered in later modules. */
export function ComingSoon({ title, module }: { title: string; module: string }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="muted">Delivered in {module}.</p>
    </>
  );
}
