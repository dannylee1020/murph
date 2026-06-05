import { renderSettings } from './features/admin';
import { renderDashboard } from './features/dashboard';
import {
    renderActivity,
    renderReview,
    renderTriage,
} from './features/operations';
import { renderSetup } from './features/setup';
import { getJson } from './lib/api';
import { errorView } from './lib/shell';
import { adminChannelWorkspaces } from './lib/workspaces';
import type { SetupStatusPayload } from './lib/types';

export async function renderMurph(): Promise<void> {
    try {
        const pathname = window.location.pathname;

        if (pathname === '/setup') {
            await renderSetup(renderMurph);
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
            await renderSetup(renderMurph);
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
