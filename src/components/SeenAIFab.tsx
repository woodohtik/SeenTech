import React, { useState } from 'react';
import { Bot, Sparkles, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useDirection } from '../lib/direction';

export default function SeenAIFab() {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useTranslation();
  const { dir, isRtl } = useDirection();

  return (
    <>
      <div id="tour-ai-fab" data-tour="ai-fab" className={`fixed bottom-6 ${isRtl ? 'left-6' : 'right-6'} z-50 flex flex-col items-center gap-2`}>
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 1 }}
          className="bg-brand text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-md relative"
        >
          {t('common.coming_soon')}
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-brand rotate-45" />
        </motion.div>
        
        <button
          onClick={() => setIsOpen(true)}
          className="w-14 h-14 bg-brand rounded-2xl shadow-lg flex items-center justify-center text-white hover:shadow-xl hover:scale-105 transition-all relative group"
        >
          <Sparkles className="absolute top-2 right-2 w-3 h-3 text-white/70 opacity-0 group-hover:opacity-100 transition-opacity" />
          <Bot size={28} />
        </button>
      </div>

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" dir={dir}>
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-surface w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden relative border border-border flex flex-col"
            >
              <div className="p-4 border-b border-border flex justify-between items-center bg-brand/5 dark:bg-brand/10">
                <h2 className="text-lg font-bold text-content flex items-center gap-2">
                  <Bot className="text-brand" /> SeenAI
                </h2>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 hover:bg-black/5 rounded-full text-content-muted transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="p-8 flex flex-col items-center text-center space-y-4">
                <div className="w-20 h-20 bg-brand/10 rounded-full flex items-center justify-center mb-2">
                  <Bot size={40} className="text-brand" />
                </div>
                <h3 className="text-xl font-bold text-content">{t('ai.assistant_title')}</h3>
                <p className="text-content-muted leading-relaxed">
                  {t('ai.coming_soon_desc')}
                </p>
                <button
                  onClick={() => setIsOpen(false)}
                  className="mt-4 px-6 py-2.5 bg-surface-muted text-content font-bold rounded-xl hover:bg-border transition-colors w-full"
                >
                  {t('ai.ok_waiting')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
