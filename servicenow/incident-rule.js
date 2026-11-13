(function executeRule(current, previous) {
    try { new CatoSyncHub().captureIncident(current, previous); }
    catch (error) {
        current.setAbortAction(true);
        gs.addErrorMessage('Sync Hub capture failed; the incident change was not saved.');
        gs.error('[cato-sync] Incident capture aborted: ' + current.getUniqueValue());
    }
})(current, previous);
