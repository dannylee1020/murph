---
title: Contributing
description: Work on Murph locally and open focused pull requests.
---

# Contributing

Murph is a self-hosted Node and Vite runtime bundle. The full contribution guide lives in [`CONTRIBUTING.md`](https://github.com/dannylee1020/murph/blob/main/CONTRIBUTING.md).

## Local development

Install dependencies:

```bash
npm install
```

Run the server and UI:

```bash
npm run dev
```

Run checks:

```bash
npm run check
npm test
```

Run the docs build when docs change:

```bash
npm run docs
```

## Pull requests

Keep changes focused, include validation, and update docs for user-facing setup, runtime, policy, plugin, or CLI changes. Open an issue before large core/runtime changes.

## Extension points

Prefer existing extension points before changing Murph core:

- **Channels** add messaging surfaces.
- **Integrations** add external context and read-only tools.
- **Plugins** package local extensions.
- **Skills** describe source-specific runtime behavior.
- **Policies** control autonomy and review rules.
- **Providers** add model backends.
