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

import { useEffect, useRef, useState, type ReactNode } from 'react';

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
  /**
   * Why the browser refused to submit, in words.
   *
   * A form with a field the browser considers invalid is not submitted at all:
   * our handler never runs and the only sign is a small pop-up by the field,
   * which on a long form is off-screen and gone in a couple of seconds. From the
   * chair that is a Save button that does nothing. So the refusal is caught and
   * said here, where it stays until the person acts on it.
   */
  const [blocked, setBlocked] = useState<string | null>(null);

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
    <section
      className="card form-panel no-print"
      ref={panel}
      aria-label={title}
      onInvalidCapture={(event) => {
        const field = event.target as HTMLInputElement;
        const label = field.labels?.[0]?.textContent?.replace(/[\s*]+$/, '').trim() || field.name || 'A field';
        // The browser reports every invalid field; the first one is enough.
        setBlocked((current) => current ?? `Not saved — ${label}: ${field.validationMessage}`);
      }}
      onChangeCapture={() => setBlocked(null)}
      onSubmitCapture={() => setBlocked(null)}
    >
      <div className="form-panel-head">
        <div>
          <h2>{title}</h2>
          {description !== undefined && <p className="muted">{description}</p>}
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={`Close ${title}`}>
          ✕
        </button>
      </div>
      {blocked !== null && (
        <p className="error form-blocked" role="alert">
          {blocked}
        </p>
      )}
      {children}
    </section>
  );
}
