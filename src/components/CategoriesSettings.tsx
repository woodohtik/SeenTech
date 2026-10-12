import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tag, Truck, Plus, ChevronUp, ChevronDown, Eye, EyeOff, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useDirection } from '../lib/direction';
import { useToast } from '../contexts/ToastContext';
import { useVerticalConfig } from '../hooks/useVerticalConfig';
import {
  listCategories,
  addCategory,
  setCategoryHidden,
  swapCategoryOrder,
  LEGACY_INVENTORY_CATEGORY_SEED,
  LEGACY_SUPPLIER_CATEGORY_SEED,
  type TenantCategory,
  type CategoryScope,
} from '../services/categoryService';

interface CategoriesSettingsProps {
  tenantId: string;
}

/**
 * إدارة فئات المخزون والموردين لكل مستأجر (seen-ux-fixes-batch-task.md #9).
 * تحل محل القائمة الثابتة السابقة -- كل تاجر يضيف/يخفي/يرتّب فئاته الخاصة،
 * بلا حاجة لمطوّر يضيف قيمة جديدة في الكود لكل طلب.
 */
export default function CategoriesSettings({ tenantId }: CategoriesSettingsProps) {
  const { t } = useTranslation();
  const { dir } = useDirection();
  const { success: toastSuccess, handleError } = useToast();
  const { inventoryCategories, isLegacyVertical } = useVerticalConfig();

  return (
    <div className="space-y-6 w-full">
      <CategorySection
        scope="inventory"
        tenantId={tenantId}
        icon={Tag}
        title={t('settings_page.categories.inventory_title', 'فئات المخزون')}
        subtitle={t('settings_page.categories.inventory_subtitle', 'تظهر هذه الفئات في نماذج إضافة/تعديل عناصر المخزون')}
        seed={isLegacyVertical ? LEGACY_INVENTORY_CATEGORY_SEED : inventoryCategories.map((c) => ({ category_key: c.category_key, label_ar: c.label_ar }))}
        onToast={toastSuccess}
        onError={handleError}
        dir={dir}
      />
      <CategorySection
        scope="supplier"
        tenantId={tenantId}
        icon={Truck}
        title={t('settings_page.categories.supplier_title', 'فئات الموردين')}
        subtitle={t('settings_page.categories.supplier_subtitle', 'تظهر هذه الفئات في نماذج إضافة/تعديل الموردين')}
        seed={LEGACY_SUPPLIER_CATEGORY_SEED}
        onToast={toastSuccess}
        onError={handleError}
        dir={dir}
      />
    </div>
  );
}

function CategorySection({
  scope,
  tenantId,
  icon: Icon,
  title,
  subtitle,
  seed,
  onToast,
  onError,
  dir,
}: {
  scope: CategoryScope;
  tenantId: string;
  icon: any;
  title: string;
  subtitle: string;
  seed: { category_key: string; label_ar: string }[];
  onToast: (msg: string) => void;
  onError: (err: unknown) => void;
  dir: 'rtl' | 'ltr';
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ['tenant-categories', tenantId, scope];
  const { data: categories = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => listCategories(tenantId, scope, seed),
    enabled: !!tenantId && seed.length > 0,
  });

  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const handleAdd = async () => {
    if (!newLabel.trim()) return;
    setSavingId('new');
    try {
      await addCategory(tenantId, scope, newLabel.trim(), categories);
      setNewLabel('');
      setAdding(false);
      refresh();
      onToast(t('settings_page.categories.added_success', 'تمت إضافة الفئة'));
    } catch (err) {
      onError(err);
    } finally {
      setSavingId(null);
    }
  };

  const handleToggleHidden = async (cat: TenantCategory) => {
    setSavingId(cat.id);
    try {
      await setCategoryHidden(cat.id, !cat.is_hidden);
      refresh();
    } catch (err) {
      onError(err);
    } finally {
      setSavingId(null);
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= categories.length) return;
    setSavingId(categories[index].id);
    try {
      await swapCategoryOrder(categories[index], categories[targetIndex]);
      refresh();
    } catch (err) {
      onError(err);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="bg-surface p-4 sm:p-6 lg:p-8 rounded-2xl lg:rounded-3xl border border-border shadow-xl shadow-brand/5 space-y-5 w-full">
      <div className={cn('flex items-center gap-3 border-b border-border pb-5', dir === 'rtl' ? 'text-right' : 'text-left')}>
        <div className="p-3 bg-brand/10 text-brand rounded-2xl shadow-inner shrink-0">
          <Icon size={24} />
        </div>
        <div>
          <h3 className="text-lg sm:text-xl font-black text-content">{title}</h3>
          <p className="text-xs sm:text-sm text-content-muted font-medium mt-0.5">{subtitle}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-content-muted">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map((cat, index) => (
            <div
              key={cat.id}
              className={cn(
                'flex items-center justify-between gap-3 p-3 rounded-xl border transition-colors',
                cat.is_hidden ? 'border-border bg-surface-muted/30 opacity-60' : 'border-border bg-surface-muted/50'
              )}
            >
              <span className="font-bold text-content truncate">{cat.label_ar}</span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleMove(index, -1)}
                  disabled={index === 0 || savingId === cat.id}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-content-muted hover:text-content hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label={t('common.move_up', 'تحريك للأعلى')}
                >
                  <ChevronUp size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => handleMove(index, 1)}
                  disabled={index === categories.length - 1 || savingId === cat.id}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-content-muted hover:text-content hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label={t('common.move_down', 'تحريك للأسفل')}
                >
                  <ChevronDown size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleHidden(cat)}
                  disabled={savingId === cat.id}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-content-muted hover:text-content hover:bg-surface disabled:opacity-30"
                  aria-label={cat.is_hidden ? t('common.show', 'إظهار') : t('common.hide', 'إخفاء')}
                  title={cat.is_hidden ? t('settings_page.categories.hidden_hint', 'مخفاة -- لن تظهر في قوائم الاختيار الجديدة') : undefined}
                >
                  {cat.is_hidden ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
          ))}

          {adding ? (
            <div className="flex items-center gap-2 p-3 rounded-xl border-2 border-brand/40 bg-brand/5">
              <input
                autoFocus
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setAdding(false); setNewLabel(''); } }}
                placeholder={t('settings_page.categories.new_name_placeholder', 'اسم الفئة الجديدة')}
                className="flex-1 bg-transparent outline-none font-bold text-content placeholder:text-content-muted/60"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={!newLabel.trim() || savingId === 'new'}
                className="min-h-[36px] px-4 rounded-lg bg-brand text-white font-bold text-sm disabled:opacity-50"
              >
                {savingId === 'new' ? <Loader2 size={16} className="animate-spin" /> : t('common.add', 'إضافة')}
              </button>
              <button
                type="button"
                onClick={() => { setAdding(false); setNewLabel(''); }}
                className="min-h-[36px] px-3 rounded-lg text-content-muted font-bold text-sm hover:bg-surface"
              >
                {t('common.cancel', 'إلغاء')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed border-border text-content-muted font-bold hover:border-brand/40 hover:text-brand transition-colors min-h-[44px]"
            >
              <Plus size={18} />
              {t('settings_page.categories.add_new', 'إضافة فئة جديدة')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
