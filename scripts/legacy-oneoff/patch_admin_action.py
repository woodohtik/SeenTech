import os

with open("src/components/AdminTailors.tsx", "r") as f:
    content = f.read()

target = """            <div className="flex gap-2">
              <button className="px-6 py-3 bg-surface-muted border border-border rounded-2xl font-bold text-sm flex items-center gap-2 hover:bg-border transition-all">"""

replacement = """            <div className="flex gap-2">
              {tenants.filter(t => t.planId === 'basic' && new Date(t.createdAt).getTime() > Date.now() - 14 * 24 * 60 * 60 * 1000).length > 0 && (
                <button
                  onClick={async () => {
                    const tenantsToFix = tenants.filter(t => t.planId === 'basic' && new Date(t.createdAt).getTime() > Date.now() - 14 * 24 * 60 * 60 * 1000);
                    if (tenantsToFix.length === 0) return;
                    if (!window.confirm(`تم العثور على ${tenantsToFix.length} حسابات ببيانات "باقة أساسية" غير صحيحة. هل ترغب في إصلاحها إلى تجربة مجانية؟`)) return;
                    try {
                      for (const t of tenantsToFix) {
                        await supabase.from('tenants').update({ plan_id: 'free' }).eq('id', t.id);
                      }
                      setToast({ message: 'تم إصلاح الباقات بنجاح', type: 'success' });
                      fetchTenants();
                    } catch (e) {
                      console.error(e);
                      setToast({ message: 'حدث خطأ أثناء التحديث', type: 'error' });
                    }
                  }}
                  className="px-6 py-3 bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-2xl font-bold text-sm flex items-center gap-2 hover:bg-indigo-200 transition-all"
                >
                  <Crown size={18} />
                  إصلاح تجارب الحسابات الجديدة
                </button>
              )}
              <button className="px-6 py-3 bg-surface-muted border border-border rounded-2xl font-bold text-sm flex items-center gap-2 hover:bg-border transition-all">"""

content = content.replace(target, replacement)

with open("src/components/AdminTailors.tsx", "w") as f:
    f.write(content)
