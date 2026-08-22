import os

with open("src/components/StaffTutorialModal.tsx", "r") as f:
    content = f.read()

content = content.replace("export default function StaffTutorialModal() {", "export default function StaffTutorialModal({ role }: { role?: string | null }) {")
content = content.replace("const { userRole } = useAuth();", "")
content = content.replace("if (userRole === 'staff') {", "if (role === 'staff') {")
content = content.replace("[userRole]", "[role]")

with open("src/components/StaffTutorialModal.tsx", "w") as f:
    f.write(content)
