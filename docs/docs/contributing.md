---
title: Contributing
description: Work on Murph locally and understand the main extension points.
---

# Contributing

Murph is a local-first Node and Vite app.

## Local development

Install dependencies:

```bash
npm install
```

Run the server and UI:

```bash
npm run dev:server
npm run dev
```

Run checks:

```bash
npm run check
npm test
```

## Extension points

- **Channels** add messaging surfaces.
- **Integrations** add external context and read-only tools.
- **Skills** describe request-specific behavior.
- **Policies** control autonomy and review rules.
- **Providers** add model backends.

## Pull requests

Open an issue before non-trivial changes. Keep changes focused, include validation, and avoid broad refactors unless they are required for the feature.
