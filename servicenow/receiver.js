(function process(request, response) {
    response.setHeader('Content-Type', 'application/json');
    if (String(gs.getUserID()) !== String(gs.getProperty('cato_sync.receiver_user', '')) || !gs.hasRole('cato_sync.receiver') || String(request.getHeader('Authorization') || '').indexOf('Bearer ') !== 0) {
        response.setStatus(403); response.setBody({code: 'FORBIDDEN'}); return;
    }
    try {
        if (Number(request.getHeader('Content-Length') || 0) > 262144) { response.setStatus(413); response.setBody({code: 'PAYLOAD_TOO_LARGE'}); return; }
        response.setBody(new CatoSyncHub().receive(request.body.data)); response.setStatus(202);
    } catch (error) {
        var conflict = ['DELIVERY_ID_CONFLICT', 'SEQUENCE_CONFLICT'].indexOf(error.message) >= 0;
        response.setStatus(conflict ? 409 : error.message === 'INTEGRATION_PAUSED' ? 503 : 400);
        response.setBody({code: conflict ? error.message : 'RECEIVER_REJECTED'});
    }
})(request, response);
