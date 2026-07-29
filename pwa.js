(() => {
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;

    let refreshing = false;

    function showUpdate(registration) {
        if (document.getElementById('pwaUpdateNotice')) return;

        const notice = document.createElement('section');
        notice.id = 'pwaUpdateNotice';
        notice.className = 'pwa-update-notice';
        notice.setAttribute('role', 'status');
        notice.innerHTML = `
            <div>
                <strong>StudyIB update ready</strong>
                <span>Refresh when you are ready to use the latest version.</span>
            </div>
            <button type="button" class="button button-primary button-sm">Update</button>
            <button type="button" class="button button-ghost button-icon button-sm" aria-label="Dismiss update">&times;</button>
        `;

        const [updateButton, dismissButton] = notice.querySelectorAll('button');
        updateButton.addEventListener('click', () => registration.waiting?.postMessage({ type: 'SKIP_WAITING' }));
        dismissButton.addEventListener('click', () => notice.remove());
        document.body.appendChild(notice);
    }

    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            if (registration.waiting && navigator.serviceWorker.controller) showUpdate(registration);

            registration.addEventListener('updatefound', () => {
                const worker = registration.installing;
                worker?.addEventListener('statechange', () => {
                    if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(registration);
                });
            });
        } catch (error) {
            console.warn('StudyIB offline support could not be enabled.', error);
        }
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        location.reload();
    });
})();
