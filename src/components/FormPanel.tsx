/**
 * A form that comes to you.
 *
 * Pressing "New client" on a page with forty clients used to open a form below
 * forty rows, out of sight, with no indication anything had happened. The user
 * scrolled looking for it, or pressed the button again and wondered why nothing
 * worked.
 *
 * So a form panel scrolls itself into view and puts the cursor in the first
 * field. Both matter: the scroll says something happened, the focus says where
 * to start typing — and together they mean the keyboard never has to find its
 * own way down the page either.
 */

import { useEffect, useRef, type ReactNode } from 'react';

export function FormPanel({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = panel.current;
    if (node === null) return;

    // `center` rather than `start`: a form pinned to the top of the viewport
    // sits under the sticky header on a short screen.
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });

    /**
     * Focus the first thing worth typing into. A `<select>` is skipped where a
     * text field follows it, because landing on a dropdown means the first
     * keystroke silently changes a value instead of typing one.
     */
    const fields = node.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
    );
    const firstText = Array.from(fields).find((field) => field.tagName !== 'SELECT');
    (firstText ?? fields[0])?.focus({ preventScroll: true });
  }, []);

  // Escape closes it, the way every other dismissible thing does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section className="card form-panel no-print" ref={panel} aria-label={title}>
      <div className="form-panel-head">
        <div>
          <h2>{title}</h2>
          {description !== undefined && <p className="muted">{description}</p>}
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={`Close ${title}`}>
          ✕
        </button>
      </div>
      {children}
    </section>
  );
}
