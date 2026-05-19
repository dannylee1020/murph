---
title: Slack
description: Connect Slack as a Murph channel.
---

# Slack

Slack is the most complete Murph channel setup path today.

## Socket Mode

Murph uses Slack Socket Mode by default. Socket Mode avoids exposing a public Events URL during local development.

## Manifest

The Slack app manifest is available at:

```text
/slack-manifest.yaml
```

## Setup command

Run Slack setup from the CLI:

```bash
murph setup slack
```

Setup creates or configures the Slack app, opens the approval URL, and saves local credentials.

## OAuth redirect

The local OAuth redirect URL is:

```text
http://localhost:5173/api/slack/oauth/callback
```

## User search

Reconnect Slack after adding scopes or changing user-search consent. Reconnect stores a fresh user-search token locally.

## Channel access

Public channels can be joined automatically when permissions allow it. Private channels must already include the Slack app.

## Runtime path

Each Slack handoff follows the same path:

```text
Slack channel -> context -> grounded draft -> policy -> send | queue | skip
```
