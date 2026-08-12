import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, ShoppingCart, Ruler, CheckCircle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDirection } from '../lib/direction';

const INSTRUCTIONS = [
  {
    id: 'customer',
    titleKey: 'pos.add_new_customer',
    icon: Users,
    contentKey: 'usage_guide.customer.content',
    actionLink: '/sales',
    actionTextKey: 'usage_guide.customer.action',
    color: 'text-blue-600',
    bg: 'bg-blue-100'
  },
  {
    id: 'measurements',
    titleKey: 'usage_guide.measurements.title',
    icon: Ruler,
    contentKey: 'usage_guide.measurements.content',
    actionLink: '/customers',
    actionTextKey: 'usage_guide.measurements.action',
    color: 'text-amber-600',
    bg: 'bg-amber-100'
  },
  {
    id: 'order',
    titleKey: 'usage_guide.order.title',
    icon: ShoppingCart,
    contentKey: 'usage_guide.order.content',
    actionLink: '/sales',
    actionTextKey: 'usage_guide.order.action',
    color: 'text-emerald-600',
    bg: 'bg-emerald-100'
  }
];

interface UsageGuideProps {
  onSkip: () => void;
}

export default function UsageGuide({ onSkip }: UsageGuideProps) {
  const { t, dir, isRtl } = useDirection();
  const [expandedId, setExpandedId] = useState<string | null>(INSTRUCTIONS[0].id);
  const navigate = useNavigate();

  return (
    <div dir={dir} className="w-full bg-surface border border-border rounded-3xl p-4 sm:p-6 mb-6 shadow-sm">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
            <CheckCircle size={24} />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-black text-content">{t('usage_guide.title')}</h2>
            <p className="text-sm text-content-muted mt-1">{t('usage_guide.subtitle')}</p>
          </div>
        </div>
        <button 
          onClick={onSkip}
          className="flex items-center gap-1.5 px-4 py-2 bg-surface-muted text-content-muted font-bold rounded-xl hover:bg-border transition-colors text-sm"
        >
          <X size={16} />
          {t('usage_guide.skip')}
        </button>
      </div>

      <div className="space-y-3">
        {INSTRUCTIONS.map((inst, index) => {
          const isExpanded = expandedId === inst.id;
          const Icon = inst.icon;
          return (
            <div 
              key={inst.id} 
              className={`border rounded-2xl overflow-hidden transition-all duration-300 ${isExpanded ? 'border-brand/30 shadow-sm bg-brand/5' : 'border-border bg-surface'}`}
            >
              <button
                onClick={() => setExpandedId(isExpanded ? null : inst.id)}
                className={`w-full flex items-center justify-between p-4 ${isRtl ? 'text-right' : 'text-left'}`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${inst.bg} ${inst.color}`}>
                    <Icon size={20} />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-content-muted mb-1 block">{t('usage_guide.step', { number: index + 1 })}</span>
                    <span className="font-bold text-content text-base sm:text-lg">{t(inst.titleKey)}</span>
                  </div>
                </div>
                <div className="text-content-muted bg-surface-muted p-2 rounded-full shrink-0">
                  {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </div>
              </button>
              
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-5 pt-2 sm:px-18 sm:ms-14">
                      <p className="text-content leading-relaxed mb-4 text-sm sm:text-base">
                        {t(inst.contentKey)}
                      </p>
                      <button 
                        onClick={() => navigate(inst.actionLink)}
                        className="inline-flex items-center justify-center px-6 py-2.5 bg-surface border border-border rounded-xl font-bold text-content hover:bg-surface-muted hover:border-content-muted/30 transition-all text-sm shadow-sm"
                      >
                        {t(inst.actionTextKey)}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
