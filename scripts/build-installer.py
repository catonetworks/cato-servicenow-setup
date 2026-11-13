#!/usr/bin/env python3
"""Build a reviewable, repeatable ServiceNow administrator background script."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sources = {p.name: p.read_text() for p in (root / 'servicenow').glob('*.js')}
template = (root / 'scripts/install-template.js').read_text()
output = root / 'build/install.js'
output.parent.mkdir(exist_ok=True)
output.write_text(template.replace('/* SOURCES */', json.dumps(sources, ensure_ascii=True)))
print(output)
