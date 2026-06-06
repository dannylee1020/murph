FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV MURPH_DISTRIBUTION=team

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json tsconfig.server.json tsconfig.ui.json ./
COPY app ./app
RUN npm run build

RUN npm prune --omit=dev

FROM node:22-bookworm-slim

WORKDIR /app
ENV MURPH_DISTRIBUTION=team
ENV NODE_ENV=production
ENV MURPH_APP_DIR=/app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

COPY app/cli ./app/cli
COPY policies ./policies
COPY skills/runtime ./skills/runtime
COPY skills/agent ./skills/agent
COPY themes/murph-agent.json ./themes/murph-agent.json
COPY public/slack-manifest.yaml public/slack-channel-manifest.yaml ./public/

RUN chmod 0755 app/cli/murph \
  && install -m 0755 app/cli/murph /usr/local/bin/murph

EXPOSE 5173
CMD ["node", "dist/app/runtime/server.js"]
