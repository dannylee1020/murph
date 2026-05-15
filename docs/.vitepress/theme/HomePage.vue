<template>
  <main class="murph-home">
    <section class="murph-hero">
      <div class="murph-hero-copy">
        <p class="murph-eyebrow">Operator-grade async coverage</p>
        <h1>Murph keeps the thread moving while you are away.</h1>
        <p class="murph-lede">
          A self-hosted autopilot for messaging channels, grounded in your local setup,
          connected context, and conservative policy.
        </p>
        <div class="murph-actions">
          <a class="murph-primary" href="/docs/quickstart">Read the quickstart</a>
          <a class="murph-secondary" href="/docs/cli-agent">Explore the CLI</a>
        </div>
      </div>

      <aside class="murph-run-panel" aria-label="Murph operating model">
        <div class="murph-panel-header">
          <span>Runbook</span>
          <span>local-first</span>
        </div>
        <ul>
          <li>Local runtime and local configuration</li>
          <li>Messenger continuity for Slack and Discord</li>
          <li>Policy profiles that keep auto-send conservative</li>
          <li>Scoped plugins for custom integrations</li>
        </ul>
      </aside>
    </section>

    <section class="murph-workflow" aria-labelledby="workflow-heading">
      <div class="murph-section-intro">
        <p class="murph-eyebrow">Workflow</p>
        <h2 id="workflow-heading">Built for handoff, not chatter.</h2>
      </div>
      <div class="murph-workflow-grid">
        <article>
          <span>01</span>
          <h3>Start coverage</h3>
          <p>Run setup, choose channels, and start a bounded Murph session before you go offline.</p>
        </article>
        <article>
          <span>02</span>
          <h3>Ground replies</h3>
          <p>Murph uses configured context sources, policy, and skills before drafting or queuing work.</p>
        </article>
        <article>
          <span>03</span>
          <h3>Review the trail</h3>
          <p>Come back to handled items, queued drafts, skipped work, and run evidence.</p>
        </article>
      </div>
    </section>

    <section class="murph-docs-band" aria-labelledby="docs-heading">
      <div>
        <p class="murph-eyebrow">Documentation</p>
        <h2 id="docs-heading">Start with the operator path.</h2>
      </div>
      <nav class="murph-doc-links" aria-label="Documentation links">
        <a href="/docs/installation/">Installation</a>
        <a href="/docs/configuration">Configuration</a>
        <a href="/docs/integrations">Integrations</a>
      </nav>
    </section>
  </main>
</template>
