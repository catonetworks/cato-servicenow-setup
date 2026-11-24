import copy
import importlib.util
import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('package_builder', ROOT / 'scripts/build-update-set.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class UpdateSetTests(unittest.TestCase):
    def setUp(self):
        self.path = ROOT / 'build/cato-sync-hub-0.4.0.xml'
        self.root = ET.parse(self.path).getroot()

    def test_complete_metadata_and_disabled_defaults(self):
        counts = builder.validate(self.root, '0.4.0')
        self.assertEqual(counts['sys_security_acl'], 13)
        self.assertEqual(counts['sys_dictionary'], 33)
        self.assertEqual(len(self.root.findall('sys_update_xml')), 113)

    def test_runtime_payloads_match_reviewed_sources(self):
        for update in self.root.findall('sys_update_xml'):
            payload = ET.fromstring(update.findtext('payload'))
            for row in payload.findall('sys_script_include'):
                self.assertEqual(row.findtext('script'), (ROOT / 'servicenow' / (row.findtext('name') + '.js')).read_text())
            for row in payload.findall('sys_ui_page'):
                self.assertEqual(row.findtext('html'), (ROOT / 'servicenow/setup-page.xml').read_text())

    def test_rejects_runtime_records(self):
        update = self.root.find('sys_update_xml')
        update.find('payload').text = '<record_update><u_cato_sync_inbox action="INSERT_OR_UPDATE"><u_payload>private</u_payload></u_cato_sync_inbox></record_update>'
        with self.assertRaisesRegex(ValueError, 'Unexpected payload table'):
            builder.validate(self.root, '0.4.0')

    def test_rejects_open_acl_or_instance_properties(self):
        for table, field, value in [('sys_properties', 'name', 'cato_sync.api_key'), ('sys_security_acl_role', 'sys_user_role', 'other-role')]:
            root = copy.deepcopy(self.root)
            for update in root.findall('sys_update_xml'):
                payload = ET.fromstring(update.findtext('payload'))
                row = payload.find(table)
                if row is None:
                    continue
                row.find(field).text = value
                if table == 'sys_security_acl_role':
                    row.find(field).set('name', 'itil')
                update.find('payload').text = ET.tostring(payload, encoding='unicode')
                break
            with self.assertRaises(ValueError):
                builder.validate(root, '0.4.0')

    def test_build_is_reproducible(self):
        before = self.path.read_bytes()
        builder.build()
        self.assertEqual(self.path.read_bytes(), before)
        manifest = json.loads((ROOT / 'build/update-set-manifest.json').read_text())
        self.assertFalse(manifest['native_clean_install_verified'])


if __name__ == '__main__':
    unittest.main()
