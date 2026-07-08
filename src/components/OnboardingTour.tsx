import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, ShoppingCart, CreditCard, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';

const TOUR_STEPS = [
  {
    icon: Users,
    title: 'اختيار العميل',
    description: 'قم بالبحث عن العميل أو إضافة عميل جديد مع مقاساته من القسم العلوي.',
    color: 'text-blue-500',
    bg: 'bg-blue-500/10'
  },
  {
    icon: ShoppingCart,
    title: 'إضافة المنتجات',
    description: 'اختر الخدمات أو المنتجات المطلوبة من القائمة لإضافتها إلى السلة.',
    color: 'text-brand',
    bg: 'bg-brand/10'
  },
  {
    icon: CreditCard,
    title: 'إتمام الدفع',
    description: 'راجع السلة على اليسار واضغط على الدفع لإصدار الفاتورة وتأكيد الطلب.',
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10'
  }
];

export default function OnboardingTour({ role }: { role?: string | null }) {
  
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (role === 'staff') {
      const isDismissed = localStorage.getItem('staff_onboarding_tour_dismissed');
      if (!isDismissed) {
        setIsOpen(true);
      }
    }
  }, [role]);

  const handleDismiss = () => {
    localStorage.setItem('staff_onboarding_tour_dismissed', 'true');
    setIsOpen(false);
  };

  const nextStep = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleDismiss();
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  if (!isOpen) return null;

  const StepIcon = TOUR_STEPS[currentStep].icon;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" dir="rtl">
        <motion.div
          key="modal"
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="bg-surface w-full max-w-md rounded-3xl shadow-2xl overflow-hidden relative border border-border flex flex-col"
        >
          <div className="p-4 flex justify-between items-center absolute top-0 left-0 right-0 z-10">
             <button
              onClick={handleDismiss}
              className="px-4 py-1.5 bg-surface-muted hover:bg-border rounded-full text-content-muted text-sm font-bold transition-colors"
            >
              تخطي الجولة
            </button>
            <div className="flex gap-1.5" dir="ltr">
              {TOUR_STEPS.map((_, idx) => (
                <div key={idx} className={`h-1.5 rounded-full transition-all ${idx === currentStep ? 'w-6 bg-brand' : 'w-2 bg-border'}`} />
              ))}
            </div>
          </div>
          
          <div className="pt-20 pb-8 px-8 flex flex-col items-center text-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col items-center w-full"
              >
                <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 ${TOUR_STEPS[currentStep].bg}`}>
                  <StepIcon size={48} className={TOUR_STEPS[currentStep].color} />
                </div>
                <h3 className="text-2xl font-black text-content mb-3">{TOUR_STEPS[currentStep].title}</h3>
                <p className="text-content-muted leading-relaxed">
                  {TOUR_STEPS[currentStep].description}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="p-6 border-t border-border bg-surface-muted flex justify-between items-center gap-3">
            <button
              onClick={prevStep}
              disabled={currentStep === 0}
              className={`p-3 rounded-xl flex items-center justify-center transition-colors ${currentStep === 0 ? 'opacity-50 cursor-not-allowed text-content-muted' : 'text-content hover:bg-border bg-surface border border-border'}`}
            >
              <ChevronRight size={24} />
            </button>
            <button
              onClick={nextStep}
              className="flex-1 py-3 bg-brand text-white rounded-xl font-bold text-base hover:bg-brand-dark transition-colors flex items-center justify-center gap-2"
            >
              {currentStep === TOUR_STEPS.length - 1 ? 'ابدأ العمل 🎉' : 'التالي'}
              {currentStep !== TOUR_STEPS.length - 1 && <ChevronLeft size={20} />}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
