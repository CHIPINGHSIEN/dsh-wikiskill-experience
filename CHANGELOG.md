# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-11-09

First release published to the npm registry, and the first one carrying full
distribution metadata.

### Added

- `author` field.
- README: both distribution channels (npm package vs GitHub pinned commit),
  per-endpoint network constraints for pushing and installing, and the npm
  publishing prerequisites.

## [0.1.0] - 2026-11-09

First public release. Host-only Cordis bundle for DeepSeek Harness; no Client
half, no runtime dependency, no network access, no LLM call inside the plugin.

### Added

- `wikiskill_record` - nine-field atomic experience record; appends to
  `raw/YYYY-MM-DD.jsonl` and `logs.md`, then recompiles the descriptive wiki.
- Deterministic descriptive compiler: `raw/` -> `patterns/<patternId>.md` +
  `index.md` + `stats.md`; same input produces byte-identical output.
- `ctx.systemPrompt.section()` injection of a short descriptive index
  (loop 1), bounded by `topN` / `maxIndexLines` / per-entry clip / total 12k.
- `wikiskill_hint` - read-only candidate signals from deterministic
  observations (`tools/result`, `agent/error`, `session/event`); candidates
  only, never auto-recorded.
- Signal hardening: optional-service failures never reject a tool call;
  a failed compile is diagnosed explicitly instead of reporting an empty wiki.
- `wikiskill_propose` (loop 2, P2): eligibility gate
  (`minCases` 20 AND `maxRepeat` 5 AND `minScenes` 3 AND frozen rubric),
  single-skill atomic drafts into `p2/deferred-proposals.md`, dry-run only.
- `wikiskill_release` (loop 2, P3): user-approved `SKILL.md` publication to a
  watched skill root (hot reload), skill-load hit receipts, and rollback that
  removes only the published `SKILL.md`.
- `publish` releases an existing P2 draft only: a name with no matching draft is
  refused, so an approved release can never emit a scaffold-only skill.
- Declared version window: `engines.node >= 20` and
  `engines.dsh ">=0.2.2-rc.1 <0.3.0-0"`, so DSH refuses an incompatible runtime
  before installing instead of failing after.
- `USER-APPROVED` token contract: `publish` / `rollback` are dry-run unless the
  user themself supplies the token; agent tools cannot self-approve.
- Exported `./locale/*.json` display metadata (en, zh) and `./icon`.
- `tools/verify.mjs` self-check: drives the plugin through a mock Cordis
  context against a real temporary wiki and asserts the hard invariants.

### Guarantees shipped with this release

- The descriptive wiki is never rolled back, and gate results never rewrite
  `patterns/`.
- `skills/` under the wiki root stays empty; published skills live only in the
  watched skill root, so they can be rolled back independently.
- The plugin writes only inside its own `root` (and the configured skill root);
  it never edits the profile's `cordis.patch.yml`.
- All registrations are effect-owned; unloading the plugin removes them.

### Known limits

- Host-only bundle: no Client UI, no settings panel.
- Tool output validation runs inside the Harness (`defineTool`); the shipped
  self-check asserts top-level schema consistency but cannot reproduce that
  validation layer, so real output validation is verified by the Harness.
- The P2 gate has never produced a real proposal from live data in the
  reference installation (4 annotated cases < 20); that path is covered by
  tests only, and is reported as such.
