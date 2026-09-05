import '../lib/intlSetup';
import { createI18n } from './createI18n';

import ar from './locales/ar.json';
import en from './locales/en.json';
import ur from './locales/ur.json';

export default createI18n({ ar, en, ur });
