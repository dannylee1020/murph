FROM node:20-bookworm-slim

WORKDIR /app
ENV MURPH_DISTRIBUTION=personal

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV MURPH_APP_DIR=/app
RUN install -m 0755 app/personal/cli/murph /usr/local/bin/murph

EXPOSE 5173
CMD ["node", "dist/app/personal/runtime/server.js"]
