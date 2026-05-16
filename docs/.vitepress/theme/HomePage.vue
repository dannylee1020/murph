<script setup lang="ts">
import { onMounted, ref } from 'vue';

const theme = ref<'light' | 'dark'>('light');
const installCommand = 'curl -fsSL https://murph-agent.com/install.sh | bash';

function syncThemeFromDocument() {
  if (typeof document === 'undefined') return;
  theme.value = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function toggleTheme() {
  if (typeof document === 'undefined') return;

  const nextTheme = theme.value === 'dark' ? 'light' : 'dark';
  document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  localStorage.setItem('vitepress-theme-appearance', nextTheme);
  theme.value = nextTheme;
}

async function copyCommand(command: string) {
  if (typeof navigator === 'undefined') return;
  await navigator.clipboard?.writeText(command);
}

onMounted(syncThemeFromDocument);
</script>

<template>
  <main class="murph-home">
    <div class="murph-frame">
      <nav class="murph-home-nav" aria-label="Murph home navigation">
        <a class="murph-brand" href="/">
          <span class="murph-mark" aria-hidden="true">
            <svg viewBox="0 0 40 32">
              <path d="M5 26V6l7.5 8L20 6v20l-7.5-8L5 26Z" />
              <path d="M20 26V6l7.5 8L35 6v20l-7.5-8L20 26Z" />
            </svg>
          </span>
          <span>Murph</span>
        </a>

        <div class="murph-home-actions">
          <a href="/docs/quickstart">Docs</a>
          <a class="murph-external-link" href="https://github.com/dannylee1020/murph">GitHub</a>
          <span class="murph-nav-divider" aria-hidden="true"></span>
          <span class="murph-theme-label">Theme</span>
          <button
            class="murph-theme-toggle"
            type="button"
            :aria-label="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
            @click="toggleTheme"
          >
            <svg v-if="theme === 'dark'" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20.2 14.2A7 7 0 0 1 9.8 3.8a8 8 0 1 0 10.4 10.4Z" />
            </svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2.5v2" />
              <path d="M12 19.5v2" />
              <path d="m4.6 4.6 1.4 1.4" />
              <path d="m18 18 1.4 1.4" />
              <path d="M2.5 12h2" />
              <path d="M19.5 12h2" />
              <path d="m4.6 19.4 1.4-1.4" />
              <path d="m18 6 1.4-1.4" />
            </svg>
          </button>
        </div>
      </nav>

      <section class="murph-hero" aria-labelledby="hero-heading">
        <div class="murph-hero-inner">
          <h1 id="hero-heading">Stay offline without losing momentum.</h1>
          <p class="murph-lede">
            Murph is a local-first handoff agent that watches selected channels,
            uses your context, and leaves every decision ready for review.
          </p>

          <div class="murph-install" aria-label="Install Murph">
            <button type="button" @click="copyCommand(installCommand)">
              <span class="murph-command-copy">
                <span class="murph-command-label">Install</span>
                <code><span>curl</span> -fsSL https://murph-agent.com/install.sh | bash</code>
              </span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="9" y="9" width="10" height="10" rx="1.5" />
                <path d="M6 15H5.5A1.5 1.5 0 0 1 4 13.5v-9A1.5 1.5 0 0 1 5.5 3h9A1.5 1.5 0 0 1 16 4.5V5" />
              </svg>
            </button>
            <button type="button" @click="copyCommand('murph agent')">
              <span class="murph-command-copy">
                <span class="murph-command-label">Start</span>
                <code><span>murph</span> agent</code>
              </span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="9" y="9" width="10" height="10" rx="1.5" />
                <path d="M6 15H5.5A1.5 1.5 0 0 1 4 13.5v-9A1.5 1.5 0 0 1 5.5 3h9A1.5 1.5 0 0 1 16 4.5V5" />
              </svg>
            </button>
          </div>
        </div>
      </section>

      <section class="murph-feature-grid" aria-label="Murph features">
        <article>
          <span class="murph-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 18V6h14v9H8Z" />
              <path d="M8 9.5h8" />
              <path d="M8 12.5h5.5" />
            </svg>
          </span>
          <h2>Channels</h2>
          <p>Connect Slack, Discord, and more. We watch so you can rest.</p>
        </article>
        <article>
          <span class="murph-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 21c-3.8-1.2-6.5-4.6-6.5-8.6V6.2L12 3.5l6.5 2.7v6.2c0 4-2.7 7.4-6.5 8.6Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </span>
          <h2>Policy</h2>
          <p>Define how Murph should handle alerts and requests conservatively.</p>
        </article>
        <article>
          <span class="murph-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M6.5 20V4h8l3 3v13Z" />
              <path d="M14.5 4v3h3" />
              <path d="M9 11h6" />
              <path d="M9 14h6" />
              <path d="M9 17h3.5" />
            </svg>
          </span>
          <h2>Context</h2>
          <p>Grounded in your repos, docs, runbooks, incidents, and decisions.</p>
        </article>
        <article>
          <span class="murph-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M7 21V5h3.2a2 2 0 0 1 3.6 0H17v16Z" />
              <path d="M10 5h4" />
              <path d="m9.2 13 2 2 4-4" />
            </svg>
          </span>
          <h2>Review</h2>
          <p>Get a clear morning digest with decisions, drafts, and open items.</p>
        </article>
        <article>
          <span class="murph-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path class="murph-icon-fill" d="M19.8 22.6L17.15 20H6.5q-2.3 0-3.9-1.6T1 14.5q0-1.92 1.19-3.42q1.19-1.51 3.06-1.93q.08-.2.15-.39q.1-.19.15-.41L1.4 4.2l1.4-1.4l18.4 18.4M6.5 18h8.65L7.1 9.95q-.05.28-.07.55q-.03.23-.03.5h-.5q-1.45 0-2.47 1.03Q3 13.05 3 14.5T4.03 17q1.02 1 2.47 1m15.1.75l-1.45-1.4q.43-.35.64-.81T21 15.5q0-1.05-.73-1.77q-.72-.73-1.77-.73H17v-2q0-2.07-1.46-3.54Q14.08 6 12 6q-.67 0-1.3.16q-.63.17-1.2.52L8.05 5.23q.88-.6 1.86-.92Q10.9 4 12 4q2.93 0 4.96 2.04Q19 8.07 19 11q1.73.2 2.86 1.5q1.14 1.28 1.14 3q0 1-.37 1.81q-.38.84-1.03 1.44m-6.77-6.72" />
            </svg>
          </span>
          <h2>Local-first</h2>
          <p>Self-hosted by default. Your data stays on your infrastructure.</p>
        </article>
        <article>
          <span class="murph-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M9 8V3" />
              <path d="M15 8V3" />
              <path d="M7 8h10a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1Z" />
              <path d="M12 17v4" />
            </svg>
          </span>
          <h2>Extensible</h2>
          <p>Extend with integrations, custom tools, and your own automations.</p>
        </article>
      </section>

      <footer class="murph-home-footer">
        <span>Apache 2.0 License</span>
        <a href="https://github.com/dannylee1020/murph">GitHub</a>
      </footer>
    </div>
  </main>
</template>
