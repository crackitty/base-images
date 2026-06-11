const fs = require("fs");
const path = require("path");

const entityRef = process.env.ENTITY_REF;
const image = process.env.IMAGE;
const tag = process.env.TAG;
// DIGEST is fetched by the workflow via skopeo before this script runs.
// Falls back to ArtifactDigest from the Trivy JSON (usually empty for tag-based scans).
const digestEnv = process.env.DIGEST || null;
// BASE_IMAGE_FROM is the upstream image reference parsed from the Dockerfile's
// "# image:tag" anchor comment (e.g. "eclipse-temurin:21-jre-jammy").
const baseImageFrom = process.env.BASE_IMAGE_FROM || null;
// BASE_IMAGE_DIGEST is the @sha256: digest currently pinned in the Dockerfile's
// FROM line (e.g. "sha256:3a8d0a46..."). Compared against UPSTREAM_DIGEST to
// determine whether a bump is actionable.
const baseImageDigest = process.env.BASE_IMAGE_DIGEST || null;
// UPSTREAM_DIGEST is the digest that the vendor registry currently serves for
// the pinned tag (resolved by the workflow via docker buildx imagetools inspect).
// If this differs from BASE_IMAGE_DIGEST, the vendor has published a new image
// and bumping the Dockerfile pin will actually pull patched packages.
const upstreamDigest = process.env.UPSTREAM_DIGEST || null;

// UPSTREAM_TRIVY_RESULT is the path to a Trivy JSON scan of the upstream image
// at its latest digest. Only present when digestChanged === true (BUMP_DIGEST).
// Used to compute exactly which CVE IDs bumping will eliminate.
const upstreamTrivyResult = process.env.UPSTREAM_TRIVY_RESULT || null;

const raw = JSON.parse(fs.readFileSync("trivy-result.json", "utf8"));
const scannedAt = new Date().toISOString();

function emptySummary() {
  return { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
}

function addSeverity(summary, sev) {
  const s = (sev || "UNKNOWN").toLowerCase();
  if (s === "critical") summary.critical += 1;
  else if (s === "high") summary.high += 1;
  else if (s === "medium") summary.medium += 1;
  else if (s === "low") summary.low += 1;
  else summary.unknown += 1;
}

// Build a summary by counting unique CVE IDs (not raw package-level rows).
// The same CVE can affect multiple packages; we only want to count it once.
function summariseUnique(rows) {
  const summary = emptySummary();
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.vulnerabilityId)) continue;
    seen.add(row.vulnerabilityId);
    addSeverity(summary, row.severity);
  }
  return summary;
}

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };

function pickCvss(cvss) {
  if (!cvss || typeof cvss !== "object") return { score: null, vector: null };

  // Prefer NVD v3, then any source's v3, then any source's v2
  const sources = Object.values(cvss);

  if (cvss.nvd && cvss.nvd.V3Score != null) {
    return { score: cvss.nvd.V3Score, vector: cvss.nvd.V3Vector || null };
  }

  for (const src of sources) {
    if (src && src.V3Score != null) {
      return { score: src.V3Score, vector: src.V3Vector || null };
    }
  }

  for (const src of sources) {
    if (src && src.V2Score != null) {
      return { score: src.V2Score, vector: src.V2Vector || null };
    }
  }

  return { score: null, vector: null };
}

// Collect all vulnerabilities across all results into a flat list,
// enriched with the result-level target field.
function collectVulnerabilities(results) {
  const vulns = [];
  for (const result of results || []) {
    for (const vuln of result.Vulnerabilities || []) {
      vulns.push({ vuln, target: result.Target || null });
    }
  }
  return vulns;
}

function buildCveTable(rawVulns) {
  const rows = rawVulns.map(({ vuln, target }) => {
    const { score, vector } = pickCvss(vuln.CVSS);
    return {
      vulnerabilityId: vuln.VulnerabilityID || null,
      severity: vuln.Severity || "UNKNOWN",
      status: vuln.Status || null,
      severitySource: vuln.SeveritySource || null,
      packageName: vuln.PkgName || null,
      installedVersion: vuln.InstalledVersion || null,
      fixedVersion: vuln.FixedVersion || null,
      description: vuln.Description || null,
      primaryUrl: vuln.PrimaryURL || null,
      publishedDate: vuln.PublishedDate || null,
      target,
      cvssScore: score,
      cvssVector: vector,
    };
  });

  rows.sort((a, b) => {
    const sevA = SEVERITY_ORDER[a.severity] ?? SEVERITY_ORDER.UNKNOWN;
    const sevB = SEVERITY_ORDER[b.severity] ?? SEVERITY_ORDER.UNKNOWN;
    if (sevA !== sevB) return sevA - sevB;
    return (a.vulnerabilityId || "").localeCompare(b.vulnerabilityId || "");
  });

  return rows;
}

