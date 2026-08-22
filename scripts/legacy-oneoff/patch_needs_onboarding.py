import os

with open("src/App.tsx", "r") as f:
    content = f.read()

content = content.replace(
    "const needsOnboarding = (user && isApproved && onboardingStep > 0 && onboardingStep < 4);",
    "const needsOnboarding = (user && isApproved && userRole === 'owner' && onboardingStep > 0 && onboardingStep < 4);"
)

with open("src/App.tsx", "w") as f:
    f.write(content)
