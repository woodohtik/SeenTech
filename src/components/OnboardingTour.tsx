import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { driver, type Driver, type DriveStep } from 'driver.js';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import {
  TOUR_CHECKLIST,
  buildTourSteps,
  getStepSelectors,
  isUsableAnchor,
  type TourStepDef,
} from '../config/tourSteps';
import TourWelcomeModal from './tour/TourWelcomeModal';
import TourFinishModal from './tour/TourFinishModal';

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export const TOUR_COMPLETED_KEY = 'hasSeenOnboarding';
export const TOUR_STATE_KEY = 'seenTourState_v2';
export const TOUR_VERSION = 2;

/** Restart the guided tour from anywhere (settings, user menu, help…). */
export function restartOnboardingTour() {
  window.dispatchEvent(new CustomEvent('start_onboarding_tour'));
}

type TourStatus = 'idle' | 'running' | 'completed' | 'skipped';

interface StoredTourState {
  version: number;
  status: TourStatus;
  step: number;
  /**
   * Sticky "this user has been through onboarding" flag. Once true it is never
   * cleared — replaying the tour must not make it auto-launch again later.
   */
  seen: boolean;
  updatedAt: string;
}

interface OnboardingTourProps {
  role?: string | null;
  tenantId?: string | null;
  staffId?: string | null;
  staffName?: string | null;
  tenantName?: string | null;
  tenantLogo?: string | null;
  /** Fine-grained permission checker, passed down from Layout to avoid a second fetch. */
  hasPermission?: (key: string) => boolean;
  /** Routes actually visible in this user's sidebar. */
  navRoutes?: string[];
  /**
   * Gate the auto-launch until permissions/nav are resolved, so the tour is
   * never built from an incomplete picture of what the user can access.
   */
  ready?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const MOBILE_BREAKPOINT = 1024;

const isMobileViewport = () =>
  typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;

/**
 * Polls the DOM until `selector` resolves to a visible, on-screen element.
 * Uses setTimeout only — requestAnimationFrame is paused in background tabs,
 * which would leave the promise (and the tour) hanging indefinitely.
 */
function waitForAnchor(selector: string, timeout: number): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const started = Date.now();

    const tick = () => {
      const el = document.querySelector(selector);
      if (isUsableAnchor(el)) {
        resolve(el);
        return;
      }
      if (Date.now() - started >= timeout) {
        resolve(null);
        return;
      }
      window.setTimeout(tick, 70);
    };

    tick();
  });
}

/**
 * Walks a step's candidate selectors in priority order. The first candidate
 * gets the full timeout (it is usually inside a lazy-loaded route that still
 * has to mount); later fallbacks only get a short grace period, since they are
 * either already present or not coming at all.
 */
