/**
 * Resetting a forgotten password.
 *
 * The property that matters most is a negative one: asking for a reset must not
 * tell anybody whether an address has an account. The sign-in page already
 * refuses to distinguish a wrong email from a wrong password, and a reset form
 * that said "no such user" would undo that in one click.
 */

import { describe, expect, it } from 'vitest';
import { FirebaseError } from 'firebase/app';
import {
  looksLikeEmail,
  MISSING_EMAIL_OUTCOME,
  RESET_COOLDOWN_SECONDS,
  RESET_REQUESTED_MESSAGE,
  resetOutcomeFor,
  secondsUntilResend,
  shouldRetryWithoutReturnLink,
} from '../password-reset.js';

const failure = (code: string) => new FirebaseError(code, code);

describe('what a reset request is allowed to reveal', () => {
  it('treats an unknown address as success, exactly like a known one', () => {
    // Older Firebase projects throw here; newer ones quietly succeed. Folding
    // both into one outcome means the app's behaviour does not depend on a
    // project setting nobody can see.
    expect(resetOutcomeFor(failure('auth/user-not-found'))).toEqual({ kind: 'requested' });
  });

  it('phrases the confirmation as a conditional, because that is what is true', () => {
    expect(RESET_REQUESTED_MESSAGE).toMatch(/^If an account exists/);
    expect(RESET_REQUESTED_MESSAGE).not.toMatch(/we have sent|has been sent|sent you/i);
  });

  it('points at the spam folder, because the sender is Firebase and filters distrust it', () => {
    expect(RESET_REQUESTED_MESSAGE.toLowerCase()).toContain('spam');
  });
});

describe('failures that reveal nothing about accounts are named', () => {
  it.each([
    ['auth/invalid-email', /does not look like an email/i],
    ['auth/missing-email', /enter the email/i],
    ['auth/too-many-requests', /too many requests/i],
    ['auth/network-request-failed', /cannot reach the server/i],
  ])('%s', (code, expected) => {
    const outcome = resetOutcomeFor(failure(code));
    expect(outcome.kind).toBe('failed');
    expect(outcome.kind === 'failed' && outcome.message).toMatch(expected);
  });

  it('never says a link is coming when the request failed for a reason it does not know', () => {
    // Telling somebody to wait for an email that was never sent is worse than
    // telling them it failed.
    const outcome = resetOutcomeFor(failure('auth/something-new'));
    expect(outcome.kind).toBe('failed');
  });

  it('treats a non-Firebase error as a failure too', () => {
    expect(resetOutcomeFor(new Error('boom')).kind).toBe('failed');
    expect(resetOutcomeFor('a string').kind).toBe('failed');
  });

  it('has a ready answer for an empty box', () => {
    expect(MISSING_EMAIL_OUTCOME.kind).toBe('failed');
  });
});

describe('catching a typo before a round trip', () => {
  it.each(['boss@intelmotion.com', ' boss@intelmotion.com ', 'a.b+c@sub.example.co.et'])(
    'lets %j through',
    (value) => {
      expect(looksLikeEmail(value)).toBe(true);
    },
  );

  it.each(['', 'not-an-email', 'boss@', '@intelmotion.com', 'boss@intelmotion', 'bo ss@x.com'])(
    'stops %j',
    (value) => {
      // Otherwise an emulator, or an older project, answers it as merely
      // "unknown" and the person is told a link is on its way to an address that
      // cannot receive one.
      expect(looksLikeEmail(value)).toBe(false);
    },
  );
});

describe('the return link is a convenience, not a requirement', () => {
  it.each([
    'auth/unauthorized-continue-uri',
    'auth/invalid-continue-uri',
    'auth/missing-continue-uri',
  ])('retries without it after %s', (code) => {
    // A domain not listed as authorised in the Firebase console would otherwise
    // mean nobody could reset a password from it at all.
    expect(shouldRetryWithoutReturnLink(failure(code))).toBe(true);
  });

  it('does not retry anything else', () => {
    expect(shouldRetryWithoutReturnLink(failure('auth/too-many-requests'))).toBe(false);
    expect(shouldRetryWithoutReturnLink(failure('auth/network-request-failed'))).toBe(false);
    expect(shouldRetryWithoutReturnLink(new Error('x'))).toBe(false);
  });
});

describe('asking again', () => {
  it('allows the first request immediately', () => {
    expect(secondsUntilResend(null, Date.now())).toBe(0);
  });

  it('counts down from the cooldown', () => {
    const t = 1_000_000;
    expect(secondsUntilResend(t, t)).toBe(RESET_COOLDOWN_SECONDS);
    expect(secondsUntilResend(t, t + 10_000)).toBe(RESET_COOLDOWN_SECONDS - 10);
  });

  it('reaches zero and stays there', () => {
    const t = 1_000_000;
    expect(secondsUntilResend(t, t + RESET_COOLDOWN_SECONDS * 1000)).toBe(0);
    expect(secondsUntilResend(t, t + 10 * 60_000)).toBe(0);
  });

  it('stays within the cooldown if the clock is corrected backwards', () => {
    // A phone resyncing its clock while the page is open must not produce a
    // countdown longer than the cooldown ever is.
    const t = 1_000_000;
    expect(secondsUntilResend(t, t - 5000)).toBe(RESET_COOLDOWN_SECONDS);
    expect(secondsUntilResend(t, t - 10 * 60_000)).toBe(RESET_COOLDOWN_SECONDS);
  });
});
