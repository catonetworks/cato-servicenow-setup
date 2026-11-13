(function executeRule(current, previous) {
    var marker = String(gs.getSession().getClientData('cato_sync_journal_effect') || '');
    if (marker && String(current.getValue('element')) === 'comments') current.setValue('u_cato_sync_effect_key', marker);
})(current, previous);
