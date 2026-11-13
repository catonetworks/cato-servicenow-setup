(function executeRule(current, previous) {
    try { new CatoSyncHub().captureJournal(current); }
    catch (error) { gs.error('[cato-sync] Journal capture failed: ' + current.getUniqueValue()); throw new Error('CATO_SYNC_CAPTURE_FAILED'); }
})(current, previous);
