# eclipse-temurin:21-jre-jammy new v1.0.2 maybe
FROM eclipse-temurin:21.0.11_10-jdk@sha256:b9142586f9712700c6c9e07adcedfb18608b1a3a056e4001423a3354adfa9d80

RUN groupadd --gid 65532 nonroot && \
  useradd --uid 65532 --gid 65532 --no-create-home nonroot

WORKDIR /app
USER 65532:65532
EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
