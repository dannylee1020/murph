import { escapeHtml, formatToday } from './format';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
    throw new Error('App root not found');
}

export const app = root;
let sidebarActiveSessionCount: number | undefined;

const navItems = [
    { href: '/', label: 'Home' },
    { href: '/review', label: 'Review' },
    { href: '/triage', label: 'Triage' },
    { href: '/activity', label: 'Activity' },
    { href: '/admin', label: 'Admin' },
];
type ProductSurface = 'team' | 'personal';
let productSurface: ProductSurface = 'team';

type ThemePreference = 'auto' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'murph_theme_preference';
const themePreferences: ThemePreference[] = ['auto', 'light', 'dark'];
const darkSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePreference(): ThemePreference {
    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        return themePreferences.includes(stored as ThemePreference)
            ? (stored as ThemePreference)
            : 'auto';
    } catch {
        return 'auto';
    }
}

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
    if (preference === 'auto') {
        return darkSchemeQuery.matches ? 'dark' : 'light';
    }
    return preference;
}

export function applyThemePreference(preference: ThemePreference): void {
    document.documentElement.dataset.theme = resolveTheme(preference);
}

export function setThemePreference(preference: ThemePreference): void {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
        // Theme persistence is best-effort; applying the theme still works for this page.
    }
    applyThemePreference(preference);
}

export function themeControlHtml(selected: ThemePreference): string {
    return `
    <div class="theme-control" role="group" aria-label="Theme">
      ${themePreferences
          .map(
              (preference) => `
            <button
              type="button"
              class="theme-option ${preference === selected ? 'active' : ''}"
              data-theme-preference="${preference}"
              aria-pressed="${preference === selected ? 'true' : 'false'}"
            >
              ${preference === 'auto' ? 'Auto' : preference === 'light' ? 'Light' : 'Dark'}
            </button>
          `,
          )
          .join('')}
    </div>
  `;
}

applyThemePreference(getThemePreference());
darkSchemeQuery.addEventListener('change', () => {
    if (getThemePreference() === 'auto') {
        applyThemePreference('auto');
    }
});

export function activeNavHref(pathname: string): string {
    if (pathname === '/settings') return '/admin';
    if (pathname === '/runs' || pathname === '/audit') return '/activity';
    return pathname;
}

export function routeSlug(pathname: string): string {
    if (pathname === '/') return 'home';
    return pathname.replace(/^\//, '').replace(/[^a-z0-9-]/gi, '-') || 'home';
}

export function setSidebarWatchingCount(count: number): void {
    sidebarActiveSessionCount = count;
}

export function setProductSurface(surface: ProductSurface): void {
    productSurface = surface;
}


export function consoleStateHtml(
    label: string,
    status: 'ok' | 'off' | 'warn',
): string {
    return `<span class="console-state"><span class="status-dot ${status}" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
}

export function sidebarWatchingStatusHtml(): string {
    const count = sidebarActiveSessionCount;
    const active = (count ?? 0) > 0;
    const label =
        count === undefined ? 'Checking' : active ? 'Watching' : 'Idle';
    const detail =
        count === undefined
            ? 'Session status'
            : count === 1
              ? '1 active session'
              : `${count} active sessions`;

    return `
    <div class="sidebar-watch-status" aria-label="${escapeHtml(`Watching status: ${label}`)}">
      <span class="status-dot ${active ? 'ok' : count === undefined ? 'warn' : 'off'}" aria-hidden="true"></span>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(detail)}</strong>
    </div>
  `;
}

export function shell(content: string): void {
    const pathname = window.location.pathname;
    const activeHref = activeNavHref(pathname);
    const slug = routeSlug(activeHref);
    const themePreference = getThemePreference();
    const visibleNavItems =
        productSurface === 'personal'
            ? navItems.filter((item) => item.href !== '/admin')
            : navItems;
    app.innerHTML = `
    <div class="app-shell route-${slug}">
      <aside class="sidebar">
        <a class="brand" href="/" data-link>
          <span class="brand-mark" aria-hidden="true"><img src="/img/murph-logo.svg" alt="" /></span>
          <span class="brand-wordmark">Murph</span>
        </a>
        <nav>
          ${visibleNavItems
              .map(
                  (item) => `
                <a href="${item.href}" data-link class="${activeHref === item.href ? 'active' : ''}">
                  ${item.label}
                </a>
              `,
              )
              .join('')}
        </nav>
        ${sidebarWatchingStatusHtml()}
        <div class="sidebar-foot">
          ${themeControlHtml(themePreference)}
          <span>Local console</span>
          <strong>${escapeHtml(formatToday())}</strong>
        </div>
      </aside>
      <main class="content" data-route="${slug}">${content}</main>
    </div>
  `;

    app.querySelectorAll<HTMLAnchorElement>('a[data-link]').forEach((link) => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            history.pushState(null, '', link.href);
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
    });

    app.querySelectorAll<HTMLButtonElement>('[data-theme-preference]').forEach(
        (button) => {
            button.addEventListener('click', () => {
                const preference = button.dataset.themePreference as
                    | ThemePreference
                    | undefined;
                if (!preference || !themePreferences.includes(preference))
                    return;
                setThemePreference(preference);
                window.dispatchEvent(new PopStateEvent('popstate'));
            });
        },
    );
}

export function loading(title: string): void {
    shell(
        `<section class="page-head"><p class="eyebrow">Murph</p><h1>${title}</h1><p>Loading...</p></section>`,
    );
}

export function errorView(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unknown error';
    shell(`
    <section class="page-head">
      <p class="eyebrow">Error</p>
      <h1>Something went wrong</h1>
      <p class="error">${escapeHtml(message)}</p>
    </section>
  `);
}
