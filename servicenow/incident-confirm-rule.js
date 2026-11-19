(function executeRule(current, previous) {
    if (typeof g_scratchpad === 'undefined' || !g_scratchpad.catoSyncOutboxId) return;
    var outboxId = g_scratchpad.catoSyncOutboxId;
    delete g_scratchpad.catoSyncOutboxId;
    try { new CatoSyncHub().confirmIncident(current, outboxId); }
    catch (error) { gs.error('[cato-sync] Incident receipt failed: ' + current.getUniqueValue()); }
})(current, previous);
