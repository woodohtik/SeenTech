import { useEffect, useState } from 'react';

/**
 * مراجعة-الفريق-التقني-الكامل-2026-10-19.md (أداء، متوسطة): لا توجد أي أداة
 * debounce في المشروع كله -- مربعات البحث في Suppliers/Customers/Orders
 * كانت تُعيد تصفية/جلب البيانات عند كل حرف يُكتَب، وبما أن مصادر هذه
 * البيانات غالباً غير مُرقَّمة الصفحات (انظر نفس المراجعة، بند الأداء)،
 * كل حرف يُشغِّل إعادة فلترة مصفوفة كاملة بلا داعٍ.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
