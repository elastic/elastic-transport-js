#!/usr/bin/env bash

set -euo pipefail

source ~/.asdf/asdf.sh
asdf plugin add nodejs || true
asdf install nodejs latest:22
asdf global nodejs latest:22

BENCHMARK_RUNS=3

repo_pwd="$PWD"
mkdir -p benchmark-output/{pr,base}

run_benchmark() {
  local target="$1"

  if [ "$target" = 'base' ]; then
    git clone --depth=1 --single-branch -b "$BUILDKITE_PULL_REQUEST_BASE_BRANCH" git@github.com:elastic/elastic-transport-js.git ../base
    pushd ../base
  fi

  npm install --silent

  for i in $(seq 1 $BENCHMARK_RUNS); do
    npm run benchmark
    mv benchmark.json "$repo_pwd/benchmark-output/${target}-run${i}.json"
    mv benchmark-gc.json "$repo_pwd/benchmark-output/${target}-gc-run${i}.json"
  done

  if [ "$target" = 'base' ]; then
    popd
  fi
}

changed_files=$(git diff --name-status "$BUILDKITE_PULL_REQUEST_BASE_BRANCH..$BUILDKITE_COMMIT" | awk '{print $2}' || true)

if ! echo "$changed_files" | grep -qiE '^(src/.*\.ts|test/benchmark/.*|scripts/.*benchmark.*|\.buildkite/benchmark.*)$'; then
  exit 0
fi

run_benchmark base
run_benchmark pr

node scripts/aggregate-benchmarks.mjs
npm run benchmark:pr-comment
