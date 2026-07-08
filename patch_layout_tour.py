import os

with open("src/components/Layout.tsx", "r") as f:
    content = f.read()

import_statement = "import OnboardingTour from './OnboardingTour';\n"
if "import OnboardingTour" not in content:
    content = content.replace("import SeenAIFab from './SeenAIFab';", "import SeenAIFab from './SeenAIFab';\n" + import_statement)

target_render = "<SeenAIFab />"
replacement_render = "<SeenAIFab />\n          <OnboardingTour />"

if "<OnboardingTour />" not in content:
    content = content.replace(target_render, replacement_render)

with open("src/components/Layout.tsx", "w") as f:
    f.write(content)
