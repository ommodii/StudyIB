(function configureStudyIB() {
    const existingConfig = {
        contentBaseUrl: 'https://assets.ommodi.site',
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
