#!/usr/bin/env bash

set -euo pipefail

repo_pwd="$PWD"
mkdir -p benchmark-output/{pr,base}

run_benchmark() {
  local target="$1"

  if [ "$target" = 'base' ]; then
    git clone --depth=1 --single-branch -b "$BUILDKITE_PULL_REQUEST_BASE_BRANCH" git@github.com:elastic/elastic-transport-js.git ../base
    pushd ../base
  fi

  npm install --silent
  npm run benchmark
  mv benchmark*.json "$repo_pwd/benchmark-output/$target"

  if [ "$target" = 'base' ]; then
    popd
  fi
}

changed_files=$(git diff --name-status "$BUILDKITE_PULL_REQUEST_BASE_BRANCH..$BUILDKITE_COMMIT" | awk '{print $2}' || true)

if ! echo "$changed_files" | grep -qiE '^(src/.*\.ts|test/benchmark/.*)$'; then
  exit 0
fi

run_benchmark base
run_benchmark pr

npm run benchmark:pr-comment
