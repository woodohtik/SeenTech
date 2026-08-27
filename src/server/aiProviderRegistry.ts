// سجل مزوّدي الذكاء الاصطناعي المدعومين في "مساعد سين الذكي" — طبقة مركزية
// واحدة. إضافة مزوّد جديد مستقبلاً (Mistral, DeepSeek, ...) تعني فقط إضافة
// entry هنا، دون لمس منطق الاختيار/Fallback في server.ts أو واجهة الإعدادات.
//
// كل createModel معرّفة كدالة async تستورد حزمة @ai-sdk/* المعنية ديناميكياً
// (await import(...) وليس import ثابت) -- كل حزم @ai-sdk/* هي ESM-only
// ("type": "module")، وesbuild يحوّل أي import ثابت لحزمة خارجية إلى
// require() عند تجميع server.ts بصيغة CJS، وrequire() لا يستطيع تحميل وحدة
// ESM إطلاقاً (ERR_REQUIRE_ESM وقت التشغيل) -- نفس السبب الموثّق في
// assistantTools.ts لحزمتَي 'ai' و'zod'.

export interface ProviderDefinition {
  label: string;
  defaultModels: string[];
  createModel: (apiKey: string, modelName: string) => Promise<any>;
}

export const PROVIDERS: Record<string, ProviderDefinition> = {
  gemini: {
    label: 'Google Gemini',
    defaultModels: ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    createModel: async (apiKey, modelName) => {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      return createGoogleGenerativeAI({ apiKey })(modelName);
    },
  },
  openai: {
    label: 'OpenAI (ChatGPT)',
    defaultModels: ['gpt-4o-mini', 'gpt-4o'],
    createModel: async (apiKey, modelName) => {
      const { createOpenAI } = await import('@ai-sdk/openai');
      return createOpenAI({ apiKey })(modelName);
    },
  },
  groq: {
    label: 'Groq',
    defaultModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    createModel: async (apiKey, modelName) => {
      const { createGroq } = await import('@ai-sdk/groq');
      return createGroq({ apiKey })(modelName);
    },
  },
  anthropic: {
    label: 'Claude (Anthropic)',
    defaultModels: ['claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-opus-5'],
    createModel: async (apiKey, modelName) => {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      return createAnthropic({ apiKey })(modelName);
    },
  },
};

export type ProviderKey = keyof typeof PROVIDERS;

export function isKnownProvider(key: string): key is ProviderKey {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, key);
}

export async function buildModelForProvider(providerKey: string, modelName: string, apiKey: string) {
  const provider = PROVIDERS[providerKey];
  if (!provider) throw new Error(`مزوّد ذكاء اصطناعي غير معروف: ${providerKey}`);
  return provider.createModel(apiKey, modelName);
}
