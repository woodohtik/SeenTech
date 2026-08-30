import { supabaseAdmin } from './supabase-admin.ts';

// ملاحظة بناء: 'ai' و'zod' كلاهما حزمتان ESM-only فقط (package.json: "type":
// "module"). هذا الملف يُحزَّم ضمن server.ts بصيغة CJS عبر esbuild
// (--format=cjs)، وأي import ثابت من حزمة ESM يتحوّل تلقائياً إلى require()
// عند البناء — وrequire() لا يستطيع تحميل وحدات ESM إطلاقاً (ERR_REQUIRE_ESM
// وقت التشغيل، وليس وقت البناء). لذا استيراد ديناميكي إلزامي هنا، حتى لو
// كانت الدالة نفسها تُستورَد ديناميكياً من server.ts — الاستيراد الساكن
// المتداخل داخل ملف مُجمَّع يتحوّل لـ require() بغض النظر عن كيفية استيراد
// الملف نفسه من الخارج.

// أدوات بيانات "مساعد سين الذكي" — قراءة فقط (Read-Only)، بلا أي أداة
// Insert/Update/Delete على الإطلاق.
//
// tenantId/userRole يأتيان حصراً من ctx الممرَّر لـ buildAssistantTools(ctx)
// من server.ts (المبني من جلسة المستخدم الموثّقة عبر authenticate middleware)
// — لا يوجد أي معامل tenantId في أي Zod schema أدناه، والنموذج لا يستطيع
// التأثير عليه بأي صياغة مهما كانت. كل أداة تُغلِق (closure) على ctx مباشرة
// بدل الاعتماد على آلية runtimeContext/toolExecutionOptions.context الخاصة
// بـ streamText — تبيّن عملياً (عبر اختبار حي مع سجلات Vercel) أن context
// كان يصل undefined لكل استدعاء أداة رغم تمرير runtimeContext بشكل صحيح
// لـ streamText، على الأرجح بسبب تعارض إصدارات بين حزمة ai وحزم @ai-sdk/*
// المزوّدة. الإغلاق المباشر أبسط ومضمون النجاح لأنه يعتمد على JS العادي
// فقط، بلا أي آلية داخلية من الحزمة.

export interface AssistantToolContext {
  tenantId: string;
  userId: string;
  userRole: string;
}

// "Admin" في وثيقة المهمة يقابل هذه الأدوار في نظام سين (نفس القائمة
// المستخدمة في allowedRoles للتقارير المالية عبر التطبيق، مثل Reports.tsx).
const ADMIN_ROLES = new Set(['owner', 'admin', 'manager', 'super_admin']);

function isAdminRole(role: string): boolean {
  return ADMIN_ROLES.has(role);
}

async function logToolCall(
  ctx: AssistantToolContext,
  toolName: string,
  params: unknown,
  denied: boolean,
  denyReason?: string
) {
  try {
    await supabaseAdmin.from('assistant_tool_calls').insert({
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      user_role: ctx.userRole,
      tool_name: toolName,
      params: params as any,
      denied,
      deny_reason: denyReason || null,
    });
  } catch (err) {
    console.error('[assistant_tool_calls] insert failed:', err);
  }
}

const DENIED_ROLE_MESSAGE = 'هذه البيانات غير متاحة لدورك الحالي. يرجى التواصل مع صاحب المحل أو المدير للاطلاع عليها.';

