#!/usr/bin/env bash

repo_pwd="$PWD"
mkdir -p benchmark-output/{pr,base}

run_benchmark() {
  if [ "$1" = 'base' ]; then
    git clone --depth=1 --single-branch -b "$GITHUB_PR_TARGET_BRANCH" git@github.com:elastic/elastic-transport-js.git ../base
    pushd ../base
  fi

  npm install
  npm run benchmark
  mv benchmark*.json "$repo_pwd/benchmark-output/$1"

  if [ "$1" = 'base' ]; then
    popd
  fi
}

run_benchmark base
run_benchmark pr

npm run benchmark:pr-comment
