# FieldReport server. Built from the REPO ROOT (needs the contracts workspace):
#   docker build -f apps/server/Dockerfile -t fieldreport-server .
#
# Base = official Playwright image: Chromium + all system libs preinstalled, so the PDF
# renderer works with no extra setup. The tag MUST match the pinned `playwright` npm
# version in package.json (currently 1.61.1) — a mismatch makes Chromium fail to launch.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app
ENV NODE_ENV=production

# Install deps (workspaces). Copy the whole repo (dockerignore trims node_modules/dist).
COPY . .
RUN npm ci --include=dev

# Build shared contracts, then the server.
RUN npm run build -w @fieldreport/contracts \
 && npm run build -w @fieldreport/server

ENV PORT=8787 HOST=0.0.0.0
EXPOSE 8787

# DB schema is ensured at startup; the pilot project is seeded at startup.
CMD ["node", "apps/server/dist/index.js"]