// حد أقصى سنة واحدة لأي نطاق تاريخي، لمنع استعلامات ضخمة/مكلفة أو تسريب
// كميات كبيرة من البيانات دفعة واحدة.
function clampDateRange(startDate: string, endDate: string): { start: string; end: string } {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('صيغة التاريخ غير صحيحة، استخدم YYYY-MM-DD');
  }
  const oneYearMs = 366 * 24 * 60 * 60 * 1000;
  if (end.getTime() - start.getTime() > oneYearMs) {
    throw new Error('النطاق الزمني المطلوب أطول من سنة واحدة — رجاءً حدّد نطاقاً أضيق');
  }
  if (end.getTime() < start.getTime()) {
    throw new Error('تاريخ النهاية قبل تاريخ البداية');
  }
  return { start: startDate, end: endDate };
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function buildAssistantTools(ctx: AssistantToolContext) {
  const { z } = await import('zod');
  const { tool } = await import('ai');

  const getSalesSummary = tool({
    description: 'إجمالي المبيعات وعدد الفواتير خلال فترة زمنية محددة. الكاشير يحصل على بيانات اليوم الحالي فقط بغض النظر عن التواريخ المطلوبة.',
    inputSchema: z.object({
      startDate: z.string().describe('تاريخ البداية بصيغة YYYY-MM-DD'),
      endDate: z.string().describe('تاريخ النهاية بصيغة YYYY-MM-DD'),
    }),
    execute: async ({ startDate, endDate }) => {
      let start: string; let end: string;
      if (!isAdminRole(ctx.userRole)) {
        // Cashier وأي دور تشغيلي آخر غير إداري: اليوم الحالي فقط بغض النظر
        // عمّا طُلب — يُطبَّق قبل أي تحقق من صحة النطاق المُدخَل، حتى لا
        // يفشل الطلب بخطأ "نطاق طويل جداً" بدل أن يُقيَّد بصمت لليوم الحالي.
        start = todayStr();
        end = todayStr();
      } else {
        ({ start, end } = clampDateRange(startDate, endDate));
      }
      await logToolCall(ctx, 'getSalesSummary', { startDate: start, endDate: end }, false);
      const { data, error } = await supabaseAdmin.rpc('assistant_get_sales_summary', {
        p_tenant_id: ctx.tenantId, p_start: start, p_end: end,
      });
      if (error) throw new Error(error.message);
      return { ...data, appliedStartDate: start, appliedEndDate: end };
    },
  });

  const searchInvoices = tool({
    description: 'بحث في الفواتير/الطلبات حسب اسم العميل، رقم الطلب، أو نطاق تاريخ. يرجع حتى 50 نتيجة.',
    inputSchema: z.object({
      customerName: z.string().optional().describe('اسم العميل كاملاً أو جزء منه'),
      orderNumber: z.string().optional().describe('رقم الطلب/الفاتورة'),
      startDate: z.string().optional().describe('تاريخ البداية YYYY-MM-DD'),
      endDate: z.string().optional().describe('تاريخ النهاية YYYY-MM-DD'),
    }),
    execute: async ({ customerName, orderNumber, startDate, endDate }) => {
      await logToolCall(ctx, 'searchInvoices', { customerName, orderNumber, startDate, endDate }, false);

      let q = supabaseAdmin
        .from('orders')
        .select('order_number, customer_name, status, payment_method, total_amount, paid_amount, remaining_amount, order_date')
        .eq('tenant_id', ctx.tenantId)
        .neq('is_test', true)
        .order('order_date', { ascending: false })
        .limit(50);

      if (customerName) q = q.ilike('customer_name', `%${customerName}%`);
      if (orderNumber) q = q.eq('order_number', Number(orderNumber) || -1);
      if (startDate && endDate) {
        const { start, end } = clampDateRange(startDate, endDate);
        q = q.gte('order_date', start).lte('order_date', end);
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data?.length || 0, invoices: data || [] };
    },
  });

  const getInventoryStatus = tool({
    description: 'حالة صنف/مادة معينة في المخزون: الكمية المتوفرة، الحد الأدنى، السعر.',
    inputSchema: z.object({
      itemName: z.string().describe('اسم الصنف أو رمز SKU للبحث عنه'),
    }),
    execute: async ({ itemName }) => {
      await logToolCall(ctx, 'getInventoryStatus', { itemName }, false);

      const { data: items, error } = await supabaseAdmin
        .from('inventory_items')
        .select('id, name, sku, unit, min_threshold, price_per_unit')
        .eq('tenant_id', ctx.tenantId)
        .neq('is_test', true)
        .or(`name.ilike.%${itemName}%,sku.ilike.%${itemName}%,barcode.eq.${itemName}`)
        .limit(10);
      if (error) throw new Error(error.message);
      if (!items || items.length === 0) return { found: false, items: [] };

      const itemIds = items.map((i: any) => i.id);
      const { data: stockRows } = await supabaseAdmin
        .from('branch_inventory')
        .select('item_id, quantity')
        .eq('tenant_id', ctx.tenantId)
        .in('item_id', itemIds);

      const quantityByItem = new Map<string, number>();
      for (const row of stockRows || []) {
        quantityByItem.set(row.item_id, (quantityByItem.get(row.item_id) || 0) + Number(row.quantity || 0));
      }

      return {
        found: true,
        items: items.map((i: any) => ({
          name: i.name,
          sku: i.sku,
          unit: i.unit,
          pricePerUnit: i.price_per_unit,
          minThreshold: i.min_threshold,
          currentQuantity: quantityByItem.get(i.id) || 0,
        })),
      };
    },
  });

  const getLowStockAlerts = tool({
    description: 'قائمة الأصناف التي وصلت أو اقتربت من حد النفاد (الكمية الحالية <= الحد الأدنى المحدد للصنف).',
    inputSchema: z.object({}),
    execute: async () => {
      await logToolCall(ctx, 'getLowStockAlerts', {}, false);
      const { data, error } = await supabaseAdmin.rpc('assistant_get_low_stock_alerts', {
        p_tenant_id: ctx.tenantId, p_limit: 50,
      });
      if (error) throw new Error(error.message);
      return { count: (data || []).length, items: data || [] };
    },
  });

  const getTopSellingItems = tool({
    description: 'الأصناف الأكثر مبيعاً (بالكمية) خلال فترة زمنية محددة.',
    inputSchema: z.object({
      startDate: z.string().describe('تاريخ البداية YYYY-MM-DD'),
      endDate: z.string().describe('تاريخ النهاية YYYY-MM-DD'),
    }),
    execute: async ({ startDate, endDate }) => {
      const { start, end } = clampDateRange(startDate, endDate);
      await logToolCall(ctx, 'getTopSellingItems', { startDate: start, endDate: end }, false);
      const { data, error } = await supabaseAdmin.rpc('assistant_get_top_selling_items', {
        p_tenant_id: ctx.tenantId, p_start: start, p_end: end, p_limit: 10,
      });
      if (error) throw new Error(error.message);
      return { items: data || [] };
    },
  });

  const getCustomerHistory = tool({
    description: 'سجل طلبات/فواتير عميل معيّن، بالبحث بالاسم أو رقم الجوال. يرجع حتى 20 طلباً.',
    inputSchema: z.object({
      nameOrPhone: z.string().describe('اسم العميل أو رقم جواله'),
    }),
    execute: async ({ nameOrPhone }) => {
      await logToolCall(ctx, 'getCustomerHistory', { nameOrPhone }, false);

      const { data: customers, error: custErr } = await supabaseAdmin
        .from('customers')
        .select('id, name, phone')
        .eq('tenant_id', ctx.tenantId)
        .or(`name.ilike.%${nameOrPhone}%,phone.ilike.%${nameOrPhone}%`)
        .limit(5);
      if (custErr) throw new Error(custErr.message);
      if (!customers || customers.length === 0) return { found: false, customers: [] };

      const customerIds = customers.map((c: any) => c.id);
      const { data: orders, error: ordErr } = await supabaseAdmin
        .from('orders')
        .select('customer_id, order_number, status, total_amount, paid_amount, remaining_amount, order_date')
        .eq('tenant_id', ctx.tenantId)
        .neq('is_test', true)
        .in('customer_id', customerIds)
        .order('order_date', { ascending: false })
        .limit(20);
      if (ordErr) throw new Error(ordErr.message);

      return {
        found: true,
        customers: customers.map((c: any) => ({
          name: c.name,
          phone: c.phone,
          orders: (orders || []).filter((o: any) => o.customer_id === c.id),
        })),
      };
    },
  });

  const getPendingOrders = tool({
    description: 'طلبات التفصيل الجارية غير المكتملة/غير المُسلَّمة (كل الحالات ما عدا "تم التسليم" و"ملغي"). يرجع حتى 50 طلباً.',
    inputSchema: z.object({}),
    execute: async () => {
      await logToolCall(ctx, 'getPendingOrders', {}, false);
      const { data, error } = await supabaseAdmin
        .from('orders')
        .select('order_number, customer_name, status, delivery_date, total_amount, remaining_amount')
        .eq('tenant_id', ctx.tenantId)
        .neq('is_test', true)
        .not('status', 'in', '(delivered,cancelled)')
        .order('delivery_date', { ascending: true })
        .limit(50);
      if (error) throw new Error(error.message);
      return { count: data?.length || 0, orders: data || [] };
    },
  });

  const getRevenueReport = tool({
    description: 'تقرير إيرادات تفصيلي (المبيعات، الضريبة، الخصومات، متوسط قيمة الطلب، التوزيع حسب طريقة الدفع) — للإدارة فقط.',
    inputSchema: z.object({
      startDate: z.string().describe('تاريخ البداية YYYY-MM-DD'),
      endDate: z.string().describe('تاريخ النهاية YYYY-MM-DD'),
    }),
    execute: async ({ startDate, endDate }) => {
      if (!isAdminRole(ctx.userRole)) {
        await logToolCall(ctx, 'getRevenueReport', { startDate, endDate }, true, 'insufficient_role');
        return { denied: true, message: DENIED_ROLE_MESSAGE };
      }
      const { start, end } = clampDateRange(startDate, endDate);
      await logToolCall(ctx, 'getRevenueReport', { startDate: start, endDate: end }, false);
      const { data, error } = await supabaseAdmin.rpc('assistant_get_revenue_report', {
        p_tenant_id: ctx.tenantId, p_start: start, p_end: end,
      });
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const getDailyClosingReport = tool({
    description: 'تقرير إغلاق يومي: مبيعات اليوم، طرق الدفع، المرتجعات — للإدارة فقط.',
    inputSchema: z.object({
      date: z.string().describe('التاريخ المطلوب YYYY-MM-DD'),
    }),
    execute: async ({ date }) => {
      if (!isAdminRole(ctx.userRole)) {
        await logToolCall(ctx, 'getDailyClosingReport', { date }, true, 'insufficient_role');
        return { denied: true, message: DENIED_ROLE_MESSAGE };
      }
      await logToolCall(ctx, 'getDailyClosingReport', { date }, false);
      const { data, error } = await supabaseAdmin.rpc('assistant_get_daily_closing', {
        p_tenant_id: ctx.tenantId, p_date: date,
      });
      if (error) throw new Error(error.message);
      return data;
    },
  });

  // قائمة الوجهات المتاحة للجولة التعليمية المخصّصة — تطابق تماماً معرّفات
  // الخطوات ذات kind='spotlight' في src/config/tourSteps.ts (باستثناء
  // خطوات التوجيه العامة مثل sidebar/preferences/ai_assistant التي ليست
  // وجهة "كيفية إضافة شيء"). أي topic خارج هذه القائمة يُرفض من Zod قبل
  // وصوله للتنفيذ، فلا مجال لنموذج اللغة لاختراع معرّف غير موجود في الواجهة.
  const GUIDED_TOUR_TOPICS = [
    'dashboard', 'pos_intro', 'pos_shift', 'pos_subtabs',
    'orders_new', 'orders_tabs', 'orders_search',
    'customers_add', 'customers_search',
    'inventory_tabs', 'inventory_actions',
    'suppliers', 'reports_filters', 'reports_tabs', 'settings',
  ] as const;

  const guidedTour = tool({
    description: 'اعرض أو فعّل جولة تعليمية تفاعلية تُشير فعلياً إلى مكان الإجراء في واجهة النظام (نفس نظام الجولة التي تظهر أول مرة عند تسجيل الدخول، لكن مركّزة على موضوع واحد). استدعِ هذه الأداة دائماً مباشرة بعد شرح "كيف أضيف/أنشئ/أسجّل ..." بـ action="offer" — الأداة نفسها تعرض للمستخدم زر توجيه، فلا تكتفِ بسؤاله نصياً فقط دون استدعائها. إن وافق المستخدم لاحقاً بالنص على عرض سابق (مثل "نعم" أو "أكيد")، استدعها مرة أخرى بنفس الـ topic و action="start" لتشغيل الجولة فوراً. لا تستخدمها لموضوع لم تشرحه للمستخدم للتو.',
    inputSchema: z.object({
      topic: z.enum(GUIDED_TOUR_TOPICS).describe('معرّف القسم/الإجراء المطابق تماماً لما شرحته للتو'),
      action: z.enum(['offer', 'start']).describe('offer: اعرض بطاقة توجيه بعد الشرح (الوضع الافتراضي في كل مرة). start: فعّل الجولة فوراً، فقط بعد موافقة نصية صريحة من المستخدم على عرض سابق لنفس الموضوع'),
    }),
    execute: async ({ topic, action }) => {
      await logToolCall(ctx, 'guidedTour', { topic, action }, false);
      return { topic, action };
    },
  });

  return {
    getSalesSummary,
    searchInvoices,
    getInventoryStatus,
    getLowStockAlerts,
    getTopSellingItems,
    getCustomerHistory,
    getPendingOrders,
    getRevenueReport,
    getDailyClosingReport,
    guidedTour,
  };
}
