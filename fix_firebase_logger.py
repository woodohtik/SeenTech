import os

with open("src/lib/firebase.ts", "r") as f:
    content = f.read()

content = content.replace("console.error(`[Firestore Error] ${operationType} at ${path}:`, errInfo);", "console.warn(`[Firestore Error] ${operationType} at ${path}:`, errInfo);")
content = content.replace("console.error(\"Failed to stringify error info:\", e);", "console.warn(\"Failed to stringify error info:\", e);")

with open("src/lib/firebase.ts", "w") as f:
    f.write(content)
