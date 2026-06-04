import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  UserCircle, 
  Settings, 
  Lock, 
  LogOut, 
  Globe, 
  Sun, 
  Moon, 
  LayoutGrid, 
  Maximize2, 
  Minimize2, 
  Sparkles, 
  Compass, 
  Monitor, 
  ChevronDown,
  Scaling
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme, ThemeType } from '../contexts/ThemeContext';
import { Staff } from '../types';
import { cn } from '../lib/utils';

interface UserPreferencesMenuProps {
  currentStaff: Staff | null;
  role: string | null;
  onLock: () => void;
  onLogout: () => void;
  layoutMode: 'sidebar' | 'grid';
  onToggleLayout?: () => void;
  className?: string;
  isCollapsed?: boolean;
  dropdownPosition?: 'top' | 'bottom';
}

export default function UserPreferencesMenu({
  currentStaff,
  role,
  onLock,
  onLogout,
  layoutMode,
  onToggleLayout,
  className,
  isCollapsed = false,
  dropdownPosition
}: UserPreferencesMenuProps) {
  const { t, i18n } = useState({ t: (s: string, def?: string) => def || s, i18n: { language: 'ar', changeLanguage: (l: string) => {} } }) && { t: useTranslation().t, i18n: useTranslation().i18n };
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [density, setDensity] = useState<'comfortable' | 'compact'>(() => {
    return (localStorage.getItem('app-density') as 'comfortable' | 'compact') || 'comfortable';
  });

  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';

  // Determine dynamic alignment to prevent clipping when direction is LTR
  let alignmentClass = '';
  if (layoutMode === 'sidebar') {
    alignmentClass = isRtl ? 'right-0' : 'left-0';
  } else {
    // grid mode
    alignmentClass = isRtl ? 'left-0' : 'right-0';
  }

  const menuRef = useRef<HTMLDivElement>(null);

  // Apply global density mode
  useEffect(() => {
    const root = window.document.documentElement;
    if (density === 'compact') {
      root.classList.add('compact-mode');
    } else {
      root.classList.remove('compact-mode');
    }
    localStorage.setItem('app-density', density);
  }, [density]);

  // Click outside to close menu
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLanguageToggle = () => {
    const langs = ['ar', 'en', 'ur'];
    const currentIndex = langs.indexOf(i18n.language || 'ar');
    const nextIndex = (currentIndex + 1) % langs.length;
    const nextLang = langs[nextIndex];
    i18n.changeLanguage(nextLang);
    document.documentElement.dir = (nextLang === 'ar' || nextLang === 'ur') ? 'rtl' : 'ltr';
    document.documentElement.lang = nextLang;
  };

  const handleDensityToggle = () => {
    setDensity(prev => prev === 'comfortable' ? 'compact' : 'comfortable');
  };

  const handleThemeToggle = () => {
    const themes: ThemeType[] = ['light', 'dark', 'elegant', 'modern'];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  const getThemeLabel = (themeVal: string) => {
    switch (themeVal) {
      case 'light': return t('common.theme_light', 'فاتح');
      case 'dark': return t('common.theme_dark', 'داكن');
      case 'elegant': return t('common.theme_elegant', 'كلاسيكي');
      case 'modern': return t('common.theme_modern', 'عصري');
      default: return themeVal;
    }
  };

  return (
    <div className={cn("relative select-none", className)} ref={menuRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full rounded-2xl flex items-center gap-3 transition-all active:scale-98 bg-brand/5 border border-brand/10 hover:bg-brand/10 text-content cursor-pointer focus:outline-none",
          isCollapsed ? "justify-center p-2" : "p-3"
        )}
      >
        <div className="w-10 h-10 rounded-xl bg-surface shadow-sm flex items-center justify-center text-brand shrink-0 border border-brand/10">
          <UserCircle size={24} />
        </div>
        
        {!isCollapsed && (
          <>
            <div className={cn("flex flex-col flex-1 truncate", isRtl ? "text-right" : "text-left")}>
              <span className="text-sm font-black text-content truncate">
                {currentStaff?.name || t('common.system_user', 'مستخدم النظام')}
              </span>
              <span className="text-[10px] font-bold text-brand uppercase tracking-widest mt-0.5">
                {currentStaff?.role === 'owner' 
                  ? t('common.roles.owner', 'مالك') 
                  : currentStaff?.role === 'cashier' 
                    ? t('common.roles.cashier', 'كاشير') 
                    : t('common.roles.tailor', 'خياط')}
              </span>
            </div>
            <ChevronDown size={16} className={cn("text-content-muted transition-transform duration-300", isOpen && "rotate-180")} />
          </>
        )}
      </button>

      {/* Floating Menu Popover */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.95 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={cn(
              "absolute z-[150] w-72 bg-surface border border-border rounded-3xl shadow-2xl p-4 flex flex-col gap-1.5",
              (dropdownPosition === 'bottom' || (dropdownPosition === undefined && layoutMode === 'grid'))
                ? "top-full mt-2" 
                : "bottom-full mb-3",
              alignmentClass
            )}
          >
            {/* Context Header */}
            <div className="px-3 py-2 border-b border-border mb-1.5">
              <p className="text-xs font-black text-content-muted uppercase tracking-widest">{t('common.user_preferences', 'تفضيلات المستخدم والسرية')}</p>
            </div>

            {/* Menu Items */}
            
            {/* 1. View Mode (Density Toggle) */}
            <button
              onClick={handleDensityToggle}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-muted text-content-muted hover:text-content text-sm transition-all cursor-pointer focus:outline-none w-full",
                isRtl ? "text-right" : "text-left"
              )}
            >
              <Scaling size={18} className="text-brand" />
              <div className={cn("flex-1 flex flex-col", isRtl ? "text-right" : "text-left")}>
                <span className="font-bold">{t('common.view_density', 'طريقة العرض')}</span>
                <span className="text-[10px] text-content-muted">
                  {density === 'compact' ? t('common.compact', 'مكثف ومضغوط') : t('common.comfortable', 'مريح وفضفاض')}
                </span>
              </div>
            </button>

            {/* 2. Language Switcher - Direct Picker */}
            <div className="flex flex-col gap-1 p-2 bg-surface-muted/60 rounded-2xl border border-border/80">
              <div className="flex items-center gap-2 px-2 pb-1 text-xs font-black text-content-muted">
                <Globe size={14} className="text-brand" />
                <span>{t('common.language', 'لغة الواجهة')}</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
                  { code: 'en', label: 'English', flag: '🇺🇸' },
                  { code: 'ur', label: 'اردو', flag: '🇵🇰' }
                ].map((lang) => {
                  const isActive = (i18n.language || 'ar').startsWith(lang.code);
                  return (
                    <button
                      key={lang.code}
                      onClick={() => {
                        i18n.changeLanguage(lang.code);
                        document.documentElement.dir = (lang.code === 'ar' || lang.code === 'ur') ? 'rtl' : 'ltr';
                        document.documentElement.lang = lang.code;
                      }}
                      className={cn(
                        "flex flex-col items-center justify-center p-1.5 rounded-xl text-[11px] font-black transition-all cursor-pointer border",
                        isActive 
                          ? "bg-brand text-white border-brand shadow-sm" 
                          : "bg-surface hover:bg-brand/5 text-content-muted hover:text-content border-border/60 hover:border-brand/40"
                      )}
                    >
                      <span className="text-base mb-0.5" role="img" aria-label={lang.label}>{lang.flag}</span>
                      <span>{lang.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Theme Mode */}
            <button
              onClick={handleThemeToggle}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-muted text-content-muted hover:text-content text-sm transition-all cursor-pointer focus:outline-none w-full",
                isRtl ? "text-right" : "text-left"
              )}
            >
              {theme === 'dark' ? (
                <Moon size={18} className="text-brand" />
              ) : (
                <Sun size={18} className="text-brand" />
              )}
              <div className={cn("flex-1 flex flex-col", isRtl ? "text-right" : "text-left")}>
                <span className="font-bold">{t('common.theme_mode', 'مظهر الواجهة')}</span>
                <span className="text-[10px] text-content-muted">
                  {getThemeLabel(theme)}
                </span>
              </div>
            </button>

            {/* Optional Layout mode Grid vs Sidebar button if offered */}
            {onToggleLayout && (
              <button
                onClick={() => {
                  onToggleLayout();
                  setIsOpen(false);
                }}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-muted text-content-muted hover:text-content text-sm transition-all cursor-pointer focus:outline-none w-full",
                  isRtl ? "text-right" : "text-left"
                )}
              >
                <LayoutGrid size={18} className="text-brand" />
                <div className={cn("flex-1 flex flex-col", isRtl ? "text-right" : "text-left")}>
                  <span className="font-bold">{t('common.navigation_style', 'نمط التنقل')}</span>
                  <span className="text-[10px] text-content-muted">
                    {layoutMode === 'grid' ? t('common.layout_grid', 'شبكة لوحة القيادة') : t('common.layout_sidebar', 'شريط جانبي')}
                  </span>
                </div>
              </button>
            )}

            <div className="h-px bg-border my-1" />

            {/* 4. Lock Screen */}
            <button
              onClick={() => {
                setIsOpen(false);
                onLock();
              }}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-brand/5 text-brand hover:text-brand-dark text-sm font-bold transition-all cursor-pointer focus:outline-none w-full",
                isRtl ? "text-right" : "text-left"
              )}
            >
              <Lock size={18} />
              <div className={cn("flex-1 flex flex-col", isRtl ? "text-right" : "text-left")}>
                <span>{t('common.lock_screen', 'قفل الشاشة مؤقتاً')}</span>
                <span className="text-[9px] font-bold opacity-80 uppercase tracking-widest">{t('common.lock_desc', 'SCREEN LOCK')}</span>
              </div>
            </button>

            {/* 5. Log Out */}
            <button
              onClick={() => {
                setIsOpen(false);
                onLogout();
              }}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-500/5 text-red-500 hover:text-red-600 text-sm font-bold transition-all cursor-pointer focus:outline-none w-full",
                isRtl ? "text-right" : "text-left"
              )}
            >
              <LogOut size={18} />
              <div className={cn("flex-1 flex flex-col", isRtl ? "text-right" : "text-left")}>
                <span>{t('common.logout_account', 'تسجيل خروج آمن')}</span>
                <span className="text-[9px] font-bold opacity-80 uppercase tracking-widest">{t('common.logout_desc', 'LOG OUT')}</span>
              </div>
            </button>

          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
