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

    def test_artifacts_have_distinct_import_ids_and_stable_target_ids(self):
        original = copy.deepcopy(self.root)
        target_payloads = [u.findtext('payload') for u in original.findall('sys_update_xml')]
        original_id = original.findtext('sys_remote_update_set/sys_id')
        for version, changed_payload in [('0.4.1', False), ('0.4.0', True)]:
            root = copy.deepcopy(original)
            if changed_payload:
                root.find('sys_update_xml/payload').text += '\n'
            payloads = [u.findtext('payload') for u in root.findall('sys_update_xml')]
            builder.assign_transport_ids(root, version)
            remote_id = root.findtext('sys_remote_update_set/sys_id')
            self.assertNotEqual(remote_id, original_id)
            self.assertNotEqual(root.findtext('sys_remote_update_set/remote_sys_id'),
                                original.findtext('sys_remote_update_set/remote_sys_id'))
            self.assertTrue(all(u.findtext('remote_update_set') == remote_id for u in root.findall('sys_update_xml')))
            self.assertTrue(set(u.findtext('sys_id') for u in root.findall('sys_update_xml')).isdisjoint(
                u.findtext('sys_id') for u in original.findall('sys_update_xml')))
            self.assertEqual([u.findtext('payload') for u in root.findall('sys_update_xml')], payloads)
        builder.assign_transport_ids(original, '0.4.0')
        self.assertEqual(original.findtext('sys_remote_update_set/sys_id'), original_id)
        self.assertEqual([u.findtext('payload') for u in original.findall('sys_update_xml')], target_payloads)


if __name__ == '__main__':
    unittest.main()
