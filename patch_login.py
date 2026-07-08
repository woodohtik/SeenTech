import os

with open("src/components/Login.tsx", "r") as f:
    content = f.read()

target = "plan_id: 'basic',"
replacement = "plan_id: 'free',"

content = content.replace(target, replacement)

with open("src/components/Login.tsx", "w") as f:
    f.write(content)
