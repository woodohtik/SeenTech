import i18n from 'i18next';

// Supabase Auth returns errors as { message, status } — plain strings, not
// Firebase-style `auth/xxx` codes — so matching is done against the message
// text. i18n keys are kept identical to the Firebase-era ones where the
// semantic meaning matches, so translation files didn't need restructuring.
const SUPABASE_AUTH_MESSAGE_MAP: Array<[RegExp, string]> = [
  [/invalid login credentials/i, 'errors.auth.invalid_credentials'],
  [/user already registered/i, 'errors.auth.email_already_in_use'],
  [/email not confirmed/i, 'errors.auth.email_not_confirmed'],
  [/password should be at least/i, 'errors.auth.weak_password'],
  [/unable to validate email address/i, 'errors.auth.invalid_email'],
  [/email rate limit exceeded|too many requests/i, 'errors.auth.too_many_requests'],
  [/network/i, 'errors.auth.network_request_failed'],
  [/new password should be different from the old password/i, 'errors.auth.same_password'],
];

export const getAuthErrorMessage = (err: any): string => {
  if (!err) return i18n.t('errors.auth.unexpected_login');

  const message = typeof err === 'string' ? err : err.message || '';

  for (const [pattern, key] of SUPABASE_AUTH_MESSAGE_MAP) {
    if (pattern.test(message)) return i18n.t(key);
  }

  return message || i18n.t('errors.auth.generic');
};
