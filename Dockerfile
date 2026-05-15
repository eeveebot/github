FROM docker.io/node:24-alpine AS builder

USER root

RUN set -exu \
  && apk add --no-cache \
    bash \
    make

USER node

WORKDIR /build

COPY --chown=node:node . /build

ENV NODE_ENV=development

RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
  set -exu \
  && cd /build \
  && npm install --include=dev \
  && npm run build

FROM docker.io/node:24-alpine

USER node
WORKDIR /app

ENV NODE_ENV=production

COPY --chown=node:node package.json package-lock.json .npmrc /app/

RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
  npm install

COPY --from=builder /build/dist /app/dist

ENTRYPOINT ["/bin/sh"]

CMD ["-c", "node /app/dist/main.mjs"]
