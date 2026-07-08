import os

with open("src/components/SaaSLayout.tsx", "r") as f:
    content = f.read()

target = "console.error('Error fetching notifications:', err);"
replacement = "console.warn('Error fetching notifications:', err);"

content = content.replace(target, replacement)

with open("src/components/SaaSLayout.tsx", "w") as f:
    f.write(content)
