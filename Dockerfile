# Storm-Gate, as a published image.
#
# Two stages: the first installs the production dependencies against the
# lockfile, the second takes the resulting node_modules and nothing else. That
# keeps the lockfile and npm's own cache out of an image that runs an
# authentication service on the public internet.
#
# No compiler in either stage. bcrypt is the only native module, and as of 6.0.0
# it ships prebuildify binaries tagged by libc - prebuilds/linux-arm64/
# bcrypt.musl.node among them - so node-gyp-build resolves a binary rather than
# building one. The gcc/g++/make/python3 layer this file used to carry was there
# for bcrypt 5, which used node-pre-gyp and published glibc builds only; the
# 6.0.0 upgrade turned it into a toolchain installed on every build, for nothing.

# ---- build -----------------------------------------------------------------
# Node 20 to match .nvmrc and the README. This said node:18 until the image was
# published, and Node 18 left support in April 2025: shipping an authentication
# service on an end-of-life runtime means shipping whatever it stops receiving.
FROM node:20-alpine AS build

WORKDIR /app

# The lockfile, not the ranges. `npm install` resolves afresh at build time, so
# two builds of the same commit could ship different dependency trees - and the
# one that was audited would not be the one that shipped.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ---------------------------------------------------------------
FROM node:20-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

# Not root. An authentication service is a thing people try to get into.
RUN addgroup -g 1001 -S storm && adduser -S storm -u 1001 -G storm

# Root-owned and world-readable: the process needs to read its code, never to
# write it. Copying these as the application's own user - which is what the
# obvious `--chown` does - would let a bug that can write a file replace the
# server itself.
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# The one directory the application may write to.
#
# Winston opens a file transport relative to the working directory, so this has
# to exist and be writable or the process exits on startup. Granting it
# specifically, rather than chowning /app as the previous Dockerfile did, keeps
# the application unable to rewrite its own source at runtime - which is the
# difference between a bug that reads files and one that replaces them.
RUN mkdir -p /app/logs && chown storm:storm /app/logs

USER storm

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["node", "src/server.js"]
