import { renderDashboard } from '../../shared/ui/features/dashboard';
import {
    renderActivity,
    renderReview,
    renderTriage,
} from '../../shared/ui/features/operations';
import { renderSetup } from '../../shared/ui/features/setup';
import { getJson } from '../../shared/ui/shared/api';
import { errorView, setProductSurface } from '../../shared/ui/shared/shell';
import type { SetupStatusPayload } from '../../shared/ui/shared/types';

setProductSurface('personal');

export async function renderPersonal(): Promise<void> {
    try {
        const pathname = window.location.pathname;

        if (pathname === '/admin' || pathname === '/settings' || pathname === '/me') {
            history.replaceState(null, '', '/');
        }

        if (window.location.pathname === '/setup') {
            await renderSetup(renderPersonal);
            return;
        }

        const setupStatus =
            await getJson<SetupStatusPayload>('/api/setup/status');
        if (!setupStatus.userConfigured || !setupStatus.rolesReady) {
            history.replaceState(null, '', '/setup');
            await renderSetup(renderPersonal);
            return;
        }

        if (window.location.pathname === '/review') {
            await renderReview();
        } else if (window.location.pathname === '/triage') {
            await renderTriage();
        } else if (
            window.location.pathname === '/activity' ||
            window.location.pathname === '/runs' ||
            window.location.pathname === '/audit'
        ) {
            await renderActivity();
        } else {
            await renderDashboard();
        }
    } catch (error) {
        errorView(error);
    }
}
