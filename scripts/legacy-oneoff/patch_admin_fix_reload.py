import os

with open("src/components/AdminTailors.tsx", "r") as f:
    content = f.read()

target = """                      for (const t of tenantsToFix) {
                        await supabase.from('tenants').update({ plan_id: 'free' }).eq('id', t.id);
                      }
                      setToast({ message: 'تم إصلاح الباقات بنجاح', type: 'success' });
                      fetchTenants();
                    } catch (e) {"""

replacement = """                      for (const t of tenantsToFix) {
                        await supabase.from('tenants').update({ plan_id: 'free' }).eq('id', t.id);
                      }
                      setToast({ message: 'تم إصلاح الباقات بنجاح', type: 'success' });
                      setTenants(prev => prev.map(t => tenantsToFix.find(tf => tf.id === t.id) ? { ...t, planId: 'free' } : t));
                    } catch (e) {"""

content = content.replace(target, replacement)

with open("src/components/AdminTailors.tsx", "w") as f:
    f.write(content)
