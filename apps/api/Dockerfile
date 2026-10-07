# morocco-pc API image.
#
# BUILD CONTEXT IS THE REPOSITORY ROOT, not apps/api: the API imports the engine
# from src/recommendation/ (a sibling of apps/) and the write-target guard from
# scripts/lib/. Build it with:
#
#   docker build -f apps/api/Dockerfile -t morocco-pc-api .
#
# There is deliberately NO nested apps/api/package.json. The engine's own
# require('pg') / require('dotenv') must resolve, and Node resolves a require
# from the requiring file upward - so the single root node_modules (and the root
# lockfile) is what makes both the engine and the API work at runtime. A nested
# package.json would install a second copy of pg and leave the engine's requires
# pointed at the root anyway.
#
# Line endings: kept LF deliberately. A CRLF Dockerfile can break a `RUN` line
# continuation, so this file uses none - every instruction is a single line and
# safe either way. (The checkout normalizes text files per core.autocrlf, so the
# blob is LF and a Windows working copy may materialise CRLF.)
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so editing source does not invalidate the install layer.
# --omit=dev drops pino-pretty (a devDependency); server.js feature-detects it
# and falls back to JSON logs, so the image never depends on a dev package.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application code.
COPY src ./src
COPY apps/api ./apps/api

# The one script module the API reuses at runtime: db-url.js owns the
# "TEST_DATABASE_URL must not target the shared database" guard. Copied
# explicitly rather than as the whole scripts/ tree so the runtime dependency
# stays visible and the image stays small.
COPY scripts/lib/db-url.js ./scripts/lib/db-url.js

# node:22-alpine ships an unprivileged `node` user; never run as root.
USER node

EXPOSE 3000

# The server refuses to start unless the target is provably the isolated TEST
# branch, or API_ALLOW_SHARED=1 is set explicitly. That guard is why no
# connection string is baked into this image.
CMD ["node", "apps/api/src/server.js"]
