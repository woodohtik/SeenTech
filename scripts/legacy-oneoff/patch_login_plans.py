import os

with open("src/components/Login.tsx", "r") as f:
    content = f.read()

target = """          const { data: plansData } = await supabase.from('plans').select('id');
          if (!plansData || plansData.length === 0) {"""

replacement = """          const { data: plansData } = await supabase.from('plans').select('id');
          if (!plansData || plansData.length === 0 || !plansData.find(p => p.id === 'free')) {"""

content = content.replace(target, replacement)

with open("src/components/Login.tsx", "w") as f:
    f.write(content)
