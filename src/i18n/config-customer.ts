import '../lib/intlSetup';
import { createI18n } from './createI18n';

// Trimmed copies of the public_tracking/my_orders/common.status_ready keys
// from the main locale files -- NOT auto-generated, keep in sync by hand
// whenever those keys change in src/i18n/locales/*.json. Kept separate so
// the customer app build doesn't pull in the full ~900KB admin-app
// translation set (orders/inventory/settings/etc.) it has no use for.
import ar from './locales/customer/ar.json';
import en from './locales/customer/en.json';
import ur from './locales/customer/ur.json';

export default createI18n({ ar, en, ur });
