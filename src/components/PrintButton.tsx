/**
 * Print what is on this page.
 *
 * The Reports page builds a formal document. This is the other thing people
 * need constantly and never get: a clean copy of the list they are already
 * looking at — the contracts, the lifts under maintenance, the open payment
 * vouchers — to take into a meeting or hand to somebody.
 *
 * The print stylesheet drops the chrome, the forms and the buttons, so what
 * comes out is the data and a header saying what it is and when it was taken.
 * A printed list with no date on it is a list nobody can trust a week later.
 */

import { formatEthiopian, formatGregorianShort, utcDateToEthiopian } from '../lib/ethiopic.js';

export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <button type="button" className="no-print" onClick={() => window.print()} title="Print or save this page as a PDF">
      {label}
    </button>
  );
}

/**
 * The header that appears ONLY on paper.
 *
 * On screen the page already says what it is; on paper it has to carry its own
 * identity, because a printout circulates away from the thing that produced it.
 */
export function PrintHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const now = new Date();
  const utcToday = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  return (
    <div className="print-only print-header" aria-hidden="true">
      <div>
        <p className="print-company">INTELMOTION</p>
        <h2>{title}</h2>
        {subtitle !== undefined && <p className="muted">{subtitle}</p>}
      </div>
      <p className="muted print-date">
        {formatEthiopian(utcDateToEthiopian(utcToday))} EC · {formatGregorianShort(utcToday)}
      </p>
    </div>
  );
}
