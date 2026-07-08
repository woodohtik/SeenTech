import os

with open("src/lib/logger.ts", "r") as f:
    content = f.read()

content = content.replace("console.error('[Logger] RAW ERROR:', error);", "console.warn('[Logger] RAW ERROR:', error);")
content = content.replace("console.error('[Logger] CONTEXT:', context);", "console.warn('[Logger] CONTEXT:', context);")
content = content.replace("console.error('[Logger] Error:', errorMsg, ctxStr);", "console.warn('[Logger] Error:', errorMsg, ctxStr);")

with open("src/lib/logger.ts", "w") as f:
    f.write(content)
