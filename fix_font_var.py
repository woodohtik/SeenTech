import os
import re

dir_path = 'src/components'
pattern1 = re.compile(r',\s*fontFamily:\s*FONT')
pattern2 = re.compile(r'fontFamily:\s*FONT\s*,?')

for root, _, files in os.walk(dir_path):
    for file in files:
        if file.endswith('.tsx') or file.endswith('.ts'):
            file_path = os.path.join(root, file)
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            new_content = pattern1.sub('', content)
            new_content = pattern2.sub('', new_content)
            
            if content != new_content:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f"Updated {file_path}")

