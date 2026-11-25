import { SIGNUP_URL } from '../scripts/blog/siteOrigin';

export interface InterviewStat {
  stat: string;
  description: string;
  source: string;
}

// Values that are genuinely unknown today (tracking IDs, the real WhatsApp
// number, manually-curated picks) stay empty strings/arrays on purpose --
// templates must render gracefully without them. Fill them in here, not in
// template code, once the team supplies the real values.
export const blogConfig = {
  whatsappNumber: '',
  ga4MeasurementId: '',
  snapchatPixelId: '',
  metaPixelId: '',
  ctaLabel: 'ابدأ الآن',
  // The sign-up screen (seen-blog-cta-to-signup-task.md), not the landing page.
  ctaUrl: SIGNUP_URL,
  startHereSlugs: [] as string[],
  interviewStat: { stat: '', description: '', source: '' } as InterviewStat,
};
