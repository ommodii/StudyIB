(function configureStudyIB() {
    const existingConfig = {
        contentBaseUrl: 'https://assets.ommodi.site',
        supabaseUrl: 'https://vlrrsyxfrrppukqyzfay.supabase.co',
        supabasePublishableKey: 'sb_publishable_URX7XpPhkcjO0WpSs1LDtQ_c5Fqbrjq',
        datasetVersion: '2026-07-28-v1',
        ...(window.STUDYIB_CONFIG || {})
    };
    const contentBaseUrl = String(existingConfig.contentBaseUrl || '').replace(/\/+$/, '');

    window.STUDYIB_CONFIG = {
        ...existingConfig,
        contentBaseUrl
    };

    window.resolveStudyIBContentUrl = function resolveStudyIBContentUrl(value) {
        if (typeof value !== 'string' || !value) return value;

        const normalizedPath = value.replace(/\\/g, '/');
        if (!contentBaseUrl || !normalizedPath.startsWith('Content/')) {
            return value;
        }

        return new URL(normalizedPath, `${contentBaseUrl}/`).href;
    };
})();
