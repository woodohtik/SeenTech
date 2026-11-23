import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Scissors, Shirt, Sofa } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * The login screen's animated brand-panel decoration (large screens only):
 * the dashed "stitch" path and the three floating business badges, moved
 * verbatim from Login.tsx. Loaded lazily so the motion library is not on the
 * login screen's startup path (seen-performance-first-open-login-task.md
 * Phase 2.4); the panel, its colour and its title draw without it.
 */
export default function LoginHeroDecor() {
  const { t } = useTranslation();
  const [hoveredVertical, setHoveredVertical] = useState<null | 'clothing' | 'tailoring' | 'upholstery'>(null);
  return (
    <>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <motion.path
          d="M 15 15 L 84 21 Q 95 95 21 84 L 15 15"
          fill="none"
          stroke="white"
          strokeOpacity={0.35}
          strokeWidth={0.4}
          strokeDasharray="2 2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1, strokeDashoffset: [0, -8] }}
          transition={{
            pathLength: { duration: 1.5, ease: 'easeOut' },
            strokeDashoffset: { duration: 3, repeat: Infinity, ease: 'linear', delay: 1.5 },
          }}
        />
      </svg>

      <div className="absolute top-[10%] left-[10%] flex flex-col items-center gap-2">
        <motion.div
          animate={{ y: [0, -14, 0] }}
          whileHover={{ scale: 1.15, rotate: -6, transition: { duration: 0.2 } }}
          onHoverStart={() => setHoveredVertical('clothing')}
          onHoverEnd={() => setHoveredVertical(null)}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          className={cn(
            "w-24 h-24 bg-white/15 backdrop-blur-xl rounded-3xl border border-white/30 flex items-center justify-center shadow-2xl cursor-pointer transition-shadow duration-300",
            hoveredVertical === 'clothing' && "shadow-[0_0_30px_rgba(255,255,255,0.4)]"
          )}
        >
          <Shirt size={40} strokeWidth={1.75} className="text-white" />
        </motion.div>
        <motion.span
          animate={{ opacity: hoveredVertical === 'clothing' ? 1 : 0, y: hoveredVertical === 'clothing' ? 0 : 4 }}
          transition={{ duration: 0.2 }}
          className="text-white text-sm font-bold bg-black/20 backdrop-blur-sm px-3 py-1 rounded-full whitespace-nowrap pointer-events-none"
        >
          {t('login.vertical_clothing')}
        </motion.span>
      </div>

      <div className="absolute top-[15%] right-[10%] flex flex-col items-center gap-2">
        <motion.div
          animate={{ y: [0, 14, 0] }}
          whileHover={{ scale: 1.15, rotate: 6, transition: { duration: 0.2 } }}
          onHoverStart={() => setHoveredVertical('tailoring')}
          onHoverEnd={() => setHoveredVertical(null)}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
          className={cn(
            "w-28 h-28 bg-white/15 backdrop-blur-xl rounded-3xl border border-white/30 flex items-center justify-center shadow-2xl cursor-pointer transition-shadow duration-300",
            hoveredVertical === 'tailoring' && "shadow-[0_0_30px_rgba(255,255,255,0.4)]"
          )}
        >
          <Scissors size={48} strokeWidth={1.75} className="text-white" />
        </motion.div>
        <motion.span
          animate={{ opacity: hoveredVertical === 'tailoring' ? 1 : 0, y: hoveredVertical === 'tailoring' ? 0 : 4 }}
          transition={{ duration: 0.2 }}
          className="text-white text-sm font-bold bg-black/20 backdrop-blur-sm px-3 py-1 rounded-full whitespace-nowrap pointer-events-none"
        >
          {t('login.vertical_tailoring')}
        </motion.span>
      </div>

      <div className="absolute bottom-[10%] left-[15%] flex flex-col items-center gap-2">
        <motion.div
          animate={{ y: [0, -12, 0] }}
          whileHover={{ scale: 1.15, rotate: -6, transition: { duration: 0.2 } }}
          onHoverStart={() => setHoveredVertical('upholstery')}
          onHoverEnd={() => setHoveredVertical(null)}
          transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
          className={cn(
            "w-28 h-28 bg-white/15 backdrop-blur-xl rounded-3xl border border-white/30 flex items-center justify-center shadow-2xl cursor-pointer transition-shadow duration-300",
            hoveredVertical === 'upholstery' && "shadow-[0_0_30px_rgba(255,255,255,0.4)]"
          )}
        >
          <Sofa size={48} strokeWidth={1.75} className="text-white" />
        </motion.div>
        <motion.span
          animate={{ opacity: hoveredVertical === 'upholstery' ? 1 : 0, y: hoveredVertical === 'upholstery' ? 0 : 4 }}
          transition={{ duration: 0.2 }}
          className="text-white text-sm font-bold bg-black/20 backdrop-blur-sm px-3 py-1 rounded-full whitespace-nowrap pointer-events-none"
        >
          {t('login.vertical_upholstery')}
        </motion.span>
      </div>
    </>
  );
}
