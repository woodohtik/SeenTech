import os

with open("src/components/ErrorBoundary.tsx", "r") as f:
    content = f.read()

content = content.replace("console.error('React ErrorBoundary caught an error:', error, errorInfo);", "console.warn('React ErrorBoundary caught an error:', error, errorInfo);")
content = content.replace("console.error('Failed to log error inside ErrorBoundary:', e);", "console.warn('Failed to log error inside ErrorBoundary:', e);")

with open("src/components/ErrorBoundary.tsx", "w") as f:
    f.write(content)
