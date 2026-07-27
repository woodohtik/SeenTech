import React, { useEffect, useRef } from 'react';
import { driver, Driver } from 'driver.js';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase/client';

interface OnboardingTourProps {
  role?: string | null;
  tenantId?: string | null;
  staffId?: string | null;
}

export const TOUR_COMPLETED_KEY = 'hasSeenOnboarding';

/**
 * Helper to restart onboarding tour from any component/button
 */
export function restartOnboardingTour() {
  window.dispatchEvent(new CustomEvent('start_onboarding_tour'));
}

export default function OnboardingTour({ role, tenantId, staffId }: OnboardingTourProps) {
  const { t, i18n } = useTranslation();
  const driverRef = useRef<Driver | null>(null);
  const hasTriggeredRef = useRef<boolean>(false);

  const getStorageKey = () => {
    if (tenantId && staffId) return `${TOUR_COMPLETED_KEY}_${tenantId}_${staffId}`;
    if (tenantId) return `${TOUR_COMPLETED_KEY}_${tenantId}`;
    return TOUR_COMPLETED_KEY;
  };

  const checkIsCompleted = () => {
    const key = getStorageKey();
    return (
      localStorage.getItem(key) === 'true' ||
      localStorage.getItem(TOUR_COMPLETED_KEY) === 'true' ||
      localStorage.getItem('onboarding_tour_completed') === 'true' ||
      sessionStorage.getItem('has_seen_tour_this_session') === 'true'
    );
  };

  const markTourCompleted = async () => {
    const key = getStorageKey();
    localStorage.setItem(key, 'true');
    localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
    localStorage.setItem('onboarding_tour_completed', 'true');
    sessionStorage.setItem('has_seen_tour_this_session', 'true');

    // Attempt to persist completion state to database if staff/tenant present
    if (tenantId && staffId && staffId !== 'super_admin_mock_id') {
      try {
        await supabase
          .from('staff')
          .update({ has_seen_onboarding: true })
          .eq('id', staffId);
      } catch (e) {
        console.warn('Could not save onboarding state to DB:', e);
      }
    }
  };

  const startTour = (force = false) => {
    const isCompleted = checkIsCompleted();

    if (isCompleted && !force) {
      return;
    }

    // Immediately mark as completed so that refreshes or navigation won't re-trigger it
    markTourCompleted();
    hasTriggeredRef.current = true;

    // Destroy any existing driver instance before initializing
    if (driverRef.current) {
      driverRef.current.destroy();
    }

    // 5 Required Steps as requested
    const rawSteps = [
      {
        element: '#tour-dashboard-nav',
        fallbackElement: '#tour-dashboard-container',
        popover: {
          title: t('tour.step1.title', 'مرحباً بك في نظام سين! 👋'),
          description: t('tour.step1.desc', 'هنا تجد ملخصاً لمبيعاتك وأداء محلك بشكل يومي'),
          side: 'bottom' as const,
          align: 'center' as const
        }
      },
      {
        element: '#tour-sidebar',
        fallbackElement: '#tour-sidebar-mobile',
        popover: {
          title: t('tour.step2.title', 'تنقل بسهولة 🧭'),
          description: t('tour.step2.desc', 'من هنا يمكنك الوصول إلى كافة أقسام النظام مثل الطلبات، العملاء، والتقارير'),
          side: 'right' as const,
          align: 'start' as const
        }
      },
      {
        element: '#tour-pos-nav',
        fallbackElement: '#tour-sales-btn',
        popover: {
          title: t('tour.step3.title', 'ابدأ البيع ✂️'),
          description: t('tour.step3.desc', 'اضغط هنا لإنشاء فاتورة تفصيل جديدة أو بيع منتج جاهز'),
          side: 'right' as const,
          align: 'center' as const
        }
      },
      {
        element: '#tour-suppliers-nav',
        fallbackElement: '#tour-inventory-nav',
        popover: {
          title: t('tour.step4.title', 'الموردين والمشتريات 🚛'),
          description: t('tour.step4.desc', 'من هنا يمكنك إدارة قائمة الموردين ومشتريات الأقمشة والمستلزمات ومتابعة الحسابات والفواتير المستحقة للموردين'),
          side: 'right' as const,
          align: 'center' as const
        }
      },
      {
        element: '#tour-orders-nav',
        fallbackElement: '#tour-pos-nav',
        popover: {
          title: t('tour.step5.title', 'سجل الطلبات والفواتير 🧾'),
          description: t('tour.step5.desc', 'النظام يصدر فواتير ضريبية مبسطة متوافقة مع متطلبات هيئة الزكاة والضريبة والجمارك (ZATCA) مع تتبع حالة الخياطة والتسليم'),
          side: 'right' as const,
          align: 'center' as const
        }
      }
    ];

    // Filter valid steps that have matching elements or fallbacks in DOM
    const validSteps = rawSteps.map(step => {
      let targetEl = step.element;
      if (!document.querySelector(targetEl) && step.fallbackElement && document.querySelector(step.fallbackElement)) {
        targetEl = step.fallbackElement;
      }
      return {
        element: targetEl,
        popover: step.popover
      };
    });

    const isRtl = i18n.language === 'ar' || i18n.language === 'ur';

    const driverObj = driver({
      showProgress: true,
      animate: true,
      stagePadding: 8,
      stageRadius: 10,
      overlayColor: 'rgba(15, 23, 42, 0.2)',
      popoverClass: 'seen-tour-popover',
      nextBtnText: isRtl ? 'التالي ←' : 'Next →',
      prevBtnText: isRtl ? '→ السابق' : '← Back',
      doneBtnText: isRtl ? 'تم وإكمال الجولة 🎉' : 'Finish Tour 🎉',
      progressText: isRtl ? 'الخطوة {{current}} من {{total}}' : 'Step {{current}} of {{total}}',
      showButtons: ['next', 'previous', 'close'],
      allowClose: true,
      onDestroyed: () => {
        markTourCompleted();
      },
      onCloseClick: () => {
        markTourCompleted();
        driverObj.destroy();
      },
      steps: validSteps
    });

    driverRef.current = driverObj;

    // Small delay to ensure layout rendering and animations complete
    setTimeout(() => {
      driverObj.drive();
    }, 400);
  };

  useEffect(() => {
    // Listener for custom trigger from settings or user menu
    const handleCustomStart = () => {
      startTour(true);
    };

    window.addEventListener('start_onboarding_tour', handleCustomStart);

    // Auto-start check on initial login
    const isCompleted = checkIsCompleted();

    let autoTimer: NodeJS.Timeout | null = null;

    if (!isCompleted && !hasTriggeredRef.current) {
      autoTimer = setTimeout(() => {
        if (!checkIsCompleted() && !hasTriggeredRef.current) {
          startTour(false);
        }
      }, 1500);
    }

    return () => {
      window.removeEventListener('start_onboarding_tour', handleCustomStart);
      if (autoTimer) {
        clearTimeout(autoTimer);
      }
      if (driverRef.current) {
        driverRef.current.destroy();
      }
    };
  }, [tenantId, staffId, i18n.language]);

  return null;
}

