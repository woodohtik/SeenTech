import os

with open("src/services/supabase/client.ts", "r") as f:
    content = f.read()

content = content.replace("console.error('[Supabase Fetch Interceptor] Failed to decode orders response:', err);", "console.warn('[Supabase Fetch Interceptor] Failed to decode orders response (likely network disconnect):', err);")

with open("src/services/supabase/client.ts", "w") as f:
    f.write(content)
