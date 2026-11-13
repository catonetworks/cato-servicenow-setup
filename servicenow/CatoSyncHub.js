var CatoSyncHub = Class.create();
CatoSyncHub.prototype = {
    initialize: function () {},
    property: function (name) { return String(gs.getProperty('cato_sync.' + name, '')); },
    enabled: function () { return this.property('enabled') === 'true'; },
    integration: function () { return this.property('integration_id'); },
    eligible: function (incident) {
        return this.property('assignment_group') && String(incident.getValue('assignment_group')) === this.property('assignment_group')
            && String(incident.getValue('short_description') || '').indexOf('[SYNC-HUB]') === 0;
    },
    state: function (incident) {
        var profile = JSON.parse(this.property('state_profile'));
        var state = String(incident.getValue('state'));
        if (state === String(profile.NEW)) return 'NEW';
        if (state === String(profile.IN_PROGRESS)) return 'IN_PROGRESS';
        if (state === String(profile.RESOLVED)) return 'RESOLVED';
        if (state === String(profile.ON_HOLD)) {
            var reason = String(incident.getValue('hold_reason'));
            var names = ['AWAITING_CALLER', 'AWAITING_VENDOR', 'AWAITING_CHANGE'];
            for (var i = 0; i < names.length; i++) if (reason === String(profile[names[i]])) return names[i];
        }
        throw new Error('UNSUPPORTED_TRANSITION');
    },
    source: function (incident) {
        return {instance: this.property('instance_origin'), table: 'incident', recordId: String(incident.getUniqueValue()), revision: Number(incident.getValue('sys_mod_count') || 0)};
    },
    envelope: function (incident, id, kind) {
        return {schemaVersion: 1, integrationId: this.integration(), eventId: id, kind: kind, source: this.source(incident), occurredAt: String(incident.getValue('sys_updated_on')).replace(' ', 'T') + 'Z'};
    },
    ledger: function (recordId) {
        var row = new GlideRecord('u_cato_sync_state');
        if (!row.get('u_key', recordId)) {
            row.initialize(); row.setValue('u_key', recordId); row.setValue('u_next_sequence', 1);
            if (!row.insert() && !row.get('u_key', recordId)) throw new Error('STATE_INSERT_FAILED');
        }
        return row;
    },
    enqueue: function (event) {
        var payload = CatoSyncRules.canonical(event);
        if (GlideStringUtil.base64Encode(payload).length > 327680) throw new Error('PAYLOAD_TOO_LARGE');
        var row = new GlideRecord('u_cato_sync_outbox');
        if (row.get('u_key', event.eventId)) {
            if (String(row.getValue('u_payload')) !== payload) throw new Error('EVENT_ID_CONFLICT');
            return;
        }
        row.initialize(); row.setValue('u_key', event.eventId); row.setValue('u_record', event.source.recordId);
        row.setValue('u_payload', payload); row.setValue('u_state', 'PENDING'); row.setValue('u_attempts', 0);
        if (!row.insert()) throw new Error('OUTBOX_INSERT_FAILED');
    },
    captureIncident: function (current, previous) {
        if (!this.enabled() || !this.eligible(current)) return;
        var recordId = String(current.getUniqueValue());
        var state = this.ledger(recordId);
        var fields = {title: String(current.getValue('short_description')), priority: CatoSyncRules.priority(current.getValue('priority')), state: this.state(current)};
        var created = new GlideRecord('u_cato_sync_outbox');
        if (!created.get('u_key', 'create:' + recordId)) {
            if (fields.state !== 'NEW') throw new Error('INITIAL_STATE_NOT_SUPPORTED');
            var initial = this.envelope(current, 'create:' + recordId, 'CREATE');
            fields.description = String(current.getValue('description') || ''); initial.fields = fields; this.enqueue(initial); return;
        }
        var change = {};
        if (current.short_description.changes()) change.title = fields.title;
        if (current.priority.changes()) change.priority = fields.priority;
        if (current.state.changes() || current.hold_reason.changes()) change.state = fields.state;
        var operation = String(current.getValue('u_cato_sync_last_delivery') || '');
        var inbox = new GlideRecord('u_cato_sync_inbox');
        if (operation && current.u_cato_sync_last_delivery.changes() && inbox.get('u_key', operation)) {
            var own = JSON.parse(String(inbox.getValue('u_payload'))).fields || {};
            Object.keys(change).forEach(function (key) { if (own[key] === change[key]) delete change[key]; });
        }
        if (Object.keys(change).length) {
            var event = this.envelope(current, 'incident:' + recordId + ':' + current.getValue('sys_mod_count'), 'PATCH');
            event.fields = change; this.enqueue(event);
        }
    },
    captureJournal: function (journal) {
        if (!this.enabled() || journal.getValue('u_cato_sync_effect_key')) return;
        var element = String(journal.getValue('element'));
        if (['comments', 'work_notes'].indexOf(element) < 0) return;
        var incident = new GlideRecord('incident');
        if (!incident.get(String(journal.getValue('element_id'))) || !this.eligible(incident)) return;
        this.ledger(String(incident.getUniqueValue()));
        var event = this.envelope(incident, 'journal:' + journal.getUniqueValue(), 'JOURNAL');
        event.occurredAt = String(journal.getValue('sys_created_on')).replace(' ', 'T') + 'Z';
        event.journal = {id: String(journal.getUniqueValue()), body: String(journal.getValue('value') || ''),
            author: String(journal.getValue('sys_created_by') || 'unknown'), visibility: element === 'comments' ? 'PUBLIC' : 'PRIVATE'};
        this.enqueue(event);
    },
    receive: function (body) {
        CatoSyncRules.receiver(body, this.integration());
        if (!this.enabled()) throw new Error('INTEGRATION_PAUSED');
        if (GlideStringUtil.base64Encode(JSON.stringify(body)).length > 349528) throw new Error('PAYLOAD_TOO_LARGE');
        var state = new GlideRecord('u_cato_sync_state');
        if (!state.get('u_key', body.recordId)) throw new Error('RECORD_NOT_OWNED');
        var payload = CatoSyncRules.canonical(body);
        var inbox = new GlideRecord('u_cato_sync_inbox');
        if (inbox.get('u_key', body.deliveryId)) {
            if (String(inbox.getValue('u_payload')) !== payload) throw new Error('DELIVERY_ID_CONFLICT');
            return {deliveryId: body.deliveryId, result: 'DUPLICATE'};
        }
        var order = new GlideRecord('u_cato_sync_inbox');
        var streamKey = body.recordId + ':' + body.sequence;
        if (order.get('u_stream_key', streamKey)) throw new Error('SEQUENCE_CONFLICT');
        inbox.initialize(); inbox.setValue('u_key', body.deliveryId); inbox.setValue('u_stream_key', streamKey);
        inbox.setValue('u_record', body.recordId); inbox.setValue('u_sequence', body.sequence);
        inbox.setValue('u_payload', payload); inbox.setValue('u_state', 'PENDING'); inbox.setValue('u_attempts', 0);
        if (!inbox.insert()) {
            if (inbox.get('u_key', body.deliveryId) && String(inbox.getValue('u_payload')) === payload) return {deliveryId: body.deliveryId, result: 'DUPLICATE'};
            throw new Error('INBOX_INSERT_FAILED');
        }
        return {deliveryId: body.deliveryId, result: 'ACCEPTED'};
    },
    claim: function (table, id) {
        var key = gs.generateGUID();
        var row = new GlideRecord(table); row.addQuery('sys_id', id); row.addQuery('u_state', 'PENDING');
        row.addQuery('u_next_attempt', '<=', new GlideDateTime()).addOrCondition('u_next_attempt', '');
        row.setValue('u_state', 'PROCESSING'); row.setValue('u_claim', key);
        var lease = new GlideDateTime(); lease.addSeconds(90); row.setValue('u_lease_until', lease);
        row.updateMultiple();
        var claimed = new GlideRecord(table);
        return claimed.get(id) && String(claimed.getValue('u_claim')) === key ? claimed : null;
    },
    recoverClaims: function (table) {
        var rows = new GlideRecord(table); rows.addQuery('u_state', 'PROCESSING'); rows.addQuery('u_lease_until', '<', new GlideDateTime());
        rows.setValue('u_state', 'PENDING'); rows.setValue('u_claim', ''); rows.updateMultiple();
    },
    finish: function (row, values) {
        var fenced = new GlideRecord(row.getTableName());
        fenced.addQuery('sys_id', String(row.getUniqueValue())); fenced.addQuery('u_state', 'PROCESSING');
        fenced.addQuery('u_claim', String(row.getValue('u_claim')));
        Object.keys(values).forEach(function (key) { fenced.setValue(key, values[key]); });
        fenced.setValue('u_claim', ''); fenced.updateMultiple();
    },
    retry: function (row, reason, retryAfter) {
        var attempts = Number(row.getValue('u_attempts') || 0) + 1;
        var next = new GlideDateTime(); next.addSeconds(Math.max(retryAfter || 0, Math.min(900, 5 * Math.pow(2, attempts - 1))));
        this.finish(row, {u_attempts: attempts, u_error: reason, u_state: attempts >= 8 ? 'FAILED' : 'PENDING', u_next_attempt: next});
    },
    dispatch: function () {
        if (!this.enabled()) return;
        this.recoverClaims('u_cato_sync_outbox');
        var rows = new GlideRecord('u_cato_sync_outbox'); rows.addQuery('u_state', 'PENDING'); rows.orderBy('sys_created_on'); rows.setLimit(50); rows.query();
        while (rows.next()) {
            var row = this.claim('u_cato_sync_outbox', String(rows.getUniqueValue())); if (!row) continue;
            try {
                var url = this.property('gateway_url');
                if (!/^https:\/\/[a-zA-Z0-9.-]+\/graphql$/.test(url)) throw new Error('INVALID_GATEWAY_URL');
                var message = new sn_ws.RESTMessageV2(); message.setEndpoint(url); message.setHttpMethod('POST'); message.setHttpTimeout(20000);
                message.setRequestHeader('Content-Type', 'application/json');
                message.setRequestHeader('x-api-key', new GlideEncrypter().decrypt(this.property('api_key')));
                message.setRequestBody(JSON.stringify({query: 'mutation Accept($accountId: ID!, $event: SyncHubIngestEventInput!) { syncHub(accountId: $accountId) { ingestEvent(input: $event) { id result state } } }',
                    variables: {accountId: this.property('account_id'), event: JSON.parse(String(row.getValue('u_payload')))}}));
                var response = message.execute(); var status = response.getStatusCode();
                if (status < 200 || status >= 300) { this.retry(row, 'HUB_HTTP_' + status, Number(response.getHeader('Retry-After')) || 0); continue; }
                var result = JSON.parse(response.getBody());
                var accepted = result.data && result.data.syncHub && result.data.syncHub.ingestEvent;
                if (!accepted || ['ACCEPTED', 'DUPLICATE'].indexOf(accepted.result) < 0) { this.retry(row, 'HUB_NOT_ACCEPTED', 0); continue; }
                this.finish(row, {u_state: 'ACCEPTED', u_error: ''});
            } catch (error) { this.retry(row, 'DISPATCH_FAILED', 0); }
        }
    },
    apply: function (body, incident) {
        var state = this.ledger(body.recordId);
        var position = CatoSyncRules.transition(body.sequence, Number(state.getValue('u_next_sequence') || 1));
        if (position === 'WAIT') return false;
        if (position === 'DUPLICATE') return true;
        if (String(incident.getValue('u_cato_sync_last_delivery') || '') !== body.deliveryId) {
            if (body.kind === 'PATCH') {
                var current = {title: String(incident.getValue('short_description')), priority: Number(incident.getValue('priority')), state: this.state(incident)};
                Object.keys(body.fields).forEach(function (field) { if (current[field] !== body.expected[field]) throw new Error('FIELD_CONFLICT'); });
                if (body.fields.title !== undefined) incident.setValue('short_description', body.fields.title);
                if (body.fields.priority !== undefined) incident.setValue('priority', body.fields.priority);
                if (body.fields.state !== undefined) {
                    var profile = JSON.parse(this.property('state_profile'));
                    if (body.fields.state.indexOf('AWAITING_') === 0) { incident.setValue('state', profile.ON_HOLD); incident.setValue('hold_reason', profile[body.fields.state]); }
                    else { incident.setValue('state', profile[body.fields.state]); incident.setValue('hold_reason', ''); }
                    if (body.fields.state === 'RESOLVED') {
                        incident.setValue('close_code', this.property('resolution_code'));
                        incident.setValue('close_notes', 'Resolved by Cato Support (sandbox synchronization).');
                    }
                }
            }
            if (body.kind === 'JOURNAL') {
                var exact = new GlideRecord('sys_journal_field');
                if (!exact.get('u_cato_sync_effect_key', body.operationId)) {
                    incident.setValue('comments', body.journal.body);
                    gs.getSession().putClientData('cato_sync_journal_effect', body.operationId);
                }
            }
            incident.setValue('u_cato_sync_last_delivery', body.deliveryId);
            try { if (!incident.update()) throw new Error('LOCAL_UPDATE_FAILED'); }
            finally { gs.getSession().putClientData('cato_sync_journal_effect', ''); }
        }
        if (body.kind === 'LINK') state.setValue('u_ticket_id', body.ticketId);
        state.setValue('u_next_sequence', body.sequence + 1);
        if (!state.update()) throw new Error('LOCAL_STATE_UPDATE_FAILED');
        return true;
    },
    processInbox: function () {
        if (!this.enabled()) return;
        this.recoverClaims('u_cato_sync_inbox');
        var rows = new GlideRecord('u_cato_sync_inbox'); rows.addQuery('u_state', 'PENDING'); rows.orderBy('u_record'); rows.orderBy('u_sequence'); rows.setLimit(50); rows.query();
        while (rows.next()) {
            var state = this.ledger(String(rows.getValue('u_record')));
            if (Number(rows.getValue('u_sequence')) > Number(state.getValue('u_next_sequence'))) continue;
            var row = this.claim('u_cato_sync_inbox', String(rows.getUniqueValue())); if (!row) continue;
            try {
                var body = JSON.parse(String(row.getValue('u_payload')));
                var incident = new GlideRecord('incident');
                if (!incident.get(body.recordId) || !this.eligible(incident)) throw new Error('RECORD_NOT_OWNED');
                if (!this.apply(body, incident)) { this.finish(row, {u_state: 'PENDING'}); continue; }
                this.finish(row, {u_state: 'APPLIED', u_error: ''});
            } catch (error) {
                if (['FIELD_CONFLICT', 'RECORD_NOT_OWNED', 'UNSUPPORTED_TRANSITION'].indexOf(error.message) >= 0)
                    this.finish(row, {u_state: 'FAILED', u_error: error.message});
                else this.retry(row, 'LOCAL_APPLY_FAILED', 0);
            }
        }
    },
    type: 'CatoSyncHub'
};
