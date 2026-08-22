import os

with open("src/components/AdminTailors.tsx", "r") as f:
    content = f.read()

target = """tenant.planId === 'basic' ? "bg-indigo-100 text-indigo-800 border border-indigo-200" :
                              "bg-gray-100 text-gray-700 shadow-sm\""""

replacement = """tenant.planId === 'basic' ? "bg-indigo-100 text-indigo-800 border border-indigo-200" :
                              tenant.planId === 'free' ? "bg-emerald-100 text-emerald-800 border border-emerald-200" :
                              "bg-gray-100 text-gray-700 shadow-sm\""""

content = content.replace(target, replacement)

with open("src/components/AdminTailors.tsx", "w") as f:
    f.write(content)
