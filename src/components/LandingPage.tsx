import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';

const LandingPage = () => {
  // Inject Material Symbols stylesheet
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  return (
    <div className="min-h-screen text-slate-800 antialiased selection:bg-indigo-300 selection:text-slate-900 bg-[#F5F7FA] font-sans overflow-x-hidden" dir="rtl">
      {/* TopAppBar Navigation */}
      <header className="bg-white/80 backdrop-blur-xl shadow-[0px_4px_6px_rgba(15,23,42,0.05)] fixed top-0 w-full z-50 transition-all duration-300">
        <div className="flex justify-between items-center w-full px-6 md:px-10 max-w-7xl mx-auto h-20">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-extrabold text-xl shadow-lg shadow-blue-600/20">
              س
            </span>
            <span className="font-extrabold text-2xl tracking-tight text-slate-900">سين</span>
          </div>

          <div className="hidden md:flex gap-8 items-center">
            <a href="#features" className="text-sm font-semibold text-slate-600 hover:text-blue-600 transition-colors">المميزات</a>
            <a href="#pricing" className="text-sm font-semibold text-slate-600 hover:text-blue-600 transition-colors">الباقات</a>
          </div>

          {/* Action */}
          <div className="flex gap-4 items-center">
            <Link to="/login" className="text-slate-600 font-semibold text-sm hover:text-blue-600 transition-colors">
              تسجيل الدخول
            </Link>
            <Link 
              to="/login" 
              className="bg-blue-600 text-white font-semibold text-sm px-6 py-3 rounded-lg hover:bg-blue-750 transition-all duration-300 hover:shadow-lg hover:shadow-blue-600/20 active:scale-95"
            >
              ابدأ مجاناً
            </Link>
          </div>
        </div>
      </header>

      <main className="pt-28 pb-20 overflow-hidden bg-[#F5F7FA]">
        {/* Hero Section */}
        <section className="relative max-w-7xl mx-auto px-6 md:px-10 pt-12 md:pt-20 pb-16">
          {/* Decorative Background Elements */}
          <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-blue-100/30 to-transparent rounded-bl-full blur-3xl -z-10 opacity-60"></div>
          <div className="absolute bottom-0 left-0 w-1/3 h-2/3 bg-gradient-to-tr from-slate-200/40 to-transparent rounded-tr-full blur-3xl -z-10 opacity-50"></div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Content */}
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className="flex flex-col gap-6 z-10"
            >
              <div className="inline-flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm border border-slate-200/60 w-max">
                <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                <span className="font-semibold text-xs text-slate-500">الحل الأمثل لمشاغل الخياطة</span>
              </div>
              
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-slate-900 leading-tight">
                نظام التشغيل المتكامل لقطاع <span className="text-blue-600 relative inline-block">التفصيل والخياطة
                  <svg className="absolute w-full h-3 -bottom-1 left-0 text-emerald-500/45" preserveAspectRatio="none" viewBox="0 0 100 10">
                    <path d="M0 5 Q 50 10 100 5" fill="none" stroke="currentColor" strokeWidth="4"></path>
                  </svg>
                </span>
              </h1>
              
              <p className="text-lg text-slate-600 max-w-xl leading-relaxed">
                أدر مشغلك باحترافية، من استقبال الطلبات وأخذ المقاسات حتى الفوترة الإلكترونية المعتمدة. كل ما تحتاجه في منصة واحدة سهلة الاستخدام.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 mt-4">
                <Link 
                  to="/login" 
                  className="bg-blue-600 text-white font-bold px-8 py-4 rounded-lg hover:bg-blue-700 transition-all duration-300 hover:shadow-lg hover:shadow-blue-600/30 flex items-center justify-center gap-2 active:scale-95"
                >
                  ابدأ تجربتك المجانية
                  <span className="material-symbols-outlined text-sm" data-icon="arrow_back">arrow_back</span>
                </Link>
                <a 
                  href="#features" 
                  className="bg-white text-slate-700 font-bold px-8 py-4 rounded-lg border border-slate-200 hover:border-blue-600 hover:text-blue-600 hover:bg-slate-50 transition-colors duration-300 flex items-center justify-center gap-2 active:scale-95"
                >
                  <span className="material-symbols-outlined text-sm" data-icon="play_circle">play_circle</span>
                  شاهد كيف يعمل
                </a>
              </div>

              {/* Trust Indicators */}
              <div className="mt-8 flex flex-wrap items-center gap-6 text-slate-500">
                <div className="flex items-center gap-2">
                  <div className="flex text-emerald-500">
                    <span className="material-symbols-outlined text-amber-500" data-icon="star" data-weight="fill">star</span>
                    <span className="material-symbols-outlined text-amber-500" data-icon="star" data-weight="fill">star</span>
                    <span className="material-symbols-outlined text-amber-500" data-icon="star" data-weight="fill">star</span>
                    <span className="material-symbols-outlined text-amber-500" data-icon="star" data-weight="fill">star</span>
                    <span className="material-symbols-outlined text-amber-500" data-icon="star" data-weight="fill">star</span>
                  </div>
                  <span className="font-semibold text-xs">4.9/5 تقييم العملاء</span>
                </div>
                <div className="h-4 w-px bg-slate-250 hidden sm:block"></div>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-emerald-500 text-xl" data-icon="verified_user">verified_user</span>
                  <span className="font-semibold text-xs">معتمد من هيئة الزكاة والضريبة والجمارك</span>
                </div>
              </div>
            </motion.div>

            {/* Visual Mockup - Mobile Simulator */}
            <div className="relative w-full h-[540px] flex justify-center lg:justify-end z-10 select-none">
              <div className="absolute top-10 right-20 w-32 h-32 bg-blue-650 rounded-full mix-blend-multiply filter blur-2xl opacity-20"></div>
              <div className="absolute bottom-10 left-20 w-32 h-32 bg-emerald-450 rounded-full mix-blend-multiply filter blur-2xl opacity-20"></div>
              
              <motion.div 
                initial={{ opacity: 0, rotate: 5, y: 15 }}
                animate={{ opacity: 1, rotate: 2, y: 0 }}
                whileHover={{ rotate: 0 }}
                transition={{ duration: 0.5 }}
                className="relative w-full max-w-[320px] h-full bg-white rounded-[40px] border-8 border-slate-200 shadow-2xl overflow-hidden"
              >
                {/* Simulated App UI */}
                <div className="w-full h-full bg-slate-50 flex flex-col relative">
                  {/* Status Bar */}
                  <div className="h-6 w-full flex justify-between items-center px-4 pt-3 text-slate-600">
                    <div className="text-[10px] font-bold">9:41</div>
                    <div className="flex gap-1 items-center">
                      <span className="material-symbols-outlined text-[12px]" data-icon="signal_cellular_4_bar">signal_cellular_4_bar</span>
                      <span className="material-symbols-outlined text-[12px]" data-icon="wifi">wifi</span>
                      <span className="material-symbols-outlined text-[12px]" data-icon="battery_full">battery_full</span>
                    </div>
                  </div>

                  {/* Mock App Content */}
                  <div className="flex-1 p-4 flex flex-col gap-4 overflow-hidden">
                    {/* Header */}
                    <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                      <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">م</div>
                      <div className="text-xs font-bold text-slate-800 font-sans">مشغل الأناقة</div>
                      <span className="material-symbols-outlined text-slate-400 text-lg" data-icon="notifications">notifications</span>
                    </div>

                    {/* Stats Card */}
                    <div className="bg-blue-600 text-white rounded-xl p-4 flex flex-col gap-1 shadow-lg shadow-blue-650/20 relative overflow-hidden">
                      <span className="text-[10px] opacity-80">إيرادات اليوم</span>
                      <span className="font-bold text-lg">2,450 ر.س</span>
                      <div className="flex justify-between items-end mt-2">
                        <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded-full font-semibold">+12% عن الأمس</span>
                        <span className="material-symbols-outlined text-white/50 text-3xl absolute bottom-2 left-2" data-icon="trending_up">trending_up</span>
                      </div>
                    </div>

                    {/* Recent Orders */}
                    <div className="flex flex-col gap-2">
                      <span className="font-bold text-xs text-slate-800 mb-1">الطلبات الحديثة</span>
                      
                      {/* Order Item 1 */}
                      <div className="bg-white border border-slate-100 rounded-lg p-3 flex justify-between items-center shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded bg-slate-50 flex items-center justify-center text-slate-500">
                            <span className="material-symbols-outlined text-blue-600 text-xl" data-icon="checkroom">checkroom</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="font-bold text-[11px] text-slate-800">ثوب شتوي - أحمد</span>
                            <span className="text-[9px] text-slate-500">رقم الطلب: #1042</span>
                          </div>
                        </div>
                        <span className="bg-blue-50 text-blue-600 text-[9px] px-2 py-1 rounded-full font-semibold">قيد التفصيل</span>
                      </div>

                      {/* Order Item 2 */}
                      <div className="bg-white border border-slate-100 rounded-lg p-3 flex justify-between items-center shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded bg-slate-50 flex items-center justify-center text-slate-500">
                            <span className="material-symbols-outlined text-emerald-600 text-xl" data-icon="styler">styler</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="font-bold text-[11px] text-slate-800">بشت رسمي - محمد</span>
                            <span className="text-[9px] text-slate-500">رقم الطلب: #1041</span>
                          </div>
                        </div>
                        <span className="bg-emerald-50 text-emerald-600 text-[9px] px-2 py-1 rounded-full font-semibold">جاهز للتسليم</span>
                      </div>
                    </div>
                  </div>

                  {/* Bottom Nav Mock */}
                  <div className="h-16 w-full bg-white border-t border-slate-100 flex justify-around items-center px-4 pb-2">
                    <div className="flex flex-col items-center gap-1 text-blue-600">
                      <span className="material-symbols-outlined text-lg" data-icon="home" data-weight="fill">home</span>
                      <span className="text-[8px] font-bold">الرئيسية</span>
                    </div>
                    <div className="flex flex-col items-center gap-1 text-slate-400">
                      <span className="material-symbols-outlined text-lg" data-icon="receipt_long">receipt_long</span>
                      <span className="text-[8px] font-bold">الطلبات</span>
                    </div>
                    
                    {/* FAB Mock */}
                    <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg -translate-y-4 shadow-blue-600/30">
                      <span className="material-symbols-outlined" data-icon="add">add</span>
                    </div>

                    <div className="flex flex-col items-center gap-1 text-slate-400">
                      <span className="material-symbols-outlined text-lg" data-icon="group">group</span>
                      <span className="text-[8px] font-bold">العملاء</span>
                    </div>
                    <div className="flex flex-col items-center gap-1 text-slate-400">
                      <span className="material-symbols-outlined text-lg" data-icon="settings">settings</span>
                      <span className="text-[8px] font-bold">الإعدادات</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Value Proposition Section */}
        <section id="features" className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-6 md:px-10">
            <motion.div 
              initial={{ opacity: 0, y: 35 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="text-center mb-16"
            >
              <h2 className="text-3xl font-extrabold text-slate-900 mb-4">لماذا سين؟</h2>
              <p className="text-base text-slate-500 max-w-2xl mx-auto">صممنا نظام سين خصيصاً ليلبي احتياجات مشاغل الخياطة والتفصيل، ليجمع بين سهولة الاستخدام وقوة الأداء.</p>
            </motion.div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Feature Card 1 */}
              <motion.div 
                initial={{ opacity: 0, y: 45 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
                className="bg-slate-50 rounded-2xl p-8 border border-slate-100 hover:border-blue-500/30 transition-all duration-300 group shadow-sm"
              >
                <div className="w-14 h-14 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <span className="material-symbols-outlined text-3xl text-blue-600" data-icon="dashboard">dashboard</span>
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">إدارة شاملة</h3>
                <p className="text-sm text-slate-500 leading-relaxed">تحكم كامل في دورة العمل: تتبع دقيق لكل طلب من البداية للنهاية، إدارة المقاسات لكل عميل، وتنظيم جدول العمل بذكاء لضمان التسليم في الموعد.</p>
              </motion.div>

              {/* Feature Card 2 */}
              <motion.div 
                initial={{ opacity: 0, y: 45 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
                className="bg-slate-50 rounded-2xl p-8 border border-slate-100 hover:border-blue-500/30 transition-all duration-300 group shadow-sm"
              >
                <div className="w-14 h-14 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <span className="material-symbols-outlined text-3xl text-blue-600" data-icon="receipt_long">receipt_long</span>
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">فوترة إلكترونية</h3>
                <p className="text-sm text-slate-500 leading-relaxed">فواتير متوافقة 100% مع هيئة الزكاة والدخل (فاتورة)، إصدار تلقائي عند كل عملية، وتقارير مالية دقيقة لمتابعة أرباحك ومصروفاتك بكل سهولة.</p>
              </motion.div>

              {/* Feature Card 3 */}
              <motion.div 
                initial={{ opacity: 0, y: 45 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
                className="bg-slate-50 rounded-2xl p-8 border border-slate-100 hover:border-blue-500/30 transition-all duration-300 group shadow-sm"
              >
                <div className="w-14 h-14 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <span className="material-symbols-outlined text-3xl text-blue-600" data-icon="chat">chat</span>
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">تواصل ذكي</h3>
                <p className="text-sm text-slate-500 leading-relaxed">رسائل تلقائية للعملاء عبر واتساب عند جاهزية الطلب، وتذكيرات ذكية بالمواعيد والقياسات، مما يبني علاقة قوية ومستدامة مع عملائك.</p>
              </motion.div>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section className="py-20 bg-slate-50 border-y border-slate-100/80">
          <div className="max-w-7xl mx-auto px-6 md:px-10">
            <motion.div 
              initial={{ opacity: 0, y: 35 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="text-center mb-16"
            >
              <h2 className="text-3xl font-extrabold text-slate-900 mb-4">كيف يعمل نظام سين؟</h2>
              <p className="text-base text-slate-500 max-w-2xl mx-auto">خطوات ذكية، بسيطة ومؤتمتة بالكامل تحول مشغلك من العمل التقليدي إلى الإتقان الرقمي المتكامل.</p>
            </motion.div>

            <div className="relative">
              {/* Connector line for desktop transition */}
              <div className="hidden lg:block absolute top-[45%] left-10 right-10 h-0.5 bg-gradient-to-r from-blue-100 via-blue-200 to-blue-100 -z-10"></div>
              
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                {/* Step 1 */}
                <motion.div 
                  initial={{ opacity: 0, y: 45 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
                  className="flex flex-col items-center text-center bg-white p-8 rounded-2xl border border-slate-100 shadow-sm relative group hover:shadow-md transition-shadow duration-300"
                >
                  <div className="absolute -top-5 bg-blue-600 text-white w-10 h-10 rounded-full flex items-center justify-center font-extrabold text-lg shadow-lg shadow-blue-600/30">
                    ١
                  </div>
                  <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-6 mt-2 group-hover:scale-110 transition-transform duration-300">
                    <span className="material-symbols-outlined text-4xl" data-icon="app_registration">app_registration</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-3">التسجيل وتهيئة المشغل</h3>
                  <p className="text-sm text-slate-500 leading-relaxed max-w-xs">
                    أنشئ حساب مشغلك في ثوانٍ، أضف الخياطين والمطرزين، وحدد قائمة الخدمات والملابس والأسعار المناسبة لعملائك لتبدأ الانطلاق مباشرة.
                  </p>
                </motion.div>

                {/* Step 2 */}
                <motion.div 
                  initial={{ opacity: 0, y: 45 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
                  className="flex flex-col items-center text-center bg-white p-8 rounded-2xl border border-slate-100 shadow-sm relative group hover:shadow-md transition-shadow duration-300"
                >
                  <div className="absolute -top-5 bg-blue-600 text-white w-10 h-10 rounded-full flex items-center justify-center font-extrabold text-lg shadow-lg shadow-blue-600/30">
                    ٢
                  </div>
                  <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-6 mt-2 group-hover:scale-110 transition-transform duration-300">
                    <span className="material-symbols-outlined text-4xl" data-icon="straighten">straighten</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-3">أخذ المقاسات وإدارة الطلبات</h3>
                  <p className="text-sm text-slate-500 leading-relaxed max-w-xs">
                    أدخل بيانات العميل وقم بتسجيل مقاساته وتفاصيل طلبه بدقة في محرك سين الذكي، لتصدر فاتورة إلكترونية معتمدة فوراً متوافقة مع متطلبات هيئة الزكاة.
                  </p>
                </motion.div>

                {/* Step 3 */}
                <motion.div 
                  initial={{ opacity: 0, y: 45 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
                  className="flex flex-col items-center text-center bg-white p-8 rounded-2xl border border-slate-100 shadow-sm relative group hover:shadow-md transition-shadow duration-300"
                >
                  <div className="absolute -top-5 bg-blue-600 text-white w-10 h-10 rounded-full flex items-center justify-center font-extrabold text-lg shadow-lg shadow-blue-600/30">
                    ٣
                  </div>
                  <div className="w-16 h-16 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center mb-6 mt-2 group-hover:scale-110 transition-transform duration-300">
                    <span className="material-symbols-outlined text-4xl" data-icon="checkroom">checkroom</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-3">التفصيل وجاهزية التسليم</h3>
                  <p className="text-sm text-slate-500 leading-relaxed max-w-xs">
                    راقب مراحل الطلب خطوة بخطوة بالورشة، ليتلقى العميل تلقائياً إشعارات واتساب فور تفصيله وجاهزيته، مع تنظيم مواعيد التسليم بلا أي تأخير.
                  </p>
                </motion.div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="py-20 bg-[#F5F7FA]">
          <div className="max-w-7xl mx-auto px-6 md:px-10">
            <motion.div 
              initial={{ opacity: 0, y: 35 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="text-center mb-16"
            >
              <h2 className="text-3xl font-extrabold text-slate-900 mb-4">باقات تناسب طموحك</h2>
              <p className="text-base text-slate-500 max-w-2xl mx-auto">اختر الباقة المناسبة لحجم عملك. أسعار شفافة وبدون رسوم خفية.</p>
            </motion.div>

            <div className="flex flex-col md:flex-row justify-center items-center gap-8 max-w-4xl mx-auto">
              {/* Free Trial Card */}
              <motion.div 
                initial={{ opacity: 0, x: 40 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
                className="w-full md:w-1/2 bg-white rounded-3xl p-8 border border-slate-200/60 hover:shadow-lg transition-all duration-300"
              >
                <div className="mb-8">
                  <h3 className="text-xl font-extrabold text-slate-900 mb-2">التجربة المجانية</h3>
                  <p className="text-sm text-slate-500">اكتشف مميزات النظام</p>
                </div>
                <div className="mb-8 flex items-baseline gap-2">
                  <span className="text-5xl font-extrabold text-slate-900">0</span>
                  <span className="text-slate-500 font-semibold flex items-center gap-1.5 align-baseline">
                    <span>ر.س / 14 يوم</span>
                  </span>
                </div>
                
                <ul className="flex flex-col gap-4 mb-8 text-slate-700">
                  <li className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-blue-600 text-xl" data-icon="check_circle">check_circle</span>
                    <span className="text-sm font-semibold">جميع الميزات الأساسية للإدارة</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-blue-600 text-xl" data-icon="check_circle">check_circle</span>
                    <span className="text-sm font-semibold">إضافة حتى 50 عميل و100 طلب</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-blue-600 text-xl" data-icon="check_circle">check_circle</span>
                    <span className="text-sm font-semibold">دعم فني عبر البريد خلال أوقات العمل</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-blue-600 text-xl" data-icon="check_circle">check_circle</span>
                    <span className="text-sm font-semibold">تقارير أداء شهرية مبسطة</span>
                  </li>
                </ul>

                <Link
                  to="/login"
                  className="w-full inline-block text-center py-3 px-6 rounded-lg border-2 border-blue-600 text-blue-600 font-bold hover:bg-blue-600 hover:text-white transition-all duration-300 active:scale-95"
                >
                  ابدأ مجاناً
                </Link>
              </motion.div>

              {/* Annual Plan Card (Most Popular) */}
              <motion.div 
                initial={{ opacity: 0, x: -40 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
                className="w-full md:w-1/2 bg-blue-600 rounded-3xl p-8 text-white relative shadow-[0_20px_40px_-15px_rgba(28,143,255,0.3)] transform md:-translate-y-4 border-2 border-blue-500"
              >
                <div className="absolute top-0 right-1/2 translate-x-1/2 -translate-y-1/2 bg-emerald-500 text-white font-bold text-xs px-4 py-1.5 rounded-full shadow-md">
                  الأكثر طلباً
                </div>
                
                <div className="mb-8 mt-2">
                  <h3 className="text-xl font-extrabold text-white mb-2">الباقة السنوية</h3>
                  <p className="text-sm text-white/80">لمشاغل الخياطة الاحترافية</p>
                </div>
                
                <div className="mb-8 flex items-baseline gap-2">
                  <span className="text-5xl font-extrabold text-white">699</span>
                  <span className="text-white/80 font-semibold flex items-center gap-1.5 align-baseline">
                    <span>ر.س / سنوياً</span>
                  </span>
                </div>

                <ul className="flex flex-col gap-4 mb-8 text-white/90">
                  <li className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-emerald-300 text-xl" data-icon="check_circle">check_circle</span>
                    <span className="text-sm font-semibold">عدد لا محدود من العملاء والطلبات</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-emerald-300 text-xl" data-icon="check_circle">check_circle</span>
                    <span className="text-sm font-semibold">ربط مباشر مع أنظمة الفوترة والزكاة</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-emerald-300 text-xl" data-icon="check_circle">check_circle</span>
                    <span className="text-sm font-semibold">إشعارات واتساب غير محدودة للعملاء</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-emerald-300 text-xl" data-icon="check_circle">check_circle</span>
                    <span className="text-sm font-semibold">دعم فني مخصص 24/7 عبر الهاتف</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-emerald-300 text-xl" data-icon="check_circle">check_circle</span>
                    <span className="text-sm font-semibold">لوحة تحكم متقدمة للتحليلات المالية</span>
                  </li>
                </ul>

                <Link
                  to="/login"
                  className="w-full inline-block text-center py-3.5 px-6 rounded-lg bg-white text-blue-600 font-extrabold hover:bg-slate-50 transition-all duration-300 active:scale-95 shadow-md shadow-blue-900/10"
                >
                  اشترك الآن
                </Link>
              </motion.div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24 relative overflow-hidden bg-slate-900 text-center">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-950 via-slate-900 to-slate-950 -z-10"></div>
          
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            className="relative z-10 max-w-4xl mx-auto px-6 md:px-10"
          >
            <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-6">جاهز لتطوير متجرك؟</h2>
            <p className="text-slate-400 text-lg mb-10 max-w-2xl mx-auto">
              انضم لمئات مشاغل الخياطة والتفصيل التي تعتمد على سين لإدارة أعمالها اليومية بكفاءة عالية واحترافية.
            </p>
            <div className="flex justify-center">
              <Link 
                to="/login" 
                className="bg-blue-650 text-white font-bold px-10 py-4 rounded-lg hover:bg-blue-700 transition-all duration-300 shadow-xl shadow-blue-600/20 hover:shadow-blue-600/35 active:scale-95 inline-flex items-center gap-2"
              >
                <span>ابدأ تجربتك المجانية الآن</span>
                <span className="material-symbols-outlined ml-1 text-sm" data-icon="arrow_back">arrow_back</span>
              </Link>
            </div>
          </motion.div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-slate-950 text-slate-400 py-12 border-t border-slate-900 text-sm">
        <div className="max-w-7xl mx-auto px-6 md:px-10 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3 text-white">
            <span className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-extrabold text-base shadow">
              س
            </span>
            <span className="font-extrabold text-lg">يسن للتفصيل</span>
          </div>
          
          <div className="flex gap-6">
            <a href="#features" className="hover:text-white transition-colors">المميزات</a>
            <a href="#pricing" className="hover:text-white transition-colors">الأسعار</a>
            <a href="#" className="hover:text-white transition-colors">الشروط والأحكام</a>
            <a href="#" className="hover:text-white transition-colors">سياسة الخصوصية</a>
          </div>
          
          <div>
            &copy; {new Date().getFullYear()} Seen. جميع الحقوق محفوظة منصة سين للخياطة.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