// Merge per-package rows into one row per CVE ID.
// packageName, installedVersion, fixedVersion, and target are collapsed into
// deduplicated comma-separated strings. All other fields (severity, status,
// CVSS, description, primaryUrl, …) are CVE-level and taken from the first row.
function mergeCveTable(rows) {
  const map = new Map();
  for (const row of rows) {
    const id = row.vulnerabilityId;
    if (!map.has(id)) {
      map.set(id, {
        ...row,
        _pkgs: row.packageName ? [row.packageName] : [],
        _installed: row.installedVersion ? [row.installedVersion] : [],
        _fixed: row.fixedVersion ? [row.fixedVersion] : [],
        _targets: row.target ? [row.target] : [],
      });
    } else {
      const merged = map.get(id);
      if (row.packageName && !merged._pkgs.includes(row.packageName))
        merged._pkgs.push(row.packageName);
      if (
        row.installedVersion &&
        !merged._installed.includes(row.installedVersion)
      )
        merged._installed.push(row.installedVersion);
      if (row.fixedVersion && !merged._fixed.includes(row.fixedVersion))
        merged._fixed.push(row.fixedVersion);
      if (row.target && !merged._targets.includes(row.target))
        merged._targets.push(row.target);
    }
  }
  return [...map.values()].map((r) => {
    const { _pkgs, _installed, _fixed, _targets, ...rest } = r;
    return {
      ...rest,
      packageName: _pkgs.join(", ") || null,
      installedVersion: _installed.join(", ") || null,
      fixedVersion: _fixed.length > 0 ? _fixed.join(", ") : null,
      target: _targets.join(", ") || null,
    };
  });
}

const rawVulns = collectVulnerabilities(raw.Results);
const cveTable = mergeCveTable(buildCveTable(rawVulns));

// ── Recommended action ────────────────────────────────────────────────────────
// Derive the single most-actionable thing the image maintainer should do.
//
//   BUMP_DIGEST – fixable CVEs exist AND the upstream image has published a
//                new digest since the last scan. Bumping the @sha256: pin in
//                the Dockerfile and rebuilding will pull the patched packages.
//   WAIT        – fixable CVEs exist but the upstream digest hasn't changed,
//                meaning the base image maintainer hasn't shipped a new image
//                yet. Nothing is actionable until they do.
//              – also used when only affected (unpatched) CVEs remain.
//   NONE        – image is clean.
//
// We also surface:
//   fixableSummary – per-severity counts of fixable CVEs
//   topFixable     – up to 5 highest-severity fixable CVEs (id + severity)

