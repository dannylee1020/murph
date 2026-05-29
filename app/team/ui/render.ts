import { renderSettings } from '../../../shared/ui/features/admin';
import { renderDashboard } from '../../../shared/ui/features/dashboard';
import {
    renderActivity,
    renderReview,
    renderTriage,
} from '../../../shared/ui/features/operations';
import { renderMe } from '../../../shared/ui/features/me';
import { renderSetup } from '../../../shared/ui/features/setup';
import { getJson } from '../../../shared/ui/shared/api';
import { captureDashboardTokenFromUrl } from '../../../shared/ui/shared/access';
import { errorView, setProductSurface } from '../../../shared/ui/shared/shell';
import { adminChannelWorkspaces } from '../../../shared/ui/shared/workspaces';
import type { SetupStatusPayload } from '../../../shared/ui/shared/types';

setProductSurface('team');

export async function renderTeam(): Promise<void> {
    try {
        const pathname = window.location.pathname;

        if (pathname === '/me') {
            captureDashboardTokenFromUrl();
            await renderMe();
            return;
        }

        if (pathname === '/setup') {
            await renderSetup(renderTeam);
            return;
        }

        if (pathname === '/admin' || pathname === '/settings') {
            await renderSettings();
            return;
        }

        const setupStatus =
            await getJson<SetupStatusPayload>('/api/setup/status');
        if (
            adminChannelWorkspaces(setupStatus).length === 0 ||
            !setupStatus.userConfigured ||
            !setupStatus.rolesReady
        ) {
            history.replaceState(null, '', '/setup');
            await renderSetup(renderTeam);
            return;
        }

        if (pathname === '/review') {
            await renderReview();
        } else if (pathname === '/triage') {
            await renderTriage();
        } else if (
            pathname === '/activity' ||
            pathname === '/runs' ||
            pathname === '/audit'
        ) {
            await renderActivity();
        } else {
            await renderDashboard();
        }
    } catch (error) {
        errorView(error);
    }
}
