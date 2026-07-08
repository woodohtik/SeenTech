import os

with open("src/components/Layout.tsx", "r") as f:
    content = f.read()

import_statement = "import StaffTutorialModal from './StaffTutorialModal';\n"
if "import StaffTutorialModal" not in content:
    content = content.replace("import SupportConsentModal from './SupportConsentModal';", "import SupportConsentModal from './SupportConsentModal';\n" + import_statement)

target_render = "{children}"
replacement_render = "{children}\n          <StaffTutorialModal />"

if "<StaffTutorialModal />" not in content:
    content = content.replace(target_render, replacement_render)

with open("src/components/Layout.tsx", "w") as f:
    f.write(content)
