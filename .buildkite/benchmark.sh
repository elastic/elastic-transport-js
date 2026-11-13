#!/usr/bin/env bash

set -euo pipefail

mkdir -p benchmark-output/{pr,base}

git fetch origin "$BUILDKITE_PULL_REQUEST_BASE_BRANCH"
merge_base=$(git merge-base "origin/$BUILDKITE_PULL_REQUEST_BASE_BRANCH" "$BUILDKITE_COMMIT")

# exit early if no source files were changed
git diff --name-status "$merge_base..$BUILDKITE_COMMIT" | awk '{print $2}' | grep -iE '^(src/.*\.ts|test/benchmark/.*)$' || exit 0

# build both versions, then run the PR's benchmark code against each
npm install
npm run build
git worktree add ../base "$merge_base"
(cd ../base && npm install && npm run build)

run_benchmark() {
  TRANSPORT_PATH="$2" npm run benchmark:mitata
  TRANSPORT_PATH="$2" npm run benchmark:gc
  mv benchmark*.json "benchmark-output/$1"
}

run_benchmark base "$(cd ../base && pwd)/index.js"
run_benchmark pr "$PWD/index.js"

npm run benchmark:pr-comment
