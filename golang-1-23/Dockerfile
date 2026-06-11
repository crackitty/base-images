# golang:1.23-alpine
FROM golang:1.23-alpine@sha256:383395b794dffa5b53012a212365d40c8e37109a626ca30d6151c8348d380b5f

RUN apk add --no-cache ca-certificates tzdata && \
  addgroup -g 65532 -S nonroot && \
  adduser -u 65532 -S -D -H -G nonroot nonroot

WORKDIR /app
USER 65532:65532
EXPOSE 8080

ENTRYPOINT ["/app/app"]
