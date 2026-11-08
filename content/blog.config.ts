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
  ctaUrl: 'https://seentech.io',
  startHereSlugs: [] as string[],
  interviewStat: { stat: '', description: '', source: '' } as InterviewStat,
};
