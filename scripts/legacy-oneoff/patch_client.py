import os

with open("src/services/supabase/client.ts", "r") as f:
    content = f.read()

target = """                                try {
                                    const text = await clonedRes.text();
                                    const parsed = JSON.parse(text);
                                    const decoded = decodeOrderPayload(parsed);"""

replacement = """                                try {
                                    const text = await clonedRes.text();
                                    if (!text) return res;
                                    const parsed = JSON.parse(text);
                                    const decoded = decodeOrderPayload(parsed);"""

content = content.replace(target, replacement)

with open("src/services/supabase/client.ts", "w") as f:
    f.write(content)
