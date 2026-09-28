# The research server as a container. Build from the REPO ROOT (it shares the corpus code in
# corpus-core/src):   docker build -f remote/Dockerfile -t mqrg-remote .
# Run it with deploy/docker-compose.yml (Postgres + Caddy for HTTPS). See DEPLOY.md.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# npm validates the lockfile against every workspace, so all their manifests come along;
# only the remote's production dependencies are installed.
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY corpus-core/package.json corpus-core/
COPY mcp/package.json mcp/
COPY remote/package.json remote/
RUN npm ci --omit=dev --workspace @alsiraat/remote --include-workspace-root=false --ignore-scripts \
 && npm cache clean --force

FROM node:22-bookworm-slim
ENV NODE_ENV=production NODE_NO_WARNINGS=1 REMOTE_PORT=8100
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/remote/node_modules ./remote/node_modules
COPY package.json ./
COPY remote/package.json remote/tsconfig.json ./remote/
COPY remote/src ./remote/src
COPY remote/migrations ./remote/migrations
COPY corpus-core/package.json ./corpus-core/
COPY corpus-core/src ./corpus-core/src
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint && mkdir -p /corpus && chown node:node /corpus
USER node
WORKDIR /app/remote
EXPOSE 8100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.REMOTE_PORT||8100)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["entrypoint"]
CMD ["serve"]
