<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const copiedCommand = ref<string | null>(null);
const installCommand = 'curl -fsSL https://murph-agent.com/install.sh | bash';
let hadDarkTheme = false;
let copiedResetTimer: ReturnType<typeof setTimeout> | undefined;

function forceLandingLightTheme() {
  if (typeof document === 'undefined') return;
  hadDarkTheme = document.documentElement.classList.contains('dark');
  document.documentElement.classList.remove('dark');
}

async function copyCommand(command: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;

  await navigator.clipboard.writeText(command);
  copiedCommand.value = command;

  if (copiedResetTimer) window.clearTimeout(copiedResetTimer);
  copiedResetTimer = window.setTimeout(() => {
    copiedCommand.value = null;
  }, 900);
}

onMounted(forceLandingLightTheme);

onBeforeUnmount(() => {
  if (copiedResetTimer) window.clearTimeout(copiedResetTimer);
  if (typeof document !== 'undefined' && hadDarkTheme) {
    document.documentElement.classList.add('dark');
  }
});
</script>

<template>
  <main class="murph-home">
    <div class="murph-frame">
      <nav class="murph-home-nav" aria-label="Murph home navigation">
        <a class="murph-brand" href="/">
          <span class="murph-mark" aria-hidden="true">
            <img src="/img/murph-logo.svg" alt="" />
          </span>
          <span>Murph</span>
        </a>

        <div class="murph-home-actions">
          <a href="/docs/quickstart">Docs</a>
          <a class="murph-external-link" href="https://github.com/dannylee1020/murph">GitHub</a>
        </div>
      </nav>

      <section class="murph-hero" aria-labelledby="hero-heading">
        <div class="murph-hero-inner">
          <h1 id="hero-heading">Agent for teams across time zones.</h1>
          <p class="murph-lede">
            A private, extensible agent that lives on your server, uses your context, and covers for your team while offline.
          </p>

          <div class="murph-install" aria-label="Install Murph">
            <button
              type="button"
              :class="{ 'is-copied': copiedCommand === installCommand }"
              :aria-label="copiedCommand === installCommand ? 'Copied install command' : 'Copy install command'"
              @click="copyCommand(installCommand)"
            >
              <span class="murph-command-copy">
                <span class="murph-command-label">Install</span>
                <code><span>curl</span> -fsSL https://<wbr>murph-agent.com/<wbr>install.sh | bash</code>
              </span>
              <svg v-if="copiedCommand === installCommand" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m5 12.5 4.2 4.2L19 7" />
              </svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                <rect x="9" y="9" width="10" height="10" rx="1.5" />
                <path d="M6 15H5.5A1.5 1.5 0 0 1 4 13.5v-9A1.5 1.5 0 0 1 5.5 3h9A1.5 1.5 0 0 1 16 4.5V5" />
              </svg>
            </button>
            <button
              type="button"
              :class="{ 'is-copied': copiedCommand === 'murph setup' }"
              :aria-label="copiedCommand === 'murph setup' ? 'Copied setup command' : 'Copy setup command'"
              @click="copyCommand('murph setup')"
            >
              <span class="murph-command-copy">
                <span class="murph-command-label">Set up</span>
                <code><span>murph</span> setup</code>
              </span>
              <svg v-if="copiedCommand === 'murph setup'" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m5 12.5 4.2 4.2L19 7" />
              </svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true">
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
          <p>Cover selected team channels from one controlled runtime host.</p>
        </article>
        <article>
          <span class="murph-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 21c-3.8-1.2-6.5-4.6-6.5-8.6V6.2L12 3.5l6.5 2.7v6.2c0 4-2.7 7.4-6.5 8.6Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </span>
          <h2>Policy</h2>
          <p>Set what Murph can answer, what it must queue, and when it should stay silent.</p>
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
          <p>Use team docs, repos, runbooks, and tools so replies are grounded in shared work.</p>
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
          <p>Come back to what was sent, queued, skipped, and why.</p>
        </article>
        <article>
          <span class="murph-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="5" y="4" width="14" height="5" rx="1.5" />
              <rect x="5" y="10" width="14" height="5" rx="1.5" />
              <rect x="5" y="16" width="14" height="4" rx="1.5" />
              <path d="M8 6.5h.01" />
              <path d="M8 12.5h.01" />
              <path d="M8 18h.01" />
              <path d="M11 6.5h5" />
              <path d="M11 12.5h5" />
              <path d="M11 18h5" />
            </svg>
          </span>
          <h2>Self-hosted</h2>
          <p>Run on a VPS, managed container service, or server you control. State, memory, config, and credentials stay yours.</p>
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
          <p>Add channels, integrations, tools, and workflows as your work changes.</p>
        </article>
      </section>

      <footer class="murph-home-footer">
        <span>Apache 2.0 License</span>
        <a href="https://github.com/dannylee1020/murph">GitHub</a>
      </footer>
    </div>
  </main>
</template>
