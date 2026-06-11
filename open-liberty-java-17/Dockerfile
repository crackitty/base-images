# IBM Open Liberty full image with Java 17 - pinned to a digest for reproducibility.
# The automated digest-bump workflow will keep this up to date.
# icr.io/appcafe/open-liberty:kernel-slim-java17-openj9-ubi
FROM icr.io/appcafe/open-liberty:kernel-slim-java17-openj9-ubi@sha256:f255ca6d38c8c63f47e8c4b9a020576896d82d8555fdf47875bc6b025fbcc14f

# Drop to the Liberty non-root user (uid 1001 is the OL convention) 
USER 1001

WORKDIR /opt/liberty/wlp/usr/servers/defaultServer
