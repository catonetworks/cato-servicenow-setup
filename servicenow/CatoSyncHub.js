var CatoSyncHub = Class.create();
CatoSyncHub.prototype = {
    initialize: function () {},
    property: function (name) { return String(gs.getProperty('cato_sync.' + name, '')); },
    gatewayKey: function () {
        var id = this.property('gateway_credential_id');
        if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('GATEWAY_CREDENTIAL_MISSING');
        var row = new GlideRecord('api_key_credentials');
        if (!row.get(id) || ['true', '1'].indexOf(String(row.getValue('active'))) < 0)
            throw new Error('GATEWAY_CREDENTIAL_DISABLED');
        var credential = new sn_cc.StandardCredentialsProvider().getCredentialByID(id);
        var key = credential && credential.getAttribute('api_key');
        if (!key) throw new Error('GATEWAY_CREDENTIAL_UNAVAILABLE');
        return String(key);
    },
    graphqlRequest: function (event) {
        var account = this.property('account_id');
        if (!/^[1-9][0-9]{0,18}$/.test(account) || (account.length === 19 && account > '9223372036854775807'))
            throw new Error('INVALID_ACCOUNT_ID');
        var query = 'mutation Accept($accountId: Int!, $event: SyncHubIngestEventInput!) { syncHub(accountId: $accountId) { ingestEvent(input: $event) { event { id result state } } } }';
        // Emit the validated integer token directly; Number would round large account IDs.
        return '{"query":' + JSON.stringify(query) + ',"variables":{"accountId":' + account + ',"event":' + JSON.stringify(event) + '}}';
    },
    enabled: function () { return this.property('enabled') === 'true'; },
    integration: function () { return this.property('integration_id'); },
    eligible: function (incident) {
        var group = this.property('assignment_group');
        if (!group || String(incident.getValue('assignment_group')) !== group) return false;
        var mode = this.property('capture_mode') || 'group-and-title';
        if (mode === 'group') return true;
        var prefix = this.property('title_prefix') || '[SYNC-HUB]';
        return mode === 'group-and-title' && String(incident.getValue('short_description') || '').indexOf(prefix) === 0;
    },
    state: function (incident) {
        var profile = JSON.parse(this.property('state_profile'));
        var state = String(incident.getValue('state'));
        if (state === String(profile.NEW)) return 'NEW';
        if (state === String(profile.IN_PROGRESS)) return 'IN_PROGRESS';
        if (state === String(profile.RESOLVED)) return 'RESOLVED';
        if (state === String(profile.CLOSED) && state === this.closedState(profile)) return 'CLOSED';
        if (state === String(profile.ON_HOLD)) {
            var reason = String(incident.getValue('hold_reason'));
            var names = ['AWAITING_CALLER', 'AWAITING_VENDOR', 'AWAITING_CHANGE'];
            for (var i = 0; i < names.length; i++) if (reason === String(profile[names[i]])) return names[i];
        }
        throw new Error('UNSUPPORTED_TRANSITION');
    },
    closedState: function (profile) {
        var value = String(profile.CLOSED);
        if (!/^-?\d+$/.test(value) || ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED'].some(function (name) {
            return String(profile[name]) === value;
        })) throw new Error('STATE_PROFILE_REQUIRED');
        return value;
    },
    source: function (incident) {
        return {instance: this.property('instance_origin'), table: 'incident', recordId: String(incident.getUniqueValue()), revision: Number(incident.getValue('sys_mod_count') || 0)};
    },
    timestamp: function () { return String(new GlideDateTime().getValue()).replace(' ', 'T') + 'Z'; },
    envelope: function (incident, id, kind) {
        return {schemaVersion: 1, integrationId: this.integration(), eventId: id, kind: kind, source: this.source(incident), occurredAt: this.timestamp()};
    },
    ledger: function (recordId) {
        var row = new GlideRecord('u_cato_sync_state');
        if (!row.get('u_key', recordId)) {
            row.initialize(); row.setValue('u_key', recordId); row.setValue('u_next_sequence', 1);
            if (!row.insert() && !row.get('u_key', recordId)) throw new Error('STATE_INSERT_FAILED');
        }
        return row;
    },
    enqueue: function (event, proofKind) {
        var payload = CatoSyncRules.canonical(event);
        if (String(GlideStringUtil.base64Encode(payload)).length > 327680) throw new Error('PAYLOAD_TOO_LARGE');
        var row = new GlideRecord('u_cato_sync_outbox');
        if (row.get('u_key', event.eventId)) {
            if (String(row.getValue('u_payload')) !== payload) throw new Error('EVENT_ID_CONFLICT');
            return String(row.getUniqueValue());
        }
        row.initialize(); row.setValue('u_key', event.eventId); row.setValue('u_record', event.source.recordId);
        row.setValue('u_payload', payload); row.setValue('u_state', 'PENDING'); row.setValue('u_attempts', 0);
        row.setValue('u_proof_kind', proofKind); row.setValue('u_revision', event.source.revision);
        var id = row.insert();
        if (!id) throw new Error('OUTBOX_INSERT_FAILED');
        return String(id);
    },
    captureIncident: function (current, previous) {
        if (current.isActionAborted()) return '';
        var recordId = String(current.getUniqueValue());
        if (!this.enabled() || !this.eligible(current)) {
            if (this.activeEffect(recordId)) throw new Error('RECORD_NOT_OWNED');
            return '';
        }
        var delivery = this.activeEffect(recordId);
        var state = this.ledger(recordId);
        var fields = {title: String(current.getValue('short_description')), priority: CatoSyncRules.priority(current.getValue('priority')), state: this.state(current)};
        var revision = current.operation() === 'insert' ? 0 : Number(previous.getValue('sys_mod_count') || 0) + 1;
        if (!state.getValue('u_create_event')) {
            if (fields.state !== 'NEW') throw new Error('INITIAL_STATE_NOT_SUPPORTED');
            var initial = this.envelope(current, 'create:' + gs.generateGUID(), 'CREATE');
            initial.source.revision = revision;
            fields.description = String(current.getValue('description') || '');
            initial.fields = fields;
            return this.enqueue(initial, 'INCIDENT_RECEIPT');
        }
        var change = {};
        if (current.short_description.changes()) change.title = fields.title;
        if (current.priority.changes()) change.priority = fields.priority;
        if (current.state.changes() || current.hold_reason.changes()) change.state = fields.state;
        if (change.state === 'CLOSED' && (!delivery || delivery.body.kind !== 'PATCH' || delivery.body.fields.state !== 'CLOSED'))
            throw new Error('UNSUPPORTED_TRANSITION');
        if (delivery && delivery.body.kind === 'PATCH') {
            this.requireExpectedFields(delivery.body, previous);
            var own = delivery.body.fields;
            Object.keys(change).forEach(function (key) { if (own[key] === change[key]) delete change[key]; });
        }
        if (!Object.keys(change).length) return '';
        var event = this.envelope(current, 'incident:' + gs.generateGUID(), 'PATCH');
        event.source.revision = revision;
        event.fields = change;
        return this.enqueue(event, 'INCIDENT_RECEIPT');
    },
    confirmIncident: function (current, outboxId) {
        if (!outboxId || current.isActionAborted()) return;
        var recordId = String(current.getUniqueValue());
        var row = new GlideRecord('u_cato_sync_outbox');
        if (!row.get(outboxId) || String(row.getValue('u_record')) !== recordId || row.getValue('u_proof_kind') !== 'INCIDENT_RECEIPT')
            throw new Error('SOURCE_RECEIPT_MISMATCH');
        var event = JSON.parse(String(row.getValue('u_payload')));
        if (!this.eligible(current) || !this.incidentFieldsMatch(current, event.fields)) throw new Error('SOURCE_EFFECT_MISMATCH');
        row.setValue('u_confirmed', true);
        if (!row.update()) throw new Error('SOURCE_RECEIPT_FAILED');
        if (event.kind === 'CREATE') {
            var state = new GlideRecord('u_cato_sync_state');
            state.addQuery('u_key', recordId);
            state.addNullQuery('u_create_event');
            state.setValue('u_create_event', event.eventId);
            state.updateMultiple();
        }
    },
    incidentFieldsMatch: function (incident, fields) {
        if (fields.title !== undefined && String(incident.getValue('short_description')) !== fields.title) return false;
        if (fields.priority !== undefined && Number(incident.getValue('priority')) !== fields.priority) return false;
        if (fields.state !== undefined && this.state(incident) !== fields.state) return false;
        return fields.description === undefined || String(incident.getValue('description') || '') === fields.description;
    },
    activeEffect: function (recordId) {
        var value = String(gs.getSession().getClientData('cato_sync_effect_' + recordId) || '');
        if (!value) return null;
        var context = value.split(':');
        if (context.length !== 2 || !context.every(function (id) { return /^[a-f0-9]{32}$/.test(id); })) throw new Error('LOCAL_EFFECT_UNCERTAIN');
        var row = new GlideRecord('u_cato_sync_inbox');
        if (!row.get(context[0]) || row.getValue('u_record') !== recordId || row.getValue('u_state') !== 'PROCESSING'
            || row.getValue('u_claim') !== context[1] || row.getValue('u_effect_claim') !== context[1]) throw new Error('LOCAL_EFFECT_UNCERTAIN');
        return {row: row, body: JSON.parse(String(row.getValue('u_payload')))};
    },
    captureJournal: function (journal) {
        if (journal.isActionAborted()) return;
        var element = String(journal.getValue('element'));
        if (['comments', 'work_notes'].indexOf(element) < 0) return;
        var recordId = String(journal.getValue('element_id'));
        if (!this.enabled()) {
            if (this.activeEffect(recordId)) throw new Error('INTEGRATION_PAUSED');
            return;
        }
        var receiver = this.activeEffect(recordId);
        var incident = new GlideRecord('incident');
        if (!incident.get(recordId) || !this.eligible(incident)) {
            if (receiver) throw new Error('RECORD_NOT_OWNED');
            return;
        }
        var id = String(journal.getUniqueValue());
        if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('JOURNAL_ID_MISSING');
        if (receiver && receiver.body.kind === 'JOURNAL' && element === 'comments') {
            if (String(journal.getValue('value') || '') !== receiver.body.journal.body) throw new Error('JOURNAL_CONTENT_MISMATCH');
            this.recordJournalEffect(receiver.row, id);
            return;
        }
        var event = this.envelope(incident, 'journal:' + id, 'JOURNAL');
        event.journal = {id: id, body: String(journal.getValue('value') || ''),
            author: String(journal.getValue('sys_created_by') || 'unknown'), visibility: element === 'comments' ? 'PUBLIC' : 'PRIVATE'};
        this.enqueue(event, 'JOURNAL_ROW');
    },
    recordJournalEffect: function (row, journalId) {
        var id = String(row.getUniqueValue());
        var reservation = new GlideRecord('u_cato_sync_inbox');
        reservation.addQuery('sys_id', id);
        reservation.addQuery('u_state', 'PROCESSING');
        reservation.addQuery('u_claim', String(row.getValue('u_claim')));
        reservation.addQuery('u_effect_claim', String(row.getValue('u_claim')));
        reservation.addNullQuery('u_journal_id');
        reservation.setValue('u_journal_id', journalId);
        reservation.updateMultiple();
        var stored = new GlideRecord('u_cato_sync_inbox');
        if (!stored.get(id) || String(stored.getValue('u_journal_id')) !== journalId) throw new Error('JOURNAL_EVIDENCE_WRITE_FAILED');
    },
    committedJournal: function (id, recordId, element, body) {
        var journal = new GlideRecord('sys_journal_field');
        return Boolean(id && journal.get(id)) && String(journal.getValue('element_id')) === recordId
            && String(journal.getValue('element')) === element && String(journal.getValue('value') || '') === body;
    },
    sourceCommitted: function (row, event) {
        if (String(row.getValue('u_key')) !== event.eventId || String(row.getValue('u_record')) !== event.source.recordId) return false;
        var proofKind = String(row.getValue('u_proof_kind') || '');
        if (proofKind === 'JOURNAL_ROW' && event.kind === 'JOURNAL') {
            var inbox = new GlideRecord('u_cato_sync_inbox');
            return !inbox.get('u_journal_id', event.journal.id) && this.committedJournal(event.journal.id, event.source.recordId,
                event.journal.visibility === 'PUBLIC' ? 'comments' : 'work_notes', event.journal.body);
        }
        if (proofKind !== 'INCIDENT_RECEIPT' || ['CREATE', 'PATCH'].indexOf(event.kind) < 0 || !this.flag(row.getValue('u_confirmed'))) return false;
        return event.kind !== 'CREATE' || this.isCreateEvent(event);
    },
    flag: function (value) { return value === true || ['1', 'true'].indexOf(String(value)) >= 0; },
    isCreateEvent: function (event) {
        var state = new GlideRecord('u_cato_sync_state');
        return state.get('u_key', event.source.recordId) && String(state.getValue('u_create_event')) === event.eventId;
    },
    createAccepted: function (recordId) {
        var state = new GlideRecord('u_cato_sync_state');
        if (!state.get('u_key', recordId) || !state.getValue('u_create_event')) return false;
        var initial = new GlideRecord('u_cato_sync_outbox');
        return initial.get('u_key', String(state.getValue('u_create_event'))) && initial.getValue('u_state') === 'ACCEPTED';
    },
    receive: function (body) {
        CatoSyncRules.receiver(body, this.integration());
        if (!this.enabled()) throw new Error('INTEGRATION_PAUSED');
        if (String(GlideStringUtil.base64Encode(JSON.stringify(body))).length > 349528) throw new Error('PAYLOAD_TOO_LARGE');
        var state = new GlideRecord('u_cato_sync_state');
        if (!state.get('u_key', body.recordId) || !state.getValue('u_create_event')) throw new Error('RECORD_NOT_OWNED');
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
        this.finish(row, {u_attempts: attempts, u_error: reason, u_state: attempts >= 8 ? (reason === 'LOCAL_EFFECT_UNCERTAIN' ? 'UNCERTAIN' : 'FAILED') : 'PENDING', u_next_attempt: next});
    },
    dispatch: function () {
        if (!this.enabled()) return;
        this.recoverClaims('u_cato_sync_outbox');
        var rows = new GlideRecord('u_cato_sync_outbox'); rows.addQuery('u_state', 'PENDING'); rows.orderBy('sys_created_on'); rows.orderBy('u_revision'); rows.orderBy('sys_id'); rows.setLimit(50); rows.query();
        while (rows.next()) {
            var row = this.claim('u_cato_sync_outbox', String(rows.getUniqueValue())); if (!row) continue;
            try {
                var event = JSON.parse(String(row.getValue('u_payload')));
                if (!this.sourceCommitted(row, event)) { this.retry(row, 'SOURCE_COMMIT_NOT_PROVEN', 5); continue; }
                if (event.kind !== 'CREATE' && !this.createAccepted(event.source.recordId)) { this.retry(row, 'CREATE_NOT_ACCEPTED', 5); continue; }
                var url = this.property('gateway_url');
                if (!/^https:\/\/[a-zA-Z0-9.-]+\/graphql$/.test(url)) throw new Error('INVALID_GATEWAY_URL');
                if (event.source.table !== 'incident') throw new Error('UNSUPPORTED_SOURCE_TABLE');
                event.source.table = 'INCIDENT';
                var message = new sn_ws.RESTMessageV2(); message.setEndpoint(url); message.setHttpMethod('POST'); message.setHttpTimeout(20000);
                message.setRequestHeader('Content-Type', 'application/json');
                message.setRequestHeader('x-api-key', this.gatewayKey());
                message.setRequestBody(this.graphqlRequest(event));
                var response = message.execute(); var status = response.getStatusCode();
                if (status < 200 || status >= 300) { this.retry(row, 'HUB_HTTP_' + status, Number(response.getHeader('Retry-After')) || 0); continue; }
                var result = JSON.parse(response.getBody());
                var accepted = result.data && result.data.syncHub && result.data.syncHub.ingestEvent && result.data.syncHub.ingestEvent.event;
                if (!accepted || ['ACCEPTED', 'DUPLICATE'].indexOf(accepted.result) < 0) { this.retry(row, 'HUB_NOT_ACCEPTED', 0); continue; }
                this.finish(row, {u_state: 'ACCEPTED', u_error: ''});
            } catch (error) { this.retry(row, 'DISPATCH_FAILED', 0); }
        }
    },
    requireExpectedFields: function (body, incident) {
        var current = {title: String(incident.getValue('short_description')), priority: Number(incident.getValue('priority')), state: this.state(incident)};
        Object.keys(body.fields).forEach(function (field) { if (current[field] !== body.expected[field]) throw new Error('FIELD_CONFLICT'); });
    },
    preparePatch: function (body, incident) {
        this.requireExpectedFields(body, incident);
        if (body.fields.title !== undefined) incident.setValue('short_description', body.fields.title);
        if (body.fields.priority !== undefined) {
            var priorities = JSON.parse(this.property('priority_profile'));
            var inputs = priorities[String(body.fields.priority)];
            if (!inputs || !inputs.impact || !inputs.urgency) throw new Error('PRIORITY_PROFILE_REQUIRED');
            incident.setValue('impact', inputs.impact); incident.setValue('urgency', inputs.urgency);
            incident.setValue('priority', body.fields.priority);
        }
        if (body.fields.state !== undefined) {
            var profile = JSON.parse(this.property('state_profile'));
            if (body.fields.state === 'CLOSED') this.closedState(profile);
            if (body.fields.state.indexOf('AWAITING_') === 0) { incident.setValue('state', profile.ON_HOLD); incident.setValue('hold_reason', profile[body.fields.state]); }
            else { incident.setValue('state', profile[body.fields.state]); incident.setValue('hold_reason', ''); }
            if (body.fields.state === 'RESOLVED') {
                incident.setValue('close_code', this.property('resolution_code'));
                incident.setValue('close_notes', 'Resolved by Cato Support (sandbox synchronization).');
            } else if (body.fields.state === 'CLOSED') {
                if (!incident.getValue('close_code')) incident.setValue('close_code', this.property('resolution_code'));
                if (!incident.getValue('close_notes')) incident.setValue('close_notes', 'Closed by Cato Support synchronization.');
            }
        }
    },
    effectReason: function (body) { return 'CATO_SYNC:' + body.operationId + ':' + body.deliveryId; },
    patchProof: function (body, field, value, actor) {
        var audit = new GlideRecord('sys_audit');
        audit.addQuery('tablename', 'incident');
        audit.addQuery('documentkey', body.recordId);
        audit.addQuery('reason', this.effectReason(body));
        audit.addQuery('user', actor);
        audit.addQuery('fieldname', field);
        audit.addQuery('newvalue', String(value));
        audit.setLimit(1);
        audit.query();
        return audit.next();
    },
    committedPatch: function (body, actor) {
        if (!actor) return false;
        var self = this;
        return Object.keys(body.fields).every(function (field) {
            var intended = body.fields[field];
            if (intended === body.expected[field]) return true;
            if (field === 'title') return self.patchProof(body, 'short_description', intended, actor);
            if (field === 'priority') return self.patchProof(body, 'priority', intended, actor);
            var profile = JSON.parse(self.property('state_profile'));
            if (intended.indexOf('AWAITING_') === 0) {
                return self.patchProof(body, 'hold_reason', profile[intended], actor)
                    && (body.expected.state.indexOf('AWAITING_') === 0 || self.patchProof(body, 'state', profile.ON_HOLD, actor));
            }
            return self.patchProof(body, 'state', profile[intended], actor);
        });
    },
    reserveEffect: function (row) {
        var id = String(row.getUniqueValue());
        var claim = String(row.getValue('u_claim'));
        var reserve = new GlideRecord('u_cato_sync_inbox');
        reserve.addQuery('sys_id', id);
        reserve.addQuery('u_state', 'PROCESSING');
        reserve.addQuery('u_claim', claim);
        reserve.addNullQuery('u_effect_claim');
        reserve.setValue('u_effect_claim', claim);
        reserve.setValue('u_effect_actor', String(gs.getUserName()));
        reserve.updateMultiple();
        var stored = new GlideRecord('u_cato_sync_inbox');
        if (!stored.get(id) || stored.getValue('u_effect_claim') !== claim || stored.getValue('u_claim') !== claim)
            throw new Error('LOCAL_EFFECT_UNCERTAIN');
    },
    applyEffect: function (body, incident, row) {
        var id = String(row.getUniqueValue());
        if (!row.getValue('u_effect_claim')) {
            if (body.kind === 'PATCH') {
                this.preparePatch(body, incident);
                if (Object.keys(body.fields).every(function (field) { return body.fields[field] === body.expected[field]; })) return;
            }
            // Once reserved, a restarted worker may verify this effect but cannot issue it again.
            this.reserveEffect(row);
            var key = 'cato_sync_effect_' + body.recordId;
            var session = gs.getSession();
            session.putClientData(key, id + ':' + row.getValue('u_claim'));
            try {
                if (body.kind === 'JOURNAL') incident.comments.setJournalEntry(body.journal.body);
                if (!incident.update(this.effectReason(body))) throw new Error('LOCAL_EFFECT_UNCERTAIN');
            } finally { session.clearClientData(key); }
        }
        var stored = new GlideRecord('u_cato_sync_inbox');
        if (!stored.get(id)) throw new Error('LOCAL_EFFECT_UNCERTAIN');
        var committed = body.kind === 'JOURNAL'
            ? this.committedJournal(String(stored.getValue('u_journal_id') || ''), body.recordId, 'comments', body.journal.body)
            : this.committedPatch(body, String(stored.getValue('u_effect_actor') || ''));
        if (!committed) throw new Error('LOCAL_EFFECT_UNCERTAIN');
    },
    apply: function (body, incident, row) {
        var state = this.ledger(body.recordId);
        var position = CatoSyncRules.transition(body.sequence, Number(state.getValue('u_next_sequence') || 1));
        if (position === 'WAIT') return false;
        if (position === 'DUPLICATE') return true;
        if (body.kind !== 'LINK') this.applyEffect(body, incident, row);
        var advance = new GlideRecord('u_cato_sync_state');
        advance.addQuery('u_key', body.recordId);
        advance.addQuery('u_next_sequence', body.sequence);
        if (body.kind === 'LINK') advance.setValue('u_ticket_id', body.ticketId);
        advance.setValue('u_next_sequence', body.sequence + 1);
        advance.updateMultiple();
        var updated = new GlideRecord('u_cato_sync_state');
        if (!updated.get('u_key', body.recordId) || Number(updated.getValue('u_next_sequence')) <= body.sequence)
            throw new Error('LOCAL_STATE_UPDATE_FAILED');
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
                if (!this.apply(body, incident, row)) { this.finish(row, {u_state: 'PENDING'}); continue; }
                this.finish(row, {u_state: 'APPLIED', u_error: ''});
            } catch (error) {
                if (['FIELD_CONFLICT', 'RECORD_NOT_OWNED', 'UNSUPPORTED_TRANSITION', 'LOCAL_EFFECT_MISMATCH', 'PRIORITY_PROFILE_REQUIRED', 'STATE_PROFILE_REQUIRED'].indexOf(error.message) >= 0)
                    this.finish(row, {u_state: 'FAILED', u_error: error.message});
                else if (error.message === 'LOCAL_EFFECT_UNCERTAIN') this.retry(row, 'LOCAL_EFFECT_UNCERTAIN', 0);
                else this.retry(row, 'LOCAL_APPLY_FAILED', 0);
            }
        }
    },
    type: 'CatoSyncHub'
};
