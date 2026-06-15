# Contributing

Thanks for taking a look at Murph. The project is still early, so keep contributions focused and open an issue before starting large core/runtime changes.

## Local setup

Install dependencies:

```bash
npm install
```

Run the local app:

```bash
npm run dev
```

## Validation

Run the core checks before opening a PR:

```bash
npm run check
npm test
```

If you change docs, also run:

```bash
npm run docs
```

## Pull requests

- Keep PRs focused on one behavior, bug, or docs update.
- Include the validation commands you ran.
- Update docs for user-facing behavior, setup, config, policy, plugin, or CLI changes.
- Include screenshots for UI changes.
- Prefer scoped plugins or documented extension points before changing Murph core.

## Branch names

Use short descriptive branches:

- `fix/<description>`
- `feat/<description>`
- `docs/<description>`
- `refactor<description>`
- `chore/<description>`

## Security

Do not report security issues in public GitHub issues. See [SECURITY.md](./SECURITY.md).
