import os

with open("src/components/GuidedFirstOrder.tsx", "r") as f:
    content = f.read()

import_auth = "import { useAuth } from '../contexts/AuthContext';\n"
if "useAuth" not in content:
    content = content.replace("import { useNavigate } from 'react-router-dom';", "import { useNavigate } from 'react-router-dom';\n" + import_auth)

target_hook = "const navigate = useNavigate();"
replacement_hook = "const navigate = useNavigate();\n  const { userRole } = useAuth();\n  const [dismissed, setDismissed] = useState(localStorage.getItem('staff_tutorial_dismissed') === 'true');"

if "useAuth()" not in content:
    content = content.replace(target_hook, replacement_hook)

target_render = "if (!loaded) return null;"
replacement_render = """if (!loaded) return null;
  
  if (userRole === 'staff') {
    if (dismissed) return null;
    return (
      <div dir="rtl" className="w-full bg-surface border border-border rounded-2xl p-4 sm:p-5 mb-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="font-bold text-base sm:text-lg text-content">
            دليل استخدام النظام السريع
          </div>
        </div>
        <div className="text-sm text-content-muted mb-4 space-y-2">
          <p>أهلاً بك! إليك خطوات سريعة للبدء:</p>
          <ul className="list-disc list-inside">
            <li><strong>اختيار العميل:</strong> قم بالبحث أو إضافة عميل جديد من نقطة البيع.</li>
            <li><strong>إضافة المنتجات:</strong> اختر الخدمات المطلوبة.</li>
            <li><strong>إتمام الدفع:</strong> راجع السلة واضغط الدفع لإصدار الفاتورة.</li>
          </ul>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate('/sales')}
            className="flex-1 min-h-[48px] px-6 rounded-xl text-white font-extrabold text-sm sm:text-base active:scale-[0.98] transition-transform bg-brand hover:bg-brand-dark">
            ابدأ العمل
          </button>
          <button onClick={() => {
              localStorage.setItem('staff_tutorial_dismissed', 'true');
              setDismissed(true);
            }}
            className="flex-1 min-h-[48px] px-6 rounded-xl text-content-muted bg-surface-muted font-bold text-sm sm:text-base hover:bg-border transition-colors">
            تخطي
          </button>
        </div>
      </div>
    );
  }"""

if "if (userRole === 'staff')" not in content:
    content = content.replace(target_render, replacement_render)

with open("src/components/GuidedFirstOrder.tsx", "w") as f:
    f.write(content)
