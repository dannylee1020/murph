export function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

export function setTitle(title: string): void {
    document.title = title;
}

export function formatToday(): string {
    return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    }).format(new Date());
}

export function formatSessionStatus(activeCount: number): string {
    if (activeCount === 0) return 'Standing by';
    if (activeCount === 1) return '1 session active';
    return `${activeCount} sessions active`;
}

export function formatRelative(iso: string | undefined | null): string {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 0) {
        const abs = Math.abs(diff);
        if (abs < 60) return 'in a moment';
        if (abs < 3600) return `in ${Math.floor(abs / 60)}m`;
        if (abs < 86400) return `in ${Math.floor(abs / 3600)}h`;
        return formatDateTime(iso);
    }
    if (diff < 10) return 'just now';
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Intl.DateTimeFormat(undefined, {
        day: 'numeric',
        month: 'short',
    }).format(date);
}

export function formatDateTime(iso: string | undefined | null): string {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
    }).format(date);
}

export function formatExactIso(iso: string | undefined | null): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
    }).format(date);
}

export function titleCase(value: string): string {
    return value
        .replace(/[_.]/g, ' ')
        .replace(/\b\w/g, (ch) => ch.toUpperCase());
}
