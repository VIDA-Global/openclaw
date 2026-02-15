# VIDA Release Sync Workflow

This is the repeatable process for syncing upstream OpenClaw releases into the VIDA fork and validating downstream Docker compatibility.

## 1) Sync latest upstream release into fork

Run from `openclaw`:

```sh
cd /home/lylepratt/workspace/openclaw
scripts/sync-upstream-release.sh
```

Default behavior:
- resolves latest upstream non-beta tag (`v*`)
- creates `release-sync/<tag>` from `origin/main`
- merges upstream release tag
- pushes branch
- creates and pushes fork tag `vida-<tag>` (example: `vida-v2026.2.14`)
- runs downstream verifier (`scripts/verify-vida-release.sh`)

Useful variants:

```sh
# Explicit release tag/branch/tag-name
scripts/sync-upstream-release.sh \
  --tag v2026.2.14 \
  --branch release-sync/v2026.2.14 \
  --fork-tag vida-v2026.2.14

# Preview only
scripts/sync-upstream-release.sh --dry-run

# Skip verifier
scripts/sync-upstream-release.sh --no-verify
```

## 2) If merge conflicts happen

When the merge fails, the script writes a Codex handoff prompt file:

- default path: `tmp/codex-handoff-<tag>.md`
- includes unresolved files and exact next steps

Then resolve conflicts, commit, and push:

```sh
git add <resolved files>
git commit
git push -u origin <release-sync-branch>
git push origin <fork-tag>
```

Optional handoff controls:

```sh
# Disable handoff generation
scripts/sync-upstream-release.sh --no-codex-handoff

# Custom handoff file path
scripts/sync-upstream-release.sh --codex-handoff-path /tmp/my-handoff.md
```

## 3) Re-run downstream compatibility checks

Run from `openclaw`:

```sh
scripts/verify-vida-release.sh --fork-tag vida-v2026.2.14
```

What it verifies:
- fork tag exists on `origin`
- `openclaw-docker` build/push previews use expected `OPENCLAW_REF`
- expected Docker image tag derivation (for example `vida-v2026.2.14` -> `2026-02-14`)
- `--no-cache` and `--push` flags are present where expected

Useful variants:

```sh
# Verify a different docker ref
scripts/verify-vida-release.sh --fork-tag vida-v2026.2.14 --openclaw-ref vida-v2026.2.14

# Skip docker checks
scripts/verify-vida-release.sh --skip-docker
```

## 4) Docker publish usage (openclaw-docker)

```sh
cd /home/lylepratt/workspace/openclaw-docker
GITHUB_TOKEN=<github_pat_with_repo_access> make push
```

Default pushed image tag is date-style, e.g.:

- `vidaislive/openclaw-docker:2026-02-14`
