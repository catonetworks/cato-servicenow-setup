#!/usr/bin/env python3
"""Build a reviewable, repeatable ServiceNow administrator background script."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
files = ['CatoSyncRules.js', 'CatoSyncHub.js', 'incident-rule.js', 'incident-confirm-rule.js',
         'journal-rule.js', 'receiver.js', 'CatoSyncSetup.js', 'CatoSyncSetupAjax.js',
         'setup-page.xml', 'setup-client.js']
sources = {name: (root / 'servicenow' / name).read_text() for name in files}
template = (root / 'scripts/install-template.js').read_text()
output = root / 'build/install.js'
output.parent.mkdir(exist_ok=True)
output.write_text(template.replace('/* SOURCES */', json.dumps(sources, ensure_ascii=True)))
print(output)
