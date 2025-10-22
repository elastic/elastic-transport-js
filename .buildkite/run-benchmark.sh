#!/usr/bin/env bash

set -euo pipefail

script_path=$(dirname "$(realpath -s "$0")")
repo=$(pwd)

export NODE_VERSION=${NODE_VERSION:-22}

echo "--- :nodejs: Node.js version: $NODE_VERSION"
node --version
npm --version

echo "--- :javascript: Building Docker image"
docker build \
  --file "$script_path/Dockerfile" \
  --tag elastic/transport-benchmark \
  --build-arg NODE_VERSION="$NODE_VERSION" \
  .

echo "--- :chart_with_upwards_trend: Running benchmarks"
mkdir -p "$repo/benchmark-results"

docker run \
  --env "NODE_VERSION=$NODE_VERSION" \
  --env "BUILDKITE=${BUILDKITE:-false}" \
  --env "BUILDKITE_BUILD_NUMBER=${BUILDKITE_BUILD_NUMBER:-0}" \
  --env "BUILDKITE_BRANCH=${BUILDKITE_BRANCH:-unknown}" \
  --env "BUILDKITE_COMMIT=${BUILDKITE_COMMIT:-unknown}" \
  --env "BUILDKITE_PULL_REQUEST=${BUILDKITE_PULL_REQUEST:-false}" \
  --volume "$repo/benchmark-results:/usr/src/app/benchmark-results" \
  --name transport-benchmark \
  --rm \
  elastic/transport-benchmark \
  bash -c "npx tsx scripts/benchmark/run-all-benchmarks.ts"

echo "--- :white_check_mark: Benchmark complete"
ls -lh "$repo/benchmark-results"

