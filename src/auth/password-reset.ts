/**
 * Resetting a forgotten password.
 *
 * WHY THE MESSAGES ARE WHAT THEY ARE
 *   The sign-in page already refuses to say whether it was the email or the
 *   password that was wrong — "Incorrect email or password" covers both, so the
 *   form cannot be used to find out who has an account. A reset form that said
 *   "no account with that address" would undo that in one click, so it does not.
 *   Whether or not the address belongs to anybody, the person sees the same
 *   sentence.
 *
 * WHY "NO SUCH USER" COUNTS AS SUCCESS
 *   Firebase answers an unknown address in one of two ways depending on how the
 *   project was created: older projects throw `auth/user-not-found`, newer ones
 *   quietly succeed to prevent exactly the probing above. The app cannot know
 *   which it has, so both are folded into the one outcome. Treating the first as
 *   an error would make behaviour depend on a project setting nobody can see.
 *
 * WHAT IS STILL SAID PLAINLY
 *   The failures that carry no information about accounts — a malformed
 *   address, a lost connection, too many requests — are named, because for
 *   those the person needs to do something different.
 */

import { FirebaseError } from 'firebase/app';

/**
 * What the person is told after asking for a reset.
 *
 * Phrased "if an account exists" because that is what is true: nothing here
 * knows. It also names the places mail tends to go, since the sender is Firebase
 * rather than a company address and filters treat that with suspicion.
 */
export const RESET_REQUESTED_MESSAGE =
  'If an account exists for that address, a reset link is on its way. ' +
  'It can take a few minutes — check your spam or junk folder too.';

/** How long before another reset may be asked for from the same screen. */
export const RESET_COOLDOWN_SECONDS = 30;

export type ResetOutcome =
  | { kind: 'requested' }
  | { kind: 'failed'; message: string };

/**
 * Does this look enough like an address to be worth sending?
 *
 * Deliberately crude: something, an @, something, a dot, something. The only job
 * is to catch a typo before a round trip. Whether the address is real is not
 * something a pattern can know, and a strict one rejects addresses that work.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** What to say when the box was left empty. Checked before anything is sent. */
export const MISSING_EMAIL_OUTCOME: ResetOutcome = {
  kind: 'failed',
  message: 'Enter the email address you sign in with.',
};

/** What to say when the address is plainly malformed. */
export const MALFORMED_EMAIL_OUTCOME: ResetOutcome = {
  kind: 'failed',
  message: 'That does not look like an email address.',
};

/**
 * Turn whatever the request threw into what the screen should do.
 *
 * Unknown errors fall to a generic failure rather than to "requested": telling
 * somebody a link is coming when the request never went out leaves them waiting
 * for an email that does not exist.
 */
export function resetOutcomeFor(error: unknown): ResetOutcome {
  if (!(error instanceof FirebaseError)) {
    return { kind: 'failed', message: 'Could not send the reset link. Try again in a moment.' };
  }
  switch (error.code) {
    // Unknown address — folded into success, for the reasons in the header.
    case 'auth/user-not-found':
      return { kind: 'requested' };
    case 'auth/invalid-email':
      return MALFORMED_EMAIL_OUTCOME;
    case 'auth/missing-email':
      return MISSING_EMAIL_OUTCOME;
    case 'auth/too-many-requests':
      return {
        kind: 'failed',
        message: 'Too many requests. Wait a few minutes before asking for another link.',
      };
    case 'auth/network-request-failed':
      return { kind: 'failed', message: 'Cannot reach the server. Check your connection.' };
    default:
      return {
        kind: 'failed',
        message: 'Could not send the reset link. Try again, or ask an administrator to reset it.',
      };
  }
}

/**
 * Should the request be retried without a "return to the app" link?
 *
 * The reset email can carry a button back to the app, but only to a domain
 * listed as authorised in the Firebase console. A new custom domain, or a
 * preview URL, is not on that list and the request is refused outright — which
 * would mean nobody could reset a password from it at all. The return link is a
 * convenience; the reset is the point. So a refusal over the link alone is
 * retried without it.
 */
export function shouldRetryWithoutReturnLink(error: unknown): boolean {
  return (
    error instanceof FirebaseError &&
    (error.code === 'auth/unauthorized-continue-uri' ||
      error.code === 'auth/invalid-continue-uri' ||
      error.code === 'auth/missing-continue-uri')
  );
}

/**
 * Seconds left before another request is allowed — never negative, and never
 * more than the cooldown itself.
 *
 * The upper bound is for a phone whose clock is corrected backwards while the
 * page is open: without it the countdown would jump to something longer than
 * the cooldown ever is, and a person would sit watching a number that cannot be
 * right.
 */
export function secondsUntilResend(lastRequestedAt: number | null, now: number): number {
  if (lastRequestedAt === null) return 0;
  const left = RESET_COOLDOWN_SECONDS - Math.floor((now - lastRequestedAt) / 1000);
  return Math.min(RESET_COOLDOWN_SECONDS, Math.max(0, left));
}
