import os

with open("src/components/Layout.tsx", "r") as f:
    content = f.read()

content = content.replace("<StaffTutorialModal />", "<StaffTutorialModal role={role} />")

with open("src/components/Layout.tsx", "w") as f:
    f.write(content)
