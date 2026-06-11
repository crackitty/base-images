[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-%23FE5196?logo=conventionalcommits&logoColor=white)](https://conventionalcommits.org)

# Middlewaregruppen Golden Paths base-images

This repository contains Docker base-images used across the Middlewaregruppen
Golden Paths project.

## What are base images?

These images are designed to provide a consistent and reliable foundation for
projects within the organization.

## Images Included

- **java-17**: A container image that provides a Java 17 runtime
  environment based on Eclipse Temurin JDK 17.
- **open-liberty-java-17**: A container image that provides a Java 17 runtime
  environment based on Eclipse Temurin JDK 17 with Open Liberty.
- **java-21**: A container image that provides a Java 21 runtime environment
  based on Eclipse Temurin JDK 21.
- **react-build-node24**: A container image that provides a NodeJS 24 runtime
  environment for building React applications.
- **golang-1-23**: A container image for running Go 1.23 services with
  non-root defaults and standard base-image metadata labels.

## Building the Images

Building the images in this repository is managed by the CI workflows. If you push
changes to a folder containing one of the tracked images, the CI will automatically
build the image and push it to the correct registry.

> Please note that the changes to the images depend on using Conventional Commits
> to track what has changed and whether that means bumping a major, minor or patch
> version. This is necessary for the release-please tool to function correctly.

For more on good commit messages, see the
[Conventional Commits specification](https://www.conventionalcommits.org/en/v1.0.0/).

## Versioning

The images in this repository use
[release-please](https://github.com/googleapis/release-please) for versioning
and changelog management.

### Summary of how release-please works

Each base-image (which is a directory in the repository) is tracked by
release-please as a separate package. When changes are made to the files in
one of the image directories, release-please tracks the changes in a special
branch that it manages and creates a long-lived pull request for that image.

`release-please` will automatically update the pull request with the appropriate
version bump depending on what you have committed. So, using the correct
Conventional Commit message is important to ensure that the version is bumped correctly.
When the pull request is merged to `main`, release-please automatically generates
a new version.

In a nutshell, you just need to make your changes and commit them with the correct
Conventional Commit message, and release-please will take care of the rest, then
whenever you decide to cut a new release, you just merge the pull request and the
new version will be generated, which includes a git tag, a new release in GitHub,
automated release notes with container image tag information and an updated changelog.

### Changelogs

Each image has its own changelog file located in its respective directory. For
example, the changelog for the `java-17` image can be found at `java-17/CHANGELOG.md`.

When changes are merged to the `main` branch, `release-please` will automatically
generate a new version for the affected images and update their changelogs
accordingly.

## Creating New Images

If you need to create a new base image that the organization can use, maybe for
AI workloads or NodeJS applications, etc. then follow this guide:

To begin:

- Run the `Create New Base Image` workflow located in the
  `.github/workflows/create-base-image.yml` file. This can be done via the
  "Actions" tab in GitHub.
- Provide the name for the new base image when prompted.
- This will create a new branch with the necessary scaffolding for the new
  base image, including a directory, a Dockerfile, and a changelog file.
- A pull request will be automatically created for you to review and merge the
  changes.
- Once the PR is merged, the new base image will be available for use and will
  be versioned using release-please automatically.

## Removing an image (if needed)

To remove an image from this repository, you need to:

- delete its corresponding directory and files. For example, to remove the
  `java-17` image, delete the `java-17/` directory along with its
  contents.
- Remove its entry from the `.release-please-manifest.json` file to ensure
  that `release-please` no longer tracks it.
- Remove its entry from the `.release-please-manifest.json` file.
- Commit and push the changes to the `main` branch.

This does not remove the images from the container registry, so they will still be
available for use. However, they will no longer be maintained or updated.

> **TBD**: Could create a workflow for this process in the future.

## Consuming a Base Image

When a new version of a base image is released, all registered consumer repos
automatically receive a `repository_dispatch` event that triggers a PR bumping
their `FROM` tag to the new version.

### Registering as a consumer

To register your repo as a consumer of a base image:

1. Add the topic `uses-mgp-<component>-base` to your repository via
   **Settings → General → Topics**. For example, to consume the `java-17`
   image, add the topic `uses-mgp-java-17-base`.

2. Ensure the `ORG_GP_APP_ID` and `ORG_GP_APP_PRIVATE_KEY` GitHub App is
   installed on your repository. Contact the platform team if it is not.

3. Add the `bump-base-image` workflow to your repository at
   `.github/workflows/bump-base-image.yml` (see below).

### The bump-base-image workflow

Your repo needs a workflow that listens for the `repository_dispatch` event
and opens a PR updating the `FROM` line in your Dockerfile. A reference
implementation is provided below — copy it into your repo and adjust the
`DOCKERFILE` path if needed:

```yaml
name: Bump base image

on:
  repository_dispatch:
    types: [bump-base-image]

jobs:
  bump:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Update FROM tag in Dockerfile
        env:
          IMAGE: ${{ github.event.client_payload.image }}
          VERSION: ${{ github.event.client_payload.version }}
        run: |
          sed -i "s|FROM ${IMAGE}:[^ ]*|FROM ${IMAGE}:${VERSION}|" Dockerfile

      - name: Open pull request
        uses: peter-evans/create-pull-request@v6
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          branch: bump-base-image/${{ github.event.client_payload.component }}-${{ github.event.client_payload.version }}
          commit-message: "chore: bump ${{ github.event.client_payload.component }} base image to ${{ github.event.client_payload.version }}"
          title: "chore: bump ${{ github.event.client_payload.component }} base image to ${{ github.event.client_payload.version }}"
          body: |
            Automated bump of `${{ github.event.client_payload.component }}` base image to version `${{ github.event.client_payload.version }}`.

            Triggered by a new release in [mgp-base-images](https://github.com/middlewaregruppen/mgp-base-images).
```

### How it works end-to-end

1. A new base image version is released in this repository.
2. The `notify-consumers` workflow finds all repos in the org with the
   matching topic and sends each a `repository_dispatch` event containing
   the `image`, `component`, and `version`.
3. The consumer's `bump-base-image` workflow receives the event, updates the
   `FROM` line in the Dockerfile, and opens a PR for review.
