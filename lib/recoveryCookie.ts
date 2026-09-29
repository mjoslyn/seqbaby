// Set by /auth/confirm when a password reset link is followed, and required by
// setNewPassword (app/auth/actions.ts), which changes a password without asking
// for the current one. Its own module because a "use server" file may export
// only async functions, and the two must agree on the name.
export const RECOVERY_COOKIE = "sq-recovery";

// Long enough to type a password, short enough that a reset left open in a tab
// is not a standing way around the current-password check in settings.
export const RECOVERY_MAX_AGE = 15 * 60;
