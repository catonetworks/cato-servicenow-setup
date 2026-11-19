// The synchronous after rule consumes this receipt in the same transaction.
var catoSyncHubCaptureReceipts = typeof catoSyncHubCaptureReceipts === 'undefined'
    ? Object.create(null) : catoSyncHubCaptureReceipts;

(function executeRule(current, previous) {
    var recordId = String(current.getUniqueValue());
    delete catoSyncHubCaptureReceipts[recordId];
    try {
        var id = new CatoSyncHub().captureIncident(current, previous);
        if (id) catoSyncHubCaptureReceipts[recordId] = id;
    }
    catch (error) {
        current.setAbortAction(true);
        gs.addErrorMessage('Sync Hub capture failed; the incident change was not saved.');
        gs.error('[cato-sync] Incident capture aborted: ' + recordId);
    }
})(current, previous);
