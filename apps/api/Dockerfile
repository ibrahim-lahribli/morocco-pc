# morocco-pc API image.
#
# BUILD CONTEXT IS THE REPOSITORY ROOT, not apps/api: the API imports the engine
# from src/recommendation/, whose stage shims require the extracted packages
# (packages/recommendation-core, packages/database-guard) by relative path, and
# the step 5 runtime package (packages/recommendation-runtime) is the package
# those shims will move behind. Build it with:
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

# Runtime packages, copied explicitly rather than as the whole packages/ tree so
# the runtime dependency stays visible and the image stays small. They are
# consumed by relative path only: the root package.json declares no `workspaces`
# and no dependency on any of them, so `npm ci` neither installs nor links them
# and a bare `require('@morocco-pc/...')` will NOT resolve in this image. A file
# copy is what makes `/app/packages/<name>` loadable by path. Path-only
# correction (owner decision 1, 2026-11-11): the install, the user and the CMD
# are unchanged.

# database-guard owns the "TEST_DATABASE_URL must not target the shared database"
# guard that db.js applies at startup.
COPY packages/database-guard/package.json ./packages/database-guard/package.json
COPY packages/database-guard/src ./packages/database-guard/src

# recommendation-core owns the pure stages that src/recommendation/ now only
# re-exports: every shim there requires
# ../../../packages/recommendation-core/src/... at require time (retention uses an
# explicit /index), and engine.js loads those barrels at module load. Its test/
# tree is NOT copied - tests are not runtime.
COPY packages/recommendation-core/package.json ./packages/recommendation-core/package.json
COPY packages/recommendation-core/src ./packages/recommendation-core/src

# recommendation-runtime owns the database-backed execution half: the loaders,
# the read snapshot and the write transaction. At W0 it ships the package
# harness only, so nothing in apps/api imports it yet. The slot is created NOW,
# before W1 moves a module into it, for three reasons: the first import must not
# be the commit that discovers the image never carried the package; the COPY
# pair is the only thing that makes `/app/packages/recommendation-runtime`
# loadable by path (no workspace, no npm link); and the image gate can then
# prove presence and loadability while the surface is still empty, instead of
# pinning an empty surface. test/ and docs/ are NOT copied - tests and
# documentation are not runtime.
COPY packages/recommendation-runtime/package.json ./packages/recommendation-runtime/package.json
COPY packages/recommendation-runtime/src ./packages/recommendation-runtime/src

# node:22-alpine ships an unprivileged `node` user; never run as root.
USER node

EXPOSE 3000

# The server refuses to start unless the target is provably the isolated TEST
# branch, or API_ALLOW_SHARED=1 is set explicitly. That guard is why no
# connection string is baked into this image.
CMD ["node", "apps/api/src/server.js"]
