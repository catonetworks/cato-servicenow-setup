(function executeRule(current, previous) {
    try { new CatoSyncHub().captureIncident(current, previous); }
    catch (error) { gs.error('[cato-sync] Incident capture failed: ' + current.getUniqueValue()); throw new Error('CATO_SYNC_CAPTURE_FAILED'); }
})(current, previous);
