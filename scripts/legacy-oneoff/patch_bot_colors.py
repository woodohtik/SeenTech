import os

with open("src/components/SeenAIFab.tsx", "r") as f:
    content = f.read()

content = content.replace(
    'className="w-14 h-14 bg-gradient-to-tr from-indigo-600 to-purple-600 rounded-2xl shadow-lg flex items-center justify-center text-white hover:shadow-xl hover:scale-105 transition-all relative group"',
    'className="w-14 h-14 bg-brand rounded-2xl shadow-lg flex items-center justify-center text-white hover:shadow-xl hover:scale-105 transition-all relative group"'
)

content = content.replace(
    'className="p-4 border-b border-border flex justify-between items-center bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30"',
    'className="p-4 border-b border-border flex justify-between items-center bg-brand/5 dark:bg-brand/10"'
)

content = content.replace(
    '<Bot className="text-indigo-600" />',
    '<Bot className="text-brand" />'
)

content = content.replace(
    'className="w-20 h-20 bg-gradient-to-tr from-indigo-100 to-purple-100 dark:from-indigo-900/40 dark:to-purple-900/40 rounded-full flex items-center justify-center mb-2"',
    'className="w-20 h-20 bg-brand/10 rounded-full flex items-center justify-center mb-2"'
)

content = content.replace(
    '<Bot size={40} className="text-indigo-600" />',
    '<Bot size={40} className="text-brand" />'
)

with open("src/components/SeenAIFab.tsx", "w") as f:
    f.write(content)
