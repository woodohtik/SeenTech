import React from 'react';
import { Sun, Moon, Palette, Zap, Check } from 'lucide-react';
import { useTheme, ThemeType } from '../contexts/ThemeContext';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';

const ThemeSwitcher: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  const themes: { id: ThemeType; name: string; icon: any; color: string; iconColor: string }[] = [
    { id: 'light', name: t('themes.light', 'Light'), icon: Sun, color: 'bg-white border border-border', iconColor: 'text-warning' },
    { id: 'dark', name: t('themes.dark', 'Dark'), icon: Moon, color: 'bg-slate-900', iconColor: 'text-info' },
    { id: 'elegant', name: t('themes.elegant', 'Elegant'), icon: Palette, color: 'bg-[#F5F2ED]', iconColor: 'text-brand' },
    { id: 'modern', name: t('themes.modern', 'Modern'), icon: Zap, color: 'bg-zinc-800', iconColor: 'text-brand' },
  ];

  return (
    <div className="p-4">
      <h3 className="text-[10px] font-black text-content-muted uppercase tracking-wider mb-4 px-2">
        {t('settings.appearance', 'Appearance')}
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {themes.map((themeItem) => (
          <button
            key={themeItem.id}
            onClick={() => setTheme(themeItem.id)}
            className={cn(
              "relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all duration-200 group",
              theme === themeItem.id 
                ? "border-brand bg-brand/5" 
                : "border-border hover:border-brand/30 bg-surface"
            )}
          >
            <div className={cn(
              "w-8 h-8 rounded-xl flex items-center justify-center mb-2 transition-transform duration-200 group-hover:scale-110",
              themeItem.color,
              theme === themeItem.id ? "ring-2 ring-brand ring-offset-2 ring-offset-surface" : "shadow-sm border border-border/50"
            )}>
              <themeItem.icon className={cn(
                "w-4 h-4",
                themeItem.iconColor
              )} />
            </div>
            <span className="text-xs font-black text-content">{themeItem.name}</span>
            
            {theme === themeItem.id && (
              <motion.div 
                layoutId="active-theme"
                className="absolute top-1.5 right-1.5"
              >
                <div className="bg-brand rounded-full p-0.5 shadow-sm">
                  <Check className="w-2.5 h-2.5 text-white" strokeWidth={4} />
                </div>
              </motion.div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ThemeSwitcher;
