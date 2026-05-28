const SUBSCRIBER_TOKEN_KEY = 'murph_subscriber_dashboard_token';

export function dashboardToken(): string {
    return localStorage.getItem(SUBSCRIBER_TOKEN_KEY) ?? '';
}

export function setDashboardToken(token: string): void {
    localStorage.setItem(SUBSCRIBER_TOKEN_KEY, token);
}

export function clearDashboardToken(): void {
    localStorage.removeItem(SUBSCRIBER_TOKEN_KEY);
}

export function captureDashboardTokenFromUrl(): boolean {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('token');
    if (!token) return false;
    setDashboardToken(token);
    url.searchParams.delete('token');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    return true;
}

export function apiAuthHeaders(path: string): Record<string, string> {
    if (!path.startsWith('/api/me/')) return {};
    const token = dashboardToken();
    return token ? { authorization: `Bearer ${token}` } : {};
}
