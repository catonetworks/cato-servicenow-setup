(function executeRule(current, previous) {
    try {
        var id = new CatoSyncHub().captureIncident(current, previous);
        if (id) g_scratchpad.catoSyncOutboxId = id;
    }
    catch (error) {
        current.setAbortAction(true);
        gs.addErrorMessage('Sync Hub capture failed; the incident change was not saved.');
        gs.error('[cato-sync] Incident capture aborted: ' + current.getUniqueValue());
    }
})(current, previous);
