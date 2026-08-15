-- The onboarding tour (src/components/OnboardingTour.tsx) already writes to
-- and reads from staff.has_seen_onboarding to persist "this staff member has
-- completed the tour" across devices/browsers (localStorage alone is
-- per-device, and is also wiped on every logout by AuthContext.logout()'s
-- localStorage.clear()) -- but this column was never actually created, so
-- that write silently failed and the read always came back undefined,
-- making the tour reappear on every fresh login/device.
ALTER TABLE staff
ADD COLUMN IF NOT EXISTS has_seen_onboarding BOOLEAN NOT NULL DEFAULT FALSE;
