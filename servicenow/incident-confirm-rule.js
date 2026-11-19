(function executeRule(current, previous) {
    if (typeof catoSyncHubCaptureReceipts === 'undefined') return;
    var recordId = String(current.getUniqueValue());
    var outboxId = catoSyncHubCaptureReceipts[recordId];
    if (!outboxId) return;
    delete catoSyncHubCaptureReceipts[recordId];
    try { new CatoSyncHub().confirmIncident(current, outboxId); }
    catch (error) { gs.error('[cato-sync] Incident receipt failed: ' + recordId); }
})(current, previous);