function computeRecommendedAction(
  rows,
  { digestChanged, resolvedByBumpCount, remainingAfterBump },
) {
  const fixable = rows.filter((r) => r.status === "fixed");

  if (rows.length === 0) {
    return {
      action: "NONE",
      message: "No CVEs detected. This image is clean.",
      fixableSummary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
      topFixable: [],
    };
  }

  const fixableSummary = summariseUnique(fixable);

  if (fixable.length === 0) {
    return {
      action: "WAIT",
      message:
        "All remaining CVEs are unpatched upstream. " +
        "No action is available until vendors release fixes.",
      fixableSummary,
      topFixable: [],
    };
  }

  // Sort fixable by severity so we surface the highest-risk ones first,
  // then deduplicate by CVE ID — the same CVE can affect multiple packages
  // (e.g. libssl3 and openssl) and we don't want it consuming multiple slots.
  const sortedFixable = [...fixable].sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity] ?? SEVERITY_ORDER.UNKNOWN;
    const sb = SEVERITY_ORDER[b.severity] ?? SEVERITY_ORDER.UNKNOWN;
    return sa - sb;
  });

  // Count unique CVE IDs across ALL fixable rows first, before capping at 5.
  const uniqueFixableCount = new Set(fixable.map((r) => r.vulnerabilityId))
    .size;

  const seenIds = new Set();
  const topFixable = [];
  for (const r of sortedFixable) {
    if (seenIds.has(r.vulnerabilityId)) continue;
    seenIds.add(r.vulnerabilityId);
    topFixable.push({
      vulnerabilityId: r.vulnerabilityId,
      severity: r.severity,
      packageName: r.packageName,
      fixedVersion: r.fixedVersion,
    });
    if (topFixable.length === 5) break;
  }

  // Fixable CVEs exist — but are they actually actionable?
  // If the upstream base image digest hasn't changed since the last scan,
  // the base image maintainer hasn't shipped a new image yet. Bumping the
  // digest would be a no-op. Classify as WAIT until a new digest appears.
  if (!digestChanged) {
    return {
      action: "WAIT",
      message:
        `${uniqueFixableCount} CVE(s) have patches available in apt, but the upstream base image ` +
        "has not published a new digest yet — bumping the @sha256: pin would have no effect right now. " +
        "Check back after the next scan; the action will change to 'Bump digest' once a new image is available.",
      fixableSummary,
      topFixable,
    };
  }

  // Build the BUMP_DIGEST message. If we scanned the upstream image directly
  // (resolvedByBumpCount is a number), we can state exactly how many CVEs
  // bumping will eliminate. Otherwise fall back to a non-committing message.
  let bumpMessage;
  if (typeof resolvedByBumpCount === "number") {
    if (resolvedByBumpCount === 0) {
      bumpMessage =
        "A new upstream image is available, but scanning it shows it does not yet resolve any of the current CVEs. " +
        "Bump the digest to pick up the latest image — further fixes may arrive in a subsequent upstream release.";
    } else {
      bumpMessage =
        `Bumping to the latest upstream digest will eliminate ${resolvedByBumpCount} CVE(s) — ` +
        `confirmed by scanning the upstream image directly. ` +
        (remainingAfterBump > 0
          ? `${remainingAfterBump} CVE(s) will remain as they are also present in the latest upstream image.`
          : "All current CVEs will be resolved.");
    }
  } else {
    bumpMessage =
      "A new upstream image is available. Bump the @sha256: digest in the Dockerfile and rebuild to pick it up.";
  }

  return {
    action: "BUMP_DIGEST",
    message: bumpMessage,
    fixableSummary,
    topFixable,
  };
}

const tagSummary = summariseUnique(cveTable);

// ── Upstream diff (resolvedByBump) ────────────────────────────────────────────
// If the upstream Trivy scan result file exists, compute which CVE IDs are
// present in our current image but absent from the upstream image. These are
// the CVEs that bumping the digest will definitively eliminate.
let resolvedByBumpIds = null; // null = upstream scan not available
if (upstreamTrivyResult && fs.existsSync(upstreamTrivyResult)) {
  try {
    const upstreamRaw = JSON.parse(
      fs.readFileSync(upstreamTrivyResult, "utf8"),
    );
    const upstreamVulns = collectVulnerabilities(upstreamRaw.Results);
    const upstreamIds = new Set(
      upstreamVulns.map(({ vuln }) => vuln.VulnerabilityID),
    );
    // Unique CVE IDs in our image that are gone from upstream
    resolvedByBumpIds = [
      ...new Set(
        cveTable
          .filter((r) => !upstreamIds.has(r.vulnerabilityId))
          .map((r) => r.vulnerabilityId),
      ),
    ];
    console.log(
      `Upstream scan: ${upstreamVulns.length} vulns found. ` +
        `${resolvedByBumpIds.length} CVE ID(s) resolved by bump.`,
    );
  } catch (e) {
    console.warn(`Failed to parse upstream Trivy result: ${e.message}`);
    resolvedByBumpIds = null;
  }
}

// Annotate each CVE row with resolvedByBump boolean (only when upstream data available)
const resolvedSet = resolvedByBumpIds ? new Set(resolvedByBumpIds) : null;
for (const row of cveTable) {
  row.resolvedByBump = resolvedSet
    ? resolvedSet.has(row.vulnerabilityId)
    : null;
}

const resolvedByBumpCount =
  resolvedByBumpIds !== null ? resolvedByBumpIds.length : null;
const remainingAfterBump =
  resolvedByBumpIds !== null
    ? new Set(cveTable.map((r) => r.vulnerabilityId)).size -
      resolvedByBumpIds.length
    : null;

const entityName = entityRef.split("/").pop();
const outDir = path.join("backstage-security", entityName);
const outFile = path.join(outDir, "security-state.json");
fs.mkdirSync(outDir, { recursive: true });

