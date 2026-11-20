(function executeRule(current, previous) {
    try { new CatoSyncHub().captureJournal(current); }
    catch (error) {
        current.setAbortAction(true);
        gs.addErrorMessage('Sync Hub capture failed; the journal entry was not saved.');
        gs.error('[cato-sync] Journal capture aborted: ' + current.getUniqueValue());
    }
})(current, previous);
