import os

with open("src/components/StaffTutorialModal.tsx", "r") as f:
    content = f.read()

content = content.replace("from 'framer-motion'", "from 'motion/react'")

with open("src/components/StaffTutorialModal.tsx", "w") as f:
    f.write(content)
