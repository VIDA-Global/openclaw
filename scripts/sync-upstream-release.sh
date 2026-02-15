#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/sync-upstream-release.sh [--tag <vYYYY.M.D>] [--branch <branch-name>] [--base <ref>] [--fork-tag <name>] [--fork-tag-prefix <prefix>] [--no-fork-tag] [--no-push] [--dry-run] [--allow-dirty]

Defaults:
  --tag      latest upstream non-beta release tag
  --branch   release-sync/<tag>
  --base     origin/main
  --fork-tag explicit fork release tag name (default: <prefix><tag>)
  --fork-tag-prefix fork tag prefix when --fork-tag is omitted (default: vida-)
  --no-fork-tag do not create a fork release tag
  --no-push  do not push branch to origin
  --dry-run  print computed values and exit
  --allow-dirty skip clean-tree check
USAGE
}

TAG=""
BRANCH=""
BASE_REF="origin/main"
PUSH=1
DRY_RUN=0
ALLOW_DIRTY=0
CREATE_FORK_TAG=1
FORK_TAG=""
FORK_TAG_PREFIX="vida-"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --branch)
      BRANCH="${2:-}"
      shift 2
      ;;
    --base)
      BASE_REF="${2:-}"
      shift 2
      ;;
    --fork-tag)
      FORK_TAG="${2:-}"
      shift 2
      ;;
    --fork-tag-prefix)
      FORK_TAG_PREFIX="${2:-}"
      shift 2
      ;;
    --no-fork-tag)
      CREATE_FORK_TAG=0
      shift
      ;;
    --no-push)
      PUSH=0
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --allow-dirty)
      ALLOW_DIRTY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: run this script inside a git repository." >&2
  exit 1
fi

if [[ "$ALLOW_DIRTY" -ne 1 ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash changes first." >&2
  exit 1
fi

echo "Fetching remotes..."
git fetch --prune upstream --tags
git fetch --prune origin --tags

if [[ -z "$TAG" ]]; then
  TAG="$(git for-each-ref refs/tags --format='%(refname:short)' --sort=-creatordate | grep -E '^v[0-9]' | grep -v -- '-beta' | head -n 1 || true)"
fi

if [[ -z "$TAG" ]]; then
  echo "Error: could not determine upstream release tag." >&2
  exit 1
fi

if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "Error: tag '$TAG' not found locally after fetch." >&2
  exit 1
fi

if ! git rev-parse -q --verify "$BASE_REF" >/dev/null; then
  echo "Error: base ref '$BASE_REF' not found." >&2
  exit 1
fi

if [[ -z "$BRANCH" ]]; then
  BRANCH="release-sync/$TAG"
fi

if [[ "$CREATE_FORK_TAG" -eq 1 ]] && [[ -z "$FORK_TAG" ]]; then
  FORK_TAG="${FORK_TAG_PREFIX}${TAG}"
fi

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "Error: local branch '$BRANCH' already exists." >&2
  exit 1
fi

if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  echo "Error: origin branch '$BRANCH' already exists." >&2
  exit 1
fi

echo "Tag:      $TAG"
echo "Base ref: $BASE_REF"
echo "Branch:   $BRANCH"
if [[ "$CREATE_FORK_TAG" -eq 1 ]]; then
  echo "Fork tag: $FORK_TAG"
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry run complete."
  exit 0
fi

echo "Creating branch..."
git checkout -b "$BRANCH" "$BASE_REF"

echo "Merging release tag $TAG..."
set +e
git merge --no-ff --no-edit "$TAG"
MERGE_EXIT=$?
set -e

if [[ "$MERGE_EXIT" -ne 0 ]]; then
  echo
  echo "Merge reported conflicts or errors on branch '$BRANCH'." >&2
  echo "Resolve conflicts, commit, then push manually:" >&2
  echo "  git push -u origin $BRANCH" >&2
  exit "$MERGE_EXIT"
fi

if [[ "$PUSH" -eq 1 ]]; then
  echo "Pushing branch to origin..."
  git push -u origin "$BRANCH"
fi

if [[ "$CREATE_FORK_TAG" -eq 1 ]]; then
  if git rev-parse -q --verify "refs/tags/$FORK_TAG" >/dev/null; then
    echo "Error: local tag '$FORK_TAG' already exists." >&2
    exit 1
  fi
  if git ls-remote --exit-code --tags --refs origin "$FORK_TAG" >/dev/null 2>&1; then
    echo "Error: origin tag '$FORK_TAG' already exists." >&2
    exit 1
  fi
  echo "Creating fork tag '$FORK_TAG'..."
  git tag -a "$FORK_TAG" -m "Fork release aligned with upstream $TAG"
  if [[ "$PUSH" -eq 1 ]]; then
    echo "Pushing fork tag '$FORK_TAG' to origin..."
    git push origin "$FORK_TAG"
  fi
fi

echo "Done. Branch '$BRANCH' now contains merge of '$TAG' into '$BASE_REF'."