let state = {
  entityRef,
  image,
  baseImageFrom,
  baseImageDigest,
  upstreamDigest,
  currentTag: tag,
  latestFixedTag: null,
  vulnerableTags: [],
  scannedAt,
  digest: null,
  tags: [],
};

if (fs.existsSync(outFile)) {
  state = JSON.parse(fs.readFileSync(outFile, "utf8"));
}

state.entityRef = entityRef;
state.image = image;
// Always update baseImageFrom/baseImageDigest/upstreamDigest if the workflow
// provided them (Dockerfile may have been bumped since the last scan)
if (baseImageFrom) state.baseImageFrom = baseImageFrom;
if (baseImageDigest) state.baseImageDigest = baseImageDigest;
if (upstreamDigest) state.upstreamDigest = upstreamDigest;
state.tags = Array.isArray(state.tags) ? state.tags : [];

// Compare the Dockerfile-pinned digest against what the vendor registry
// currently serves for that tag. If they differ, the vendor has published a
// new image — bumping the @sha256: pin in the Dockerfile will actually pull
// patched packages (BUMP_DIGEST). If they are the same, the vendor hasn't
// shipped a new image yet — bumping would be a no-op (WAIT).
//
// Resolution order for the two digest values:
//   1. Env vars from the current workflow run (most up-to-date).
//   2. Values already persisted in state (from a previous run that had the env
//      vars). This handles re-runs where BASE_IMAGE_DIGEST / UPSTREAM_DIGEST
//      are not re-supplied but the Dockerfile hasn't changed.
//   3. GHCR-digest-changed heuristic as a last resort (e.g. first-ever scan,
//      or Dockerfile lacks the anchor comment entirely).
const effectiveBaseImageDigest =
  baseImageDigest || state.baseImageDigest || null;
const effectiveUpstreamDigest = upstreamDigest || state.upstreamDigest || null;

let digestChanged;
if (effectiveBaseImageDigest && effectiveUpstreamDigest) {
  digestChanged = effectiveBaseImageDigest !== effectiveUpstreamDigest;
  console.log(
    `Upstream check: pinned=${effectiveBaseImageDigest} upstream=${effectiveUpstreamDigest} digestChanged=${digestChanged}` +
      (baseImageDigest ? "" : " (pinned digest from persisted state)") +
      (upstreamDigest ? "" : " (upstream digest from persisted state)"),
  );
} else {
  // Fallback: compare GHCR built-image digest between scans
  const newDigest = digestEnv || raw.ArtifactDigest || null;
  const previousTagRecord = state.tags.find((t) => t.tag === tag);
  const previousDigest = previousTagRecord?.digest ?? null;
  digestChanged = previousDigest === null || previousDigest !== newDigest;
  console.log(
    `Upstream digests unavailable — falling back to GHCR digest comparison: previous=${previousDigest ?? "none"} new=${newDigest ?? "none"} changed=${digestChanged}`,
  );
}

const recommendedAction = computeRecommendedAction(cveTable, {
  digestChanged,
  resolvedByBumpCount,
  remainingAfterBump,
});

const existing = state.tags.find((t) => t.tag === tag);
const status = cveTable.length > 0 ? "vulnerable" : "fixed";

const nextTagRecord = {
  tag,
  digest: digestEnv || raw.ArtifactDigest || null,
  status,
  summary: tagSummary,
  vulnerabilityCount: cveTable.length,
  scannedAt,
  cveTable,
  resolvedByBump: resolvedByBumpIds, // null if upstream scan unavailable, string[] otherwise
  recommendedAction,
};

if (existing) {
  Object.assign(existing, nextTagRecord);
} else {
  state.tags.push(nextTagRecord);
}

state.currentTag = tag;
state.scannedAt = scannedAt;
state.recommendedAction = recommendedAction;
state.digest = nextTagRecord.digest ?? state.digest ?? null;
state.vulnerableTags = state.tags
  .filter((t) => t.status === "vulnerable")
  .map((t) => t.tag);

// naive semver-ish descending sort
const sorted = [...state.tags].sort((a, b) =>
  b.tag.localeCompare(a.tag, undefined, { numeric: true, sensitivity: "base" }),
);

const fixed = sorted.find((t) => t.status === "fixed");
state.latestFixedTag = fixed ? fixed.tag : null;

fs.writeFileSync(outFile, JSON.stringify(state, null, 2));
console.log(`Wrote ${outFile}`);
