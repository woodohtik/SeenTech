import os

with open("src/components/SaaSSystemSettings.tsx", "r") as f:
    content = f.read()

content = content.replace("updated_by: auth.currentUser?.email", "updated_by: auth.currentUser?.uid")

with open("src/components/SaaSSystemSettings.tsx", "w") as f:
    f.write(content)
