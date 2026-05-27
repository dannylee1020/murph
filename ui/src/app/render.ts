import { renderSettings } from '../features/admin';
import { renderDashboard } from '../features/dashboard';
import {
    renderActivity,
    renderReview,
    renderTriage,
} from '../features/operations';
import { renderSetup } from '../features/setup';
import { getJson } from '../shared/api';
import { errorView } from '../shared/shell';
import { adminChannelWorkspaces } from '../shared/workspaces';
import type { SetupStatusPayload } from '../shared/types';

export async function render(): Promise<void> {
    try {
        const pathname = window.location.pathname;

        if (pathname === '/setup') {
            await renderSetup(render);
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
            await renderSetup(render);
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
