(function verify() {
    var result = new CatoSyncSetup().execute('validate');
    gs.info(JSON.stringify(result));
    if (result.errors.length) throw new Error('CATO_SYNC_VERIFICATION_FAILED');
})();
