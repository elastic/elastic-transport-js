#!/usr/bin/env bash

set -euo pipefail

repo_pwd="$PWD"
mkdir -p benchmark-output/{pr,base}

run_benchmark() {
  if [ "$1" = 'base' ]; then
    git clone --depth=1 --single-branch -b "$BUILDKITE_PULL_REQUEST_BASE_BRANCH" git@github.com:elastic/elastic-transport-js.git ../base
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
git diff --name-status $BUILDKITE_PULL_REQUEST_BASE_BRANCH..$BUILDKITE_COMMIT | awk '{print $2}' | grep -iE '^(src/.*\.ts|test/benchmark/.*)$' || exit 0

run_benchmark base
run_benchmark pr

npm run benchmark:pr-comment
