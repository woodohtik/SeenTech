import i18n from 'i18next';

export const getAuthErrorMessage = (err: any): string => {
  if (!err) return i18n.t('errors.auth.unexpected_login');

  const code = typeof err === 'string' ? err : err.code || '';
  const message = typeof err === 'string' ? err : err.message || '';

  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return i18n.t('errors.auth.invalid_credentials');
  }
  if (code === 'auth/email-already-in-use') {
    return i18n.t('errors.auth.email_already_in_use');
  }
  if (code === 'auth/invalid-email') {
    return i18n.t('errors.auth.invalid_email');
  }
  if (code === 'auth/weak-password') {
    return i18n.t('errors.auth.weak_password');
  }
  if (code === 'auth/too-many-requests') {
    return i18n.t('errors.auth.too_many_requests');
  }
  if (code === 'auth/network-request-failed') {
    return i18n.t('errors.auth.network_request_failed');
  }
  if (code === 'auth/popup-closed-by-user') {
    return i18n.t('errors.auth.popup_closed_by_user');
  }
  if (code === 'auth/popup-blocked') {
    return i18n.t('errors.auth.popup_blocked');
  }

  // Fallback checks for string error messages
  if (message.includes('auth/invalid-credential') || message.includes('auth/wrong-password') || message.includes('auth/user-not-found')) {
    return i18n.t('errors.auth.invalid_credentials');
  }
  if (message.includes('auth/email-already-in-use')) {
    return i18n.t('errors.auth.email_already_registered');
  }
  if (message.includes('Firebase: Error') || message.startsWith('Firebase:')) {
    return i18n.t('errors.auth.invalid_login_or_missing_account');
  }

  return message || i18n.t('errors.auth.generic');
};
