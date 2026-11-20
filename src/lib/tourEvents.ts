/**
 * Starting a guided tour from anywhere (the assistant, buttons) is only an
 * event; the tour itself (OnboardingTour + driver.js) listens for it. Kept
 * apart so callers do not pull the tour and driver.js into their own chunk
 * (seen-performance-first-open-login-task.md Phase 2).
 */
export const TARGETED_TOUR_EVENT = 'start_targeted_tour';

export function startTargetedTour(topic: string) {
  window.dispatchEvent(new CustomEvent(TARGETED_TOUR_EVENT, { detail: { topic } }));
}
