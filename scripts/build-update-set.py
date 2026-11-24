#!/usr/bin/env python3
"""Build a metadata-only ServiceNow update set from the native export template."""
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
ALLOWED_TABLES = {
    'sys_app', 'sys_db_object', 'sys_dictionary', 'sys_documentation',
    'sys_security_acl', 'sys_security_acl_role', 'sys_user_role',
    'sys_script_include', 'sys_script', 'sys_ws_definition', 'sys_ws_operation',
    'sysauto_script', 'sys_properties', 'sys_ui_page', 'sys_app_application',
    'sys_app_module', 'sys_translated_text',
}
RULE_SOURCES = {
    'Cato Sync incident capture v1': 'incident-rule.js',
    'Cato Sync incident receipt v1': 'incident-confirm-rule.js',
    'Cato Sync journal capture v1': 'journal-rule.js',
}
TABLES = {'u_cato_sync_state', 'u_cato_sync_outbox', 'u_cato_sync_inbox'}


def validate(root, version):
    """Reject unexpected records, environment values and incomplete protection."""
    counts = {}
    definitions = []
    update_names = set()
    for update in root.findall('sys_update_xml'):
        name = update.findtext('name')
        if not name or name in update_names:
            raise ValueError('Missing or duplicate update identity')
        update_names.add(name)
        payload = ET.fromstring(update.findtext('payload'))
        for row in payload.iter():
            if 'action' not in row.attrib:
                continue
            if row.tag not in ALLOWED_TABLES:
                raise ValueError('Unexpected payload table: ' + row.tag)
            if row.get('action') == 'delete_multiple':
                if row.tag != 'sys_translated_text':
                    raise ValueError('Unexpected bulk deletion')
                continue
            if row.get('action') != 'INSERT_OR_UPDATE':
                raise ValueError('Unexpected update action')
            definitions.append(row)
            counts[row.tag] = counts.get(row.tag, 0) + 1
    expected = {'sys_app': 1, 'sys_db_object': 3, 'sys_dictionary': 33,
                'sys_security_acl': 13, 'sys_security_acl_role': 13,
                'sys_user_role': 1, 'sys_script_include': 4, 'sys_script': 3,
                'sys_ws_definition': 1, 'sys_ws_operation': 1, 'sysauto_script': 2,
                'sys_properties': 2, 'sys_ui_page': 1, 'sys_app_application': 1,
                'sys_app_module': 1}
    for table, count in expected.items():
        if counts.get(table) != count:
            raise ValueError('Incomplete artifact count: ' + table)
    properties = {r.findtext('name'): r.findtext('value') for r in definitions if r.tag == 'sys_properties'}
    if properties != {'cato_sync.enabled': 'false', 'cato_sync.package_version': version}:
        raise ValueError('Unexpected system property or value')
    tables = [r for r in definitions if r.tag == 'sys_db_object']
    if {r.findtext('name') for r in tables} != TABLES:
        raise ValueError('Unexpected application table')
    if any(r.findtext('ws_access') != 'false' or r.findtext('super_class') for r in tables):
        raise ValueError('Private table settings changed')
    acls = {r.findtext('sys_id'): r for r in definitions if r.tag == 'sys_security_acl'}
    mappings = [r for r in definitions if r.tag == 'sys_security_acl_role']
    for acl_id, acl in acls.items():
        roles = [r.find('sys_user_role') for r in mappings if r.findtext('sys_security_acl') == acl_id]
        if len(roles) != 1 or roles[0].get('name') != 'admin':
            raise ValueError('ACL must have one admin mapping')
        if acl.findtext('active') != 'true' or acl.findtext('condition') or acl.findtext('script'):
            raise ValueError('Unexpected ACL condition')
    acl_keys = {(r.findtext('type'), r.findtext('name'), r.findtext('operation')) for r in acls.values()}
    expected_acls = {('record', table, operation) for table in TABLES for operation in ['create', 'read', 'write', 'delete']}
    expected_acls.add(('ui_page', 'cato_sync_setup', 'read'))
    if acl_keys != expected_acls:
        raise ValueError('Incorrect access-control coverage')
    dictionaries = {(r.findtext('name'), r.findtext('element')): r for r in definitions if r.tag == 'sys_dictionary'}
    for table, column in [(t, 'u_key') for t in TABLES] + [('u_cato_sync_inbox', 'u_stream_key')]:
        if dictionaries[(table, column)].findtext('unique') != 'true':
            raise ValueError('Missing unique column definition')
    return counts


def build():
    version = json.loads((ROOT / 'package.json').read_text())['version']
    template = (ROOT / 'servicenow/update-set-template.xml').read_text()
    if '<!DOCTYPE' in template or '<!ENTITY' in template:
        raise ValueError('XML declarations are forbidden')
    root = ET.fromstring(template)
    for update in root.findall('sys_update_xml'):
        payload = ET.fromstring(update.findtext('payload'))
        for row in payload.findall('sys_script_include'):
            row.find('script').text = (ROOT / 'servicenow' / (row.findtext('name') + '.js')).read_text()
        for row in payload.findall('sys_script'):
            row.find('script').text = (ROOT / 'servicenow' / RULE_SOURCES[row.findtext('name')]).read_text()
        for row in payload.findall('sys_ws_operation'):
            row.find('operation_script').text = (ROOT / 'servicenow/receiver.js').read_text()
        for row in payload.findall('sys_ui_page'):
            row.find('html').text = (ROOT / 'servicenow/setup-page.xml').read_text()
            row.find('client_script').text = (ROOT / 'servicenow/setup-client.js').read_text()
        for row in payload.findall('sys_app'):
            row.find('version').text = version
        for row in payload.findall('sys_properties'):
            if row.findtext('name') == 'cato_sync.package_version':
                row.find('value').text = version
        update.find('payload').text = ET.tostring(payload, encoding='unicode')
    root.find('sys_remote_update_set/name').text = 'Cato Sync Hub ' + version
    counts = validate(root, version)
    content = ET.tostring(root, encoding='utf-8', xml_declaration=True) + b'\n'
    for forbidden in [b'catorefarch', b'dev467475', b'pinggy.net', b'synthetic_priority_five', b'__SOURCE_', b'__BUSINESS_RULE_SOURCE__']:
        if forbidden in content:
            raise ValueError('Environment-specific or unresolved source content')
    output_dir = ROOT / 'build'
    output_dir.mkdir(exist_ok=True)
    output = output_dir / ('cato-sync-hub-' + version + '.xml')
    output.write_bytes(content)
    digest = hashlib.sha256(content).hexdigest()
    (output_dir / 'SHA256SUMS').write_text(digest + '  ' + output.name + '\n')
    (output_dir / 'update-set-manifest.json').write_text(json.dumps({
        'version': version, 'sha256': digest, 'updates': len(root.findall('sys_update_xml')),
        'record_counts': counts, 'native_clean_install_verified': False,
    }, indent=2) + '\n')
    print(output)


if __name__ == '__main__':
    build()
