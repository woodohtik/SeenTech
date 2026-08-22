import os

with open("src/services/saasSecurityService.ts", "r") as f:
    content = f.read()

target = "console.error('Error logging SaaS security event:', error);"
replacement = "console.warn('SaaS security event log skipped (table may not exist):', error);"

content = content.replace(target, replacement)

with open("src/services/saasSecurityService.ts", "w") as f:
    f.write(content)
