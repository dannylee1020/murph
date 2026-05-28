export function installRouter(render: () => Promise<void>): void {
    window.addEventListener('popstate', () => {
        void render();
    });

    void render();
}
