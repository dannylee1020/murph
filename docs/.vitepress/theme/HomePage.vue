<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const copiedCommand = ref<string | null>(null);
const installCommand = 'curl -fsSL https://murph-agent.com/install.sh | bash';
const setupCommand = 'murph setup';
const quickstartCommand = `${installCommand}\n${setupCommand}`;
const terminalSection = ref<HTMLElement | null>(null);
const visibleTerminalLines = ref(0);
const activeTerminalLine = ref<number | null>(null);
const prefersReducedMotion = ref(false);
const terminalLines = [
  {
    time: '14:31:08',
    level: 'info',
    message: 'session started',
    detail: 'channel=#team-ops policy=default',
    tone: 'neutral',
  },
  {
    time: '14:31:08',
    level: 'recv',
    message: 'message received',
    detail: 'thread=4821',
    tone: 'accent',
  },
  {
    time: '14:31:08',
    level: 'ctx',
    message: 'context loaded',
    detail: 'sources=17 route=project',
    tone: 'accent',
  },
  {
    time: '14:31:08',
    level: 'tool',
    message: 'tool selected',
    detail: 'docs.search calls=2',
    tone: 'accent',
  },
  {
    time: '14:31:08',
    level: 'policy',
    message: 'reply allowed',
    detail: 'reason=session-policy',
    tone: 'success',
  },
  {
    time: '14:31:09',
    level: 'send',
    message: 'reply sent',
    detail: 'trace=true',
    tone: 'success',
  },
  {
    time: '14:31:09',
    level: 'audit',
    message: 'review ready',
    detail: 'run=8f2c',
    tone: 'accent',
  },
] as const;
type IconNode =
  | { tag: 'path'; d: string }
  | { tag: 'rect'; width: string; height: string; x: string; y: string; rx: string; ry: string }
  | { tag: 'line'; x1: string; x2: string; y1: string; y2: string };

