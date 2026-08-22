import os

with open("src/components/Layout.tsx", "r") as f:
    content = f.read()

content = content.replace("<StaffTutorialModal role={role} />\\n", "")
content = content.replace("<StaffTutorialModal role={role} />", "")
content = content.replace("import StaffTutorialModal from './StaffTutorialModal';\\n", "")

with open("src/components/Layout.tsx", "w") as f:
    f.write(content)
