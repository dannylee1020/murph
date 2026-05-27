import { render } from './render';

window.addEventListener('popstate', () => {
    void render();
});

void render();
