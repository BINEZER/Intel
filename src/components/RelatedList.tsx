/**
 * A short, plain list of the records tied to another one.
 *
 * Shown at the TOP of a detail page, before the detail itself, because the
 * first thing somebody opening a client wants is "what do we have with them" —
 * their contracts, their projects, their lifts — and the second is to open,
 * correct or remove one of those without hunting for it in a list of everyone's.
 *
 * Deliberately not a table: a title that opens the record, a line of what it is,
 * its status, and the two things you do to it. Anything with columns belongs on
 * the page the title opens.
 */

import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { DeleteButton } from './DeleteButton.js';
import type { DeletionTarget } from '../data/deletion.js';

export interface RelatedItem {
  key: string;
  /** Where the title goes. */
  to: string;
  title: string;
  /** What it is, in one line: number, site, dates. */
  detail?: ReactNode;
  /** A status chip or a figure, on the right. */
  meta?: ReactNode;
  /** Present when the person may edit it; opens the form in place. */
  onEdit?: () => void;
  /** Present when the person may delete it. */
  deleteTarget?: DeletionTarget;
}

export function RelatedList({
  title,
  items,
  empty,
  loading = false,
  hint,
}: {
  title: string;
  items: readonly RelatedItem[];
  empty: ReactNode;
  loading?: boolean;
  hint?: ReactNode;
}) {
  return (
    <section className="card related" aria-label={title}>
      <h2>
        {title} <span className="muted related-count">{loading ? '…' : items.length}</span>
      </h2>
      {hint !== undefined && <p className="muted">{hint}</p>}
      {!loading && items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="related-list">
          {items.map((item) => (
            <li key={item.key}>
              <div className="related-main">
                <Link to={item.to}>
                  <strong>{item.title}</strong>
                </Link>
                {item.detail !== undefined && <span className="muted related-detail">{item.detail}</span>}
              </div>
              {item.meta !== undefined && <div className="related-meta">{item.meta}</div>}
              {(item.onEdit !== undefined || item.deleteTarget !== undefined) && (
                <div className="row-actions related-actions">
                  {item.onEdit !== undefined && (
                    <button type="button" onClick={item.onEdit} aria-label={`Edit ${item.title}`}>
                      Edit
                    </button>
                  )}
                  {item.deleteTarget !== undefined && <DeleteButton target={item.deleteTarget} />}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
