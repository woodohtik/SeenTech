import os

with open("src/components/AdminTailors.tsx", "r") as f:
    content = f.read()

content = content.replace('console.error("Error updating tenant plan:", error);', 'console.warn("Error updating tenant plan:", error);')
content = content.replace('console.error("Error extending trial:", error);', 'console.warn("Error extending trial:", error);')

with open("src/components/AdminTailors.tsx", "w") as f:
    f.write(content)