const features = [
  {
    title: 'Selected team channels',
    body: 'Cover only the team channels you choose, with each session scoped before Murph starts watching.',
    icon: [
      { tag: 'path', d: 'M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z' },
    ] satisfies IconNode[],
  },
  {
    title: 'Powerful memory',
    body: 'Index connected sources efficiently, then route the right context and tools for each reply.',
    icon: [
      { tag: 'path', d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z' },
      { tag: 'path', d: 'M14 2v5a1 1 0 0 0 1 1h5' },
      { tag: 'path', d: 'M10 9H8' },
      { tag: 'path', d: 'M16 13H8' },
      { tag: 'path', d: 'M16 17H8' },
    ] satisfies IconNode[],
  },
  {
    title: 'By your rules',
    body: 'Define what Murph can answer, what it must queue, and when it should stay silent.',
    icon: [
      { tag: 'path', d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' },
      { tag: 'path', d: 'm9 12 2 2 4-4' },
    ] satisfies IconNode[],
  },
  {
    title: 'Clear review trail',
    body: 'See what was received, which context was used, what was sent, and what was skipped after every run.',
    icon: [
      { tag: 'rect', width: '8', height: '4', x: '8', y: '2', rx: '1', ry: '1' },
      { tag: 'path', d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' },
      { tag: 'path', d: 'm9 14 2 2 4-4' },
    ] satisfies IconNode[],
  },
  {
    title: 'Run anywhere',
    body: 'Run Murph on infrastructure your team controls, keeping credentials, memory, and logs on your side.',
    icon: [
      { tag: 'rect', width: '20', height: '8', x: '2', y: '2', rx: '2', ry: '2' },
      { tag: 'rect', width: '20', height: '8', x: '2', y: '14', rx: '2', ry: '2' },
      { tag: 'line', x1: '6', x2: '6.01', y1: '6', y2: '6' },
      { tag: 'line', x1: '6', x2: '6.01', y1: '18', y2: '18' },
    ] satisfies IconNode[],
  },
  {
    title: 'Incredibly flexible',
    body: 'Need something? Ask Murph to build it, from tools and channels to workflows tailored to your team.',
    icon: [
      { tag: 'path', d: 'M12 22v-5' },
      { tag: 'path', d: 'M15 8V2' },
      { tag: 'path', d: 'M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z' },
      { tag: 'path', d: 'M9 8V2' },
    ] satisfies IconNode[],
  },
] as const;
let hadDarkTheme = false;
let copiedResetTimer: ReturnType<typeof setTimeout> | undefined;
let terminalRevealTimer: ReturnType<typeof setTimeout> | undefined;
let terminalActiveTimer: ReturnType<typeof setTimeout> | undefined;
let terminalObserver: IntersectionObserver | undefined;
let motionQuery: MediaQueryList | undefined;
let removeMotionListener: (() => void) | undefined;

function forceLandingLightTheme() {
  if (typeof document === 'undefined') return;
  hadDarkTheme = document.documentElement.classList.contains('dark');
  document.documentElement.classList.remove('dark');
}

function clearTerminalRevealTimer() {
  if (terminalRevealTimer) {
    window.clearTimeout(terminalRevealTimer);
    terminalRevealTimer = undefined;
  }
  if (terminalActiveTimer) {
    window.clearTimeout(terminalActiveTimer);
    terminalActiveTimer = undefined;
  }
  activeTerminalLine.value = null;
}

function revealTerminalLines() {
  if (typeof window === 'undefined') return;
  if (prefersReducedMotion.value) {
    visibleTerminalLines.value = terminalLines.length;
    activeTerminalLine.value = null;
    return;
  }
  if (terminalRevealTimer || visibleTerminalLines.value > 0) return;

  const revealNext = () => {
    visibleTerminalLines.value += 1;
    activeTerminalLine.value = visibleTerminalLines.value - 1;

    if (terminalActiveTimer) window.clearTimeout(terminalActiveTimer);
    terminalActiveTimer = window.setTimeout(() => {
      activeTerminalLine.value = null;
      terminalActiveTimer = undefined;
    }, 320);

    if (visibleTerminalLines.value < terminalLines.length) {
      terminalRevealTimer = window.setTimeout(revealNext, 1100);
    } else {
      terminalRevealTimer = window.setTimeout(() => {
        visibleTerminalLines.value = 0;
        activeTerminalLine.value = null;
        terminalRevealTimer = window.setTimeout(() => {
          terminalRevealTimer = undefined;
          revealNext();
        }, 450);
      }, 2200);
    }
  };

  revealNext();
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

onMounted(() => {
  forceLandingLightTheme();

  if (typeof window === 'undefined') return;

  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  prefersReducedMotion.value = motionQuery.matches;
  if (prefersReducedMotion.value) visibleTerminalLines.value = terminalLines.length;

  const handleMotionChange = (event: MediaQueryListEvent) => {
    prefersReducedMotion.value = event.matches;
    if (event.matches) {
      clearTerminalRevealTimer();
      visibleTerminalLines.value = terminalLines.length;
    }
  };

  if (typeof motionQuery.addEventListener === 'function') {
    motionQuery.addEventListener('change', handleMotionChange);
    removeMotionListener = () => motionQuery?.removeEventListener('change', handleMotionChange);
  } else {
    motionQuery.addListener(handleMotionChange);
    removeMotionListener = () => motionQuery?.removeListener(handleMotionChange);
  }

  if (prefersReducedMotion.value) return;

  if (!terminalSection.value || typeof IntersectionObserver === 'undefined') {
    revealTerminalLines();
    return;
  }

  terminalObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        revealTerminalLines();
        terminalObserver?.disconnect();
        terminalObserver = undefined;
        break;
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.3 },
  );

  terminalObserver.observe(terminalSection.value);
});

onBeforeUnmount(() => {
  if (copiedResetTimer) window.clearTimeout(copiedResetTimer);
  clearTerminalRevealTimer();
  terminalObserver?.disconnect();
  terminalObserver = undefined;
  removeMotionListener?.();
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

      <section ref="terminalSection" class="murph-hero" aria-labelledby="hero-heading">
        <div class="murph-hero-inner">
          <div class="murph-hero-copy">
            <h1 id="hero-heading">Keep work moving while offline.</h1>
            <p class="murph-lede">
              private, extensible agent for the channels you choose
            </p>
          </div>

          <div class="murph-terminal murph-hero-terminal" aria-label="Murph sequential log output">
            <ol class="murph-terminal-lines">
              <li
                v-for="(line, index) in terminalLines"
                :key="`${line.level}-${index}`"
                :class="[
                  'murph-terminal-line',
                  `is-${line.tone}`,
                  {
                    'is-visible': index < visibleTerminalLines,
                    'is-pending': !prefersReducedMotion && index >= visibleTerminalLines,
                    'is-active': !prefersReducedMotion && index === activeTerminalLine,
                  },
                ]"
              >
                <span class="murph-terminal-time">{{ line.time }}</span>
                <span class="murph-terminal-level">{{ line.level }}</span>
                <span class="murph-terminal-message">
                  <strong>{{ line.message }}</strong>
                  <code>{{ line.detail }}</code>
                </span>
              </li>
            </ol>
          </div>
        </div>

        <div class="murph-hero-install">
          <div class="murph-install" aria-label="Install Murph">
            <button
              type="button"
              :class="{ 'is-copied': copiedCommand === quickstartCommand }"
              :aria-label="copiedCommand === quickstartCommand ? 'Copied install and setup commands' : 'Copy install and setup commands'"
              @click="copyCommand(quickstartCommand)"
            >
              <span class="murph-editor-copy">
                <span class="murph-editor-line">
                  <span class="murph-editor-number" aria-hidden="true">1</span>
                  <code><span>curl</span> <em>-fsSL</em> <strong>https://<wbr>murph-agent.com/<wbr>install.sh</strong> <em>|</em> <span>bash</span></code>
                </span>
                <span class="murph-editor-line">
                  <span class="murph-editor-number" aria-hidden="true">2</span>
                  <code><span>murph</span> <strong>setup</strong></code>
                </span>
              </span>
              <svg v-if="copiedCommand === quickstartCommand" viewBox="0 0 24 24" aria-hidden="true">
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

      <section class="murph-features-section" aria-label="Features">
        <ul class="murph-features-list">
          <li v-for="feature in features" :key="feature.title">
            <svg class="murph-feature-icon" viewBox="0 0 24 24" aria-hidden="true">
              <template v-for="node in feature.icon" :key="JSON.stringify(node)">
                <path v-if="node.tag === 'path'" :d="node.d" />
                <rect
                  v-else-if="node.tag === 'rect'"
                  :width="node.width"
                  :height="node.height"
                  :x="node.x"
                  :y="node.y"
                  :rx="node.rx"
                  :ry="node.ry"
                />
                <line
                  v-else
                  :x1="node.x1"
                  :x2="node.x2"
                  :y1="node.y1"
                  :y2="node.y2"
                />
              </template>
            </svg>
            <div class="murph-feature-copy">
              <h3>{{ feature.title }}</h3>
              <p>{{ feature.body }}</p>
            </div>
          </li>
        </ul>
      </section>

      <footer class="murph-home-footer">
        <div class="murph-footer-brand">
          <span>Murph</span>
          <span class="murph-footer-dot" aria-hidden="true">·</span>
          <span class="murph-home-license">Apache 2.0 License</span>
        </div>
        <div class="murph-footer-links">
          <a href="/docs/quickstart">Docs</a>
          <a href="https://github.com/dannylee1020/murph">GitHub</a>
        </div>
      </footer>
    </div>
  </main>
</template>
