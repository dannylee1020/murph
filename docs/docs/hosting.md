---
title: Hosting
description: Host Murph on a remote server or managed container service.
---

# Hosting

Deploy Murph to any remote host with Docker. The hosted machine owns the runtime config, credentials, SQLite database, source indexes, plugins, policy files, bot ingress, and agent execution.

Murph requires a stable public HTTPS origin for OAuth callbacks:

```text
https://agent.example.com/api/slack/oauth/callback
```

Set that origin with:

```bash
MURPH_APP_URL=https://agent.example.com
```

## Docker Run
Docker command when you want the smallest possible container command or your platform does not use Compose.

Pull and run the release image:

```bash
docker volume create murph-data

docker run -d \
  --name murph \
  --restart unless-stopped \
  -p 127.0.0.1:5173:5173 \
  -e MURPH_APP_URL=https://agent.example.com \
  -e MURPH_HOME=/data \
  -e MURPH_SQLITE_PATH=/data/murph.sqlite \
  -v murph-data:/data \
  ghcr.io/dannylee1020/murph:latest
```

Run setup inside the container:

```bash
docker exec -it murph murph setup
```

Build the image locally from a checkout:

```bash
docker build -f app/Dockerfile -t murph:local .
```

Then replace the image name in `docker run` with:

```text
murph:local
```


## Compose

The docker-compose file runs the release image:

```bash
MURPH_APP_URL=https://agent.example.com \
  docker compose -f deploy/docker-compose.yml up -d
```

Run setup inside the container:

```bash
docker compose -f deploy/docker-compose.yml exec murph murph setup
```

The deployment Compose file uses:

```text
ghcr.io/dannylee1020/murph:latest
```

Published releases also push a matching version tag, such as `v0.1.0`. Use the versioned image tag when you need Docker deploys to match a pinned curl install exactly.

Murph state is stored under `/data`:

```text
MURPH_HOME=/data
MURPH_SQLITE_PATH=/data/murph.sqlite
```

Keep `/data` on a Docker volume, service disk, or equivalent persistent mount. Without persistent storage, redeploys can lose setup state, credentials, SQLite data, source indexes, plugins, and policy changes.


## VPS With A Domain

Use this path when you have a VPS and can point a domain or subdomain at it.

1. Point DNS for `agent.example.com` to the VPS public IP.
2. Run Murph with Docker Compose.
3. Put Caddy, nginx, Traefik, or an existing edge proxy in front of Murph.
4. Expose only the proxy on ports `80` and `443`.
5. Keep Murph bound to `127.0.0.1:5173`.

Set:

```bash
MURPH_APP_URL=https://agent.example.com
```

Configure the proxy to forward to:

```text
http://127.0.0.1:5173
```

If the VPS changes later, repoint DNS. The Slack callback stays the same because the public origin stays the same.

## VPS Without A Domain

Use a stable tunnel hostname when you cannot point DNS at the server or cannot open inbound ports. Cloudflare Tunnel, Tailscale Funnel, and static ngrok domains can work if the public URL is stable.

Set `MURPH_APP_URL` to the stable tunnel origin:

```bash
MURPH_APP_URL=https://agent.example.com
```

Avoid ephemeral tunnel URLs for a long-running install. If the tunnel URL changes, Slack OAuth redirect URLs must be updated before reconnecting.

## Managed Container Services

Managed services such as Railway, Fly.io, Render, Google Cloud Run, and similar platforms usually provide a public HTTPS service URL or custom-domain support. Deploy the GHCR image and set:

```bash
MURPH_APP_URL=https://your-service.example.com
```

Use the platform's persistent volume, disk, or filesystem mount for `/data`. Platforms without durable filesystem storage can start Murph, but setup state and SQLite data may be lost on redeploy.

For Cloud Run specifically, do not treat the container filesystem as durable. Use Cloud Run only with an attached persistent storage option or choose a VM/container host with a durable volume.

## Deployment Troubleshooting

### OAuth redirects to the wrong place

Check `MURPH_APP_URL`. For remote hosting, it should be the stable public HTTPS origin users open in a browser:

```bash
MURPH_APP_URL=https://agent.example.com
```

Do not use `localhost` for a remote deployment. Make sure the Slack app redirect URL matches the hosted callback exactly:

```text
https://agent.example.com/api/slack/oauth/callback
```

If you change domains, managed-service URLs, or tunnel URLs, update the Slack redirect URL before reconnecting OAuth.

### The public URL does not reach Murph

Check each hop:

```text
public HTTPS URL -> proxy, tunnel, or platform router -> http://127.0.0.1:5173
```

On a VPS, expose the proxy or tunnel, not the Murph app port directly. The Compose file binds Murph to `127.0.0.1:5173`, so a remote browser cannot reach it unless a proxy or tunnel forwards traffic to that local port.

### Setup disappears after redeploy

Make sure `/data` is persistent. Murph stores config, credentials, SQLite state, source indexes, plugins, and policy files there in the Docker deployment.

If `/data` is not mounted to a Docker volume, service disk, or equivalent persistent filesystem, setup may appear to work and then disappear after the container is recreated.

### The GHCR image cannot be pulled

Confirm the image and tag exist:

```text
ghcr.io/dannylee1020/murph:latest
```

For pinned deployments, use a published release tag such as `v0.1.0`. If the package is private, make the GHCR package public or configure the host with credentials that can pull from GitHub Container Registry.

### A tunnel URL changed

Ephemeral tunnel URLs are not reliable for long-running installs. Use a stable tunnel hostname or custom domain. If the tunnel URL changes, Slack OAuth redirect URLs must be updated before reconnecting.
