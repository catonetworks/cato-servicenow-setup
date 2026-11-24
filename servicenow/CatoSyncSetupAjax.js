var CatoSyncSetupAjax = Class.create();
CatoSyncSetupAjax.prototype = Object.extendsObject(AbstractAjaxProcessor, {
    isPublic: function () { return false; },
    execute: function () {
        if (!gs.hasRole('admin')) return JSON.stringify({errors: ['Administrator required.']});
        try {
            if (String(this.getParameter('sysparm_action')) === 'load') return JSON.stringify(new CatoSyncSetup().view());
            var text = String(this.getParameter('sysparm_config') || '{}');
            if (text.length > 32768) throw new Error('Invalid configuration');
            return JSON.stringify(new CatoSyncSetup().execute(String(this.getParameter('sysparm_action') || ''), JSON.parse(text), String(this.getParameter('sysparm_confirmed')) === 'true'));
        } catch (error) { return JSON.stringify({errors: ['Setup action failed. Reload and verify the saved settings.']}); }
    },
    type: 'CatoSyncSetupAjax'
});
