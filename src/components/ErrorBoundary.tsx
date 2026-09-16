/**
 * A page that fails says so.
 *
 * WHY THIS EXISTS
 *   There was no error boundary anywhere in the app, so any exception thrown
 *   while rendering — one record missing an optional array, one period key that
 *   predates a field, one date that will not parse — replaced the entire
 *   application with a blank white page. Not an error: nothing. No navigation,
 *   no way back, no clue what happened.
 *
 *   That is the worst failure mode a finance system can have, because the user
 *   cannot tell it apart from "the internet is down" or "my data is gone". It
 *   was found by rendering every page in a browser: two of twenty-three were
 *   white, and neither said why.
 *
 * WHAT IT DOES NOT DO
 *   It does not swallow the error. The message is shown, the console still has
 *   the stack, and the rail stays on screen so the rest of the app is still
 *   reachable — a broken Reports page must not cost you Collections.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Changing this resets the boundary — used to clear the error on navigation. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidUpdate(previous: Props): void {
    // Navigating away from a broken page must not leave the error on screen.
    if (this.state.error !== null && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The stack is worth more than the message when somebody reports this.
    console.error('Page failed to render:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <section className="card page-error" role="alert">
        <h1>This page could not be drawn</h1>
        <p>
          Something in the records on this page is not the shape the page expects, so it stopped
          rather than show you figures it could not stand behind. Everything else in the app still
          works — use the menu on the left.
        </p>
        <p className="muted">
          If you tell whoever maintains this what you were looking at, the line below is the part
          that matters.
        </p>
        <pre className="page-error-detail">{error.message}</pre>
        <p className="form-actions">
          <button type="button" className="primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </p>
      </section>
    );
  }
}