async function resolveAnchor(
  selectors: string[],
  primaryTimeout: number
): Promise<{ selector: string; element: HTMLElement } | null> {
  for (let i = 0; i < selectors.length; i++) {
    const selector = selectors[i];
    const element = await waitForAnchor(selector, i === 0 ? primaryTimeout : 300);
    if (element) return { selector, element };
  }
  return null;
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function OnboardingTour({
  role,
  tenantId,
  staffId,
  staffName,
  tenantName,
  tenantLogo,
  hasPermission,
  navRoutes,
  ready = true,
}: OnboardingTourProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';

  const [phase, setPhase] = useState<'idle' | 'welcome' | 'running' | 'finish'>('idle');

  const driverRef = useRef<Driver | null>(null);
  const stepsRef = useRef<TourStepDef[]>([]);
  const indexRef = useRef(0);
  const movingRef = useRef(false);
  const bootedRef = useRef(false);

  // Keep the latest router helpers reachable from driver.js callbacks
  const navigateRef = useRef(navigate);
  const pathRef = useRef(location.pathname);
  navigateRef.current = navigate;
  pathRef.current = location.pathname;

  /* ---------------- persistence ---------------- */

  const stateKey = useMemo(() => {
    if (tenantId && staffId) return `${TOUR_STATE_KEY}_${tenantId}_${staffId}`;
    if (tenantId) return `${TOUR_STATE_KEY}_${tenantId}`;
    return TOUR_STATE_KEY;
  }, [tenantId, staffId]);

  const legacyKey = useMemo(() => {
    if (tenantId && staffId) return `${TOUR_COMPLETED_KEY}_${tenantId}_${staffId}`;
    if (tenantId) return `${TOUR_COMPLETED_KEY}_${tenantId}`;
    return TOUR_COMPLETED_KEY;
  }, [tenantId, staffId]);

  const readState = useCallback((): StoredTourState | null => {
    try {
      const raw = localStorage.getItem(stateKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredTourState;
      if (!parsed || parsed.version !== TOUR_VERSION) return null;
      return parsed;
    } catch {
      return null;
    }
  }, [stateKey]);

  const writeState = useCallback(
    (status: TourStatus, step: number, seen: boolean) => {
      const previous = (() => {
        try {
          const raw = localStorage.getItem(stateKey);
          return raw ? (JSON.parse(raw) as StoredTourState) : null;
        } catch {
          return null;
        }
      })();

      const payload: StoredTourState = {
        version: TOUR_VERSION,
        status,
        step,
        // `seen` is sticky: replaying must never un-see the tour
        seen: seen || previous?.seen === true,
        updatedAt: new Date().toISOString(),
      };

      try {
        localStorage.setItem(stateKey, JSON.stringify(payload));
      } catch {
        /* storage unavailable — the tour still works for this session */
      }

      if (payload.seen) {
        // Keep the per-user legacy flag in sync so older checks keep working.
        // Deliberately NOT the unscoped keys: on a shared terminal those would
        // hide the tour from every other member of staff.
        try {
          localStorage.setItem(legacyKey, 'true');
          sessionStorage.setItem('has_seen_tour_this_session', 'true');
        } catch {
          /* noop */
        }

        if (tenantId && staffId && staffId !== 'super_admin_mock_id') {
          supabase
            .from('staff')
            .update({ has_seen_onboarding: true })
            .eq('id', staffId)
            .then(undefined, () => undefined);
        }
      }
    },
    [stateKey, legacyKey, tenantId, staffId]
  );

  /** Records progress without touching the sticky `seen` flag. */
  const writeProgress = useCallback(
    (step: number) => writeState('running', step, false),
    [writeState]
  );

  const markCompleted = useCallback(
    (step: number) => writeState('completed', step, true),
    [writeState]
  );

  const markSkipped = useCallback(
    (step: number) => writeState('skipped', step, true),
    [writeState]
  );

  const isAlreadyDone = useCallback((): boolean => {
    const state = readState();
    if (state) return state.seen === true;

    // No v2 state — respect the legacy flags from the previous tour version
    try {
      return (
        localStorage.getItem(legacyKey) === 'true' ||
        localStorage.getItem(TOUR_COMPLETED_KEY) === 'true' ||
        localStorage.getItem('onboarding_tour_completed') === 'true'
      );
    } catch {
      return false;
    }
  }, [readState, legacyKey]);

  /* ---------------- step building ---------------- */

  const permissionCheck = useCallback(
    (key: string) => (hasPermission ? hasPermission(key) : true),
    [hasPermission]
  );

  const buildSteps = useCallback((): TourStepDef[] => {
    return buildTourSteps({
      hasPermission: permissionCheck,
      role,
      isMobile: isMobileViewport(),
      availableRoutes: navRoutes,
    });
  }, [permissionCheck, role, navRoutes]);

  /** Number of highlighted (non-modal) steps, shown on the welcome screen. */
  const spotlightCount = useMemo(
    () => buildSteps().filter((s) => !s.kind || s.kind === 'spotlight').length,
    [buildSteps]
  );

  /* ---------------- driver.js glue ---------------- */

  /** Selector actually resolved for each step id, filled in as we go. */
  const anchorsRef = useRef<Record<string, string | undefined>>({});

  const toDriveStep = useCallback(
    (step: TourStepDef): DriveStep => ({
      element: anchorsRef.current[step.id],
      popover: {
        title: t(`tour.steps.${step.id}.title`, step.id),
        description: t(`tour.steps.${step.id}.desc`, ''),
        side: step.side || 'bottom',
        align: step.align || 'center',
        popoverClass: 'seen-tour-popover',
      },
    }),
    [t]
  );

  const teardown = useCallback(
    (markAs: 'skipped' | null) => {
      const idx = indexRef.current;

      if (driverRef.current) {
        try {
          driverRef.current.destroy();
        } catch {
          /* noop */
        }
        driverRef.current = null;
      }

      document.documentElement.classList.remove('seen-tour-active');

      if (markAs === 'skipped') markSkipped(idx);
    },
    [markSkipped]
  );

  /** Navigates (if needed), waits for the anchor, then highlights step `index`. */
  const goToStep = useCallback(
    async (index: number, direction: 1 | -1 = 1) => {
      const steps = stepsRef.current;
      if (movingRef.current) return;

      // Past the last spotlight step → show the completion screen
      if (index >= steps.length) {
        teardown(null);
        indexRef.current = steps.length;
        markCompleted(steps.length);
        setPhase('finish');
        return;
      }

      if (index < 0) index = 0;

      movingRef.current = true;

      try {
        let cursor = index;

        // Walk forwards/backwards past optional steps whose anchor is absent
        while (cursor >= 0 && cursor < steps.length) {
          const step = steps[cursor];

          // 1) Route change — the page chunk is lazy-loaded, so the anchor
          //    resolution below is what actually waits for it.
          if (step.route && pathRef.current !== step.route) {
            navigateRef.current(step.route);
            await wait(80);
          }

          // 2) Resolve the best available anchor, primary candidate first
          const selectors = getStepSelectors(step, isMobileViewport());
          const hit = await resolveAnchor(selectors, step.timeout ?? 3500);

          if (!hit && step.optional) {
            const next = cursor + direction;
            if (next < 0) break;
            if (next >= steps.length) {
              teardown(null);
              indexRef.current = steps.length;
              markCompleted(steps.length);
              setPhase('finish');
              return;
            }
            cursor = next;
            continue;
          }

          anchorsRef.current[step.id] = hit?.selector;

          if (hit) {
            hit.element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            await wait(240);
          }
          break;
        }

        if (cursor < 0 || cursor >= steps.length) {
          cursor = Math.min(Math.max(cursor, 0), steps.length - 1);
        }

        indexRef.current = cursor;

        // 3) Rebuild the step list against the DOM as it is right now
        const d = driverRef.current;
        if (!d) return;

        d.setSteps(steps.map(toDriveStep));

        if (d.isActive()) {
          d.moveTo(cursor);
        } else {
          d.drive(cursor);
        }

        writeProgress(cursor);
      } finally {
        movingRef.current = false;
      }
    },
    [teardown, toDriveStep, markCompleted, writeProgress]
  );

  const createDriver = useCallback(
    () => {
      const d = driver({
        animate: true,
        showProgress: true,
        allowClose: false,
        stagePadding: 8,
        stageRadius: 12,
        overlayOpacity: 0.62,
        overlayColor: '#020617',
        popoverClass: 'seen-tour-popover',
        smoothScroll: true,
        disableActiveInteraction: true,
        // Arrow keys call moveNext/movePrevious directly, bypassing our
        // route-aware handlers — so we keep navigation to the buttons.
        allowKeyboardControl: false,
        showButtons: ['next', 'previous', 'close'],
        nextBtnText: t('tour.controls.next', 'التالي'),
        prevBtnText: t('tour.controls.prev', 'السابق'),
        doneBtnText: t('tour.controls.done', 'إنهاء الجولة'),
        // Keep {{current}} / {{total}} intact — driver.js does the interpolation,
        // so we swap i18next's delimiters while resolving this one string.
        progressText: t('tour.controls.progress', {
          defaultValue: '{{current}} من {{total}}',
          interpolation: { prefix: '[[', suffix: ']]' },
        }),
        onNextClick: () => {
          void goToStep(indexRef.current + 1, 1);
        },
        onPrevClick: () => {
          void goToStep(indexRef.current - 1, -1);
        },
        onCloseClick: () => {
          teardown('skipped');
          setPhase('idle');
        },
        onPopoverRender: (popover) => {
          // Mirror the app's direction inside the popover
          popover.wrapper.setAttribute('dir', isRtl ? 'rtl' : 'ltr');

          // A discreet "skip the whole tour" escape hatch in the footer
          if (!popover.footer.querySelector('.seen-tour-skip')) {
            const skip = document.createElement('button');
            skip.type = 'button';
            skip.className = 'seen-tour-skip';
            skip.textContent = t('tour.controls.skip', 'تخطي الجولة');
            skip.addEventListener('click', () => {
              teardown('skipped');
              setPhase('idle');
            });
            popover.footer.insertBefore(skip, popover.footer.firstChild);
          }
        },
      });

      return d;
    },
    [goToStep, teardown, isRtl, t]
  );

  /* ---------------- lifecycle ---------------- */

  const startTour = useCallback(
    (fromStep = 0) => {
      const steps = buildSteps().filter((s) => !s.kind || s.kind === 'spotlight');
      if (steps.length === 0) {
        setPhase('finish');
        return;
      }

      stepsRef.current = steps;
      indexRef.current = Math.min(Math.max(fromStep, 0), steps.length - 1);

      if (driverRef.current) {
        try {
          driverRef.current.destroy();
        } catch {
          /* noop */
        }
      }

      driverRef.current = createDriver();
      document.documentElement.classList.add('seen-tour-active');
      setPhase('running');

      void goToStep(indexRef.current);
    },
    [buildSteps, createDriver, goToStep]
  );

  const openWelcome = useCallback(() => {
    const steps = buildSteps().filter((s) => !s.kind || s.kind === 'spotlight');
    if (steps.length === 0) {
      // Nothing this user can be shown — record it and stay out of the way
      markCompleted(0);
      return;
    }
    setPhase('welcome');
  }, [buildSteps, markCompleted]);

  // Manual restarts, from the user menu or Settings.
  useEffect(() => {
    const handleRestart = () => {
      teardown(null);
      indexRef.current = 0;
      anchorsRef.current = {};
      openWelcome();
    };

    window.addEventListener('start_onboarding_tour', handleRestart);
    return () => window.removeEventListener('start_onboarding_tour', handleRestart);
  }, [teardown, openWelcome]);

  /**
   * Auto-launch on the very first visit.
   *
   * `staffId` arrives asynchronously after login, so this effect re-runs once
   * the staff record lands. `bootedRef` is therefore only latched inside the
   * timer callback — latching it up-front would let the re-run's cleanup cancel
   * the pending timer and block the tour forever.
   */
  useEffect(() => {
    if (!ready || bootedRef.current) return;
    // Wait for the identity we key storage on, so progress is never written
    // against the unscoped key and permissions are known to be resolved.
    if (!staffId) return;
    if (isAlreadyDone()) return;

    const timer = window.setTimeout(() => {
      if (bootedRef.current || isAlreadyDone()) return;
      bootedRef.current = true;

      const stored = readState();
      if (stored?.status === 'running' && stored.step > 0) {
        startTour(stored.step); // resume quietly where they left off
      } else {
        openWelcome();
      }
    }, 1200);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, staffId, ready]);

  // Clean up on unmount / language switch
  useEffect(() => {
    return () => {
      if (driverRef.current) {
        try {
          driverRef.current.destroy();
        } catch {
          /* noop */
        }
        driverRef.current = null;
      }
      document.documentElement.classList.remove('seen-tour-active');
    };
  }, []);

  // Keep the spotlight aligned when the window resizes
  useEffect(() => {
    if (phase !== 'running') return;
    const onResize = () => {
      try {
        driverRef.current?.refresh();
      } catch {
        /* noop */
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [phase]);

  /**
   * The driver instance captures the translator at creation time, so a language
   * switch mid-tour would leave stale copy on screen. Rebuild in place, keeping
   * the user on the step they were reading.
   */
  const langRef = useRef(i18n.language);
  useEffect(() => {
    if (langRef.current === i18n.language) return;
    langRef.current = i18n.language;

    if (phase !== 'running') return;
    const resumeAt = indexRef.current;
    teardown(null);
    window.setTimeout(() => startTour(resumeAt), 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language]);

  /* ---------------- render ---------------- */

  const checklist = useMemo(
    () => TOUR_CHECKLIST.filter((item) => !item.permission || permissionCheck(item.permission)),
    [permissionCheck]
  );

  if (phase === 'welcome') {
    return (
      <TourWelcomeModal
        tenantName={tenantName}
        userName={staffName}
        logoUrl={tenantLogo}
        stepCount={spotlightCount}
        onStart={() => startTour(0)}
        onSkip={() => {
          markSkipped(0);
          setPhase('idle');
        }}
      />
    );
  }

  if (phase === 'finish') {
    return (
      <TourFinishModal
        checklist={checklist}
        onGo={(route) => {
          markCompleted(stepsRef.current.length);
          setPhase('idle');
          navigate(route);
        }}
        onClose={() => {
          markCompleted(stepsRef.current.length);
          setPhase('idle');
          navigate('/dashboard');
        }}
        onRestart={() => {
          setPhase('idle');
          anchorsRef.current = {};
          window.setTimeout(() => startTour(0), 120);
        }}
      />
    );
  }

  return null;
}
