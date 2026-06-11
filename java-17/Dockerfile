# Eclipse Temurin JRE 17 on Ubuntu Jammy - pinned to a digest for reproducibility.
# The automated digest-bump workflow will keep this up to date.
# eclipse-temurin:17-jre-jammy
FROM eclipse-temurin:17-jre-jammy@sha256:6b78a8ad84bc9ea92c95bafcd8d9ff1b79c2b70a318e8f25dfb5c452658d5417

# Drop to a non-root user (uid 65532 matches the distroless "nonroot" convention) 
USER 65532:65532

WORKDIR /app
