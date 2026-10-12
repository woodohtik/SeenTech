import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listCategories,
  visibleCategories,
  addCategory,
  type CategoryScope,
  type CategorySeed,
} from '../services/categoryService';

/** قيمة خاصة لعنصر "+ إضافة فئة جديدة" في نهاية قائمة الاختيار -- ليست category_key حقيقية. */
export const ADD_NEW_CATEGORY_VALUE = '__add_new_category__';

/**
 * يغذّي قوائم اختيار الفئة في نماذج المخزون/الموردين بفئات المستأجر القابلة
 * للتخصيص (seen-ux-fixes-batch-task.md #9)، ويدير حالة إضافة فئة جديدة
 * مباشرة من النموذج (بدل خيار "أخرى" الثابت السابق).
 */
export function useTenantCategoryPicker(tenantId: string, scope: CategoryScope, seed: CategorySeed[]) {
  const queryClient = useQueryClient();
  const queryKey = ['tenant-categories', tenantId, scope];
  const { data: categories = [] } = useQuery({
    queryKey,
    queryFn: () => listCategories(tenantId, scope, seed),
    enabled: !!tenantId && seed.length > 0,
  });

  const options = useMemo(
    () => visibleCategories(categories).map((c) => ({ value: c.category_key, label: c.label_ar })),
    [categories],
  );

  const [addingNew, setAddingNew] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const cancelAdd = () => {
    setAddingNew(false);
    setNewLabel('');
  };

  const confirmAdd = async (onCreated: (categoryKey: string) => void) => {
    if (!newLabel.trim()) return;
    setSaving(true);
    try {
      const created = await addCategory(tenantId, scope, newLabel.trim(), categories);
      await queryClient.invalidateQueries({ queryKey });
      onCreated(created.category_key);
      cancelAdd();
    } finally {
      setSaving(false);
    }
  };

  return { options, addingNew, setAddingNew, newLabel, setNewLabel, saving, confirmAdd, cancelAdd };
}
