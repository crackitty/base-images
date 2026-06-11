#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT_DIR"

if ! command -v skopeo >/dev/null 2>&1; then
  echo "ERROR: skopeo is required (https://github.com/containers/skopeo)." >&2
  exit 1
fi

if ! command -v yq >/dev/null 2>&1; then
  echo "ERROR: yq is required (https://github.com/mikefarah/yq)." >&2
  exit 1
fi

updated=0
skipped=0
warnings=()

skopeo_args=()
if [[ -n "${SKOPEO_CREDS:-}" ]]; then
  skopeo_args+=(--creds "$SKOPEO_CREDS")
fi

while IFS= read -r catalog_file; do
  image=$(yq '.metadata.annotations["fleet-management/container-image"] // ""' "$catalog_file")
  tag=$(yq '.metadata.annotations["fleet-management/current-tag"] // ""' "$catalog_file")

  if [[ -z "$image" || -z "$tag" ]]; then
    echo "Skipping $catalog_file — missing fleet-management/container-image or fleet-management/current-tag"
    continue
  fi

  if ! digest=$(skopeo inspect "${skopeo_args[@]}" --format '{{.Digest}}' "docker://${image}:${tag}" 2>/tmp/skopeo-error.log); then
    reason=$(cat /tmp/skopeo-error.log | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')
    message="Skipped $catalog_file — unable to resolve digest for ${image}:${tag} (${reason})"
    echo "$message"
    warnings+=("$message")
    skipped=$((skipped + 1))
    continue
  fi

  if [[ -z "$digest" ]]; then
    message="Skipped $catalog_file — empty digest for ${image}:${tag}"
    echo "$message"
    warnings+=("$message")
    skipped=$((skipped + 1))
    continue
  fi

  DIGEST="$digest" yq -i '.metadata.annotations["fleet-management/digest"] = strenv(DIGEST)' "$catalog_file"

  echo "Updated $catalog_file → $digest"
  updated=$((updated + 1))

done < <(find . -maxdepth 2 -name catalog-info.yaml -not -path "./catalog-info.yaml")

echo "Updated $updated catalog-info.yaml file(s)."

if [[ $skipped -gt 0 ]]; then
  echo "Skipped $skipped catalog-info.yaml file(s)."
fi

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "## Catalog digest update summary"
    echo ""
    echo "- Updated: $updated"
    echo "- Skipped: $skipped"
    if [[ ${#warnings[@]} -gt 0 ]]; then
      echo ""
      echo "### Skipped images"
      for warning in "${warnings[@]}"; do
        echo "- $warning"
      done
    fi
  } >> "$GITHUB_STEP_SUMMARY"
fi
