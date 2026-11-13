#!/usr/bin/env bash

set -euo pipefail

repo_pwd="$PWD"
mkdir -p benchmark-output/{pr,base}

git fetch origin "$BUILDKITE_PULL_REQUEST_BASE_BRANCH"
merge_base=$(git merge-base "origin/$BUILDKITE_PULL_REQUEST_BASE_BRANCH" "$BUILDKITE_COMMIT")

run_benchmark() {
  if [ "$1" = 'base' ]; then
    git worktree add ../base "$merge_base"
    pushd ../base
  fi

  npm install
  npm run benchmark
  mv benchmark*.json "$repo_pwd/benchmark-output/$1"

  if [ "$1" = 'base' ]; then
    popd
  fi
}

# exit early if no source files were changed
git diff --name-status "$merge_base..$BUILDKITE_COMMIT" | awk '{print $2}' | grep -iE '^(src/.*\.ts|test/benchmark/.*)$' || exit 0

run_benchmark base
run_benchmark pr

npm run benchmark:pr-comment
