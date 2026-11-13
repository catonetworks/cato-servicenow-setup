var CatoSyncRules = {
    version: 1,
    fields: ['title', 'priority', 'state'],
    priority: function (value) {
        var n = Number(value);
        if (n < 1 || n > 5 || Math.floor(n) !== n) throw new Error('INVALID_PRIORITY');
        return n;
    },
    identifier: function (value) {
        return typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,200}$/.test(value);
    },
    receiver: function (body, integrationId) {
        if (!body || body.schemaVersion !== 1 || body.integrationId !== integrationId) throw new Error('INVALID_ENVELOPE');
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.deliveryId || '') || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.operationId || '')
            || !/^[a-f0-9]{32}$/.test(body.recordId || '') || (typeof body.sequence !== 'number' || Math.floor(body.sequence) !== body.sequence || body.sequence > 9007199254740991) || body.sequence < 1) throw new Error('INVALID_IDENTITY');
        var allowed = ['schemaVersion', 'integrationId', 'deliveryId', 'operationId', 'recordId', 'sequence', 'kind'];
        if (body.kind === 'LINK') {
            allowed.push('ticketId');
            if (!/^[1-9][0-9]*$/.test(body.ticketId || '')) throw new Error('INVALID_TICKET_ID');
        } else if (body.kind === 'PATCH') {
            allowed.push('fields', 'expected');
            if (!body.fields || !body.expected || !Object.keys(body.fields).length) throw new Error('INVALID_PATCH');
            Object.keys(body.fields).forEach(function (field) {
                if (CatoSyncRules.fields.indexOf(field) < 0 || body.fields[field] === null || body.expected[field] === undefined) throw new Error('INVALID_FIELD');
                if (field === 'priority') {
                    if (typeof body.fields[field] !== 'number' || typeof body.expected[field] !== 'number') throw new Error('INVALID_PRIORITY');
                    CatoSyncRules.priority(body.fields[field]); CatoSyncRules.priority(body.expected[field]);
                }
                if (body.expected[field] === null || typeof body.expected[field] !== typeof body.fields[field]) throw new Error('INVALID_EXPECTATION');
                if (field === 'title' && (typeof body.fields[field] !== 'string' || !body.fields[field].trim() || body.fields[field].length > 160)) throw new Error('INVALID_TITLE');
                if (field === 'state' && ['IN_PROGRESS', 'AWAITING_CALLER', 'AWAITING_VENDOR', 'AWAITING_CHANGE', 'RESOLVED'].indexOf(body.fields[field]) < 0) throw new Error('UNSUPPORTED_TRANSITION');
            });
            if (Object.keys(body.expected).some(function (key) { return !Object.prototype.hasOwnProperty.call(body.fields, key); })) throw new Error('INVALID_FIELD');
        } else if (body.kind === 'JOURNAL') {
            allowed.push('journal');
            if (!body.journal || !CatoSyncRules.identifier(body.journal.id) || typeof body.journal.body !== 'string' || !body.journal.body.trim()
                || Object.keys(body.journal).some(function (key) { return ['id', 'body'].indexOf(key) < 0; })) throw new Error('INVALID_JOURNAL');
        } else throw new Error('UNSUPPORTED_OPERATION');
        if (Object.keys(body).some(function (key) { return allowed.indexOf(key) < 0; })) throw new Error('INVALID_FIELD');
        return body;
    },
    canonical: function (value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(CatoSyncRules.canonical).join(',') + ']';
        return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + CatoSyncRules.canonical(value[key]); }).join(',') + '}';
    },
    transition: function (sequence, next) { return sequence < next ? 'DUPLICATE' : sequence === next ? 'READY' : 'WAIT'; }
};
