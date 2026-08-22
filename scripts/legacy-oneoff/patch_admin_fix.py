import os

with open("src/components/AdminTailors.tsx", "r") as f:
    content = f.read()

target = """                <button 
                  onClick={() => setSelectedTenant(null)}"""

replacement = """                <button
                  onClick={async () => {
                    const tenantsToFix = tenants.filter(t => t.planId === 'basic');
                    if (tenantsToFix.length === 0) return;
                    if (!window.confirm(`Found ${tenantsToFix.length} tenants with basic plan. Fix them to free trial?`)) return;
                    try {
                      for (const t of tenantsToFix) {
                        await supabase.from('tenants').update({ plan_id: 'free' }).eq('id', t.id);
                      }
                      setToast({ message: 'تم التحديث بنجاح', type: 'success' });
                      fetchTenants();
                    } catch (e) {
                      console.error(e);
                    }
                  }}
                  className="px-3 py-1 mr-4 bg-brand text-white rounded hover:bg-brand-dark font-bold text-xs"
                >
                  إصلاح الباقات الأساسية
                </button>
                <button 
                  onClick={() => setSelectedTenant(null)}"""

content = content.replace(target, replacement)

with open("src/components/AdminTailors.tsx", "w") as f:
    f.write(content)
