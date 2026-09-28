# Caddy with the web app built in: it serves the app at https://$DOMAIN/ and proxies everything
# else to the research server (deploy/Caddyfile). Build from the REPO ROOT — compose does this.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
# npm validates the lockfile against every workspace, so all their manifests come along;
# only the app's dependencies are installed.
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY corpus-core/package.json corpus-core/
COPY mcp/package.json mcp/
COPY server/package.json server/
RUN npm ci --workspace app --include-workspace-root=false && npm cache clean --force
COPY app ./app
# the app calls the research server at its public address (app/src/api/remote.ts)
ARG DOMAIN
RUN test -n "$DOMAIN" && VITE_REMOTE_URL="https://$DOMAIN" npm run build -w app

FROM caddy:2
COPY --from=build /repo/app/dist /srv/app
