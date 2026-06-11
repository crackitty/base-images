# Dockerfile.build-base
FROM node:24-trixie-slim

LABEL org.opencontainers.image.title="react-build-node24"
LABEL org.opencontainers.image.description="Base image for building React UIs"
LABEL org.opencontainers.image.source="middlewaregruppen-internal"

ENV NODE_ENV=production
ENV CI=true

WORKDIR /app

# Use Corepack so downstream projects can choose pnpm/yarn via packageManager
RUN corepack enable

# Non-root user already exists in official node images
USER node