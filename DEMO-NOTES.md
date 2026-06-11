# What we're trying to show with this

The complete automated chain:

**Developer clicks "Bump digest now"** in Backstage UI in a Base-Image card

→ **backend POSTs to GitHub**: dispatch bump-base-digests.yml (single image)
→ bump workflow updates @sha256: in Dockerfile, **opens PR**

Human intervention required here (for now):

→ **human reviews & merges PR**
→ **push to main** triggers release-please.yml
→ release-please creates/merges a release
→ build-images job builds & pushes new versioned image to GHCR
→ scan-after-build job (NEW) dispatches scan-base-image.yml
→ Trivy scans the new image
→ normalize-trivy.js writes security-state.json
→ scan PR auto-merges into base-images
→ Backstage reads updated security-state.json
→ latestFixedTag updated, action → NONE ✅
