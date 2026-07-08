import os

with open("src/components/Layout.tsx", "r") as f:
    content = f.read()

import_statement = "import SeenAIFab from './SeenAIFab';\n"
if "import SeenAIFab" not in content:
    content = content.replace("import StaffTutorialModal from './StaffTutorialModal';", "import StaffTutorialModal from './StaffTutorialModal';\n" + import_statement)

target_render = "<StaffTutorialModal role={role} />"
replacement_render = "<StaffTutorialModal role={role} />\n          <SeenAIFab />"

if "<SeenAIFab />" not in content:
    content = content.replace(target_render, replacement_render)

with open("src/components/Layout.tsx", "w") as f:
    f.write(content)
