import os
import re

dir_path = 'src/components'
pattern = re.compile(r'\s*style=\{\{\s*fontFamily:\s*[\'"](?:IBM Plex Sans, sans-serif|IBM Plex Sans Arabic, sans-serif)[\'"]\s*\}\}')
pattern2 = re.compile(r'\s*style=\{\{\s*fontFamily:\s*[\'"]IBM Plex Sans Arabic[\'"]\s*\}\}')
pattern3 = re.compile(r'const FONT = [\'"]\'IBM Plex Sans Arabic\', system-ui, sans-serif[\'"];\n*')

for root, _, files in os.walk(dir_path):
    for file in files:
        if file.endswith('.tsx'):
            file_path = os.path.join(root, file)
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            new_content = pattern.sub('', content)
            new_content = pattern2.sub('', new_content)
            new_content = pattern3.sub('', new_content)
            
            # Remove inline FONT references
            new_content = new_content.replace(' style={{ fontFamily: FONT }}', '')
            
            if content != new_content:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f"Updated {file_path}")

