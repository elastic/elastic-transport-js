#!/usr/bin/env bash
#
# Aggregate benchmark results from all matrix jobs
#
set -euo pipefail

repo=$(pwd)
results_dir="$repo/benchmark-results"

echo "--- :bar_chart: Aggregating benchmark results"

# Download all artifacts from previous steps
buildkite-agent artifact download "benchmark-results/*.json" .
buildkite-agent artifact download "benchmark-results/*.md" .

echo "--- :memo: Creating summary"

# Create a summary markdown file
cat > "$results_dir/summary.md" << 'EOF'
# Elastic Transport Benchmark Results

## Build Information
EOF

echo "- **Build Number**: ${BUILDKITE_BUILD_NUMBER:-N/A}" >> "$results_dir/summary.md"
echo "- **Branch**: ${BUILDKITE_BRANCH:-N/A}" >> "$results_dir/summary.md"
echo "- **Commit**: ${BUILDKITE_COMMIT:-N/A}" >> "$results_dir/summary.md"
echo "- **Triggered By**: ${BUILDKITE_BUILD_CREATOR:-Manual}" >> "$results_dir/summary.md"
echo "" >> "$results_dir/summary.md"

# Append individual result files
for md_file in "$results_dir"/results-node-*.md; do
  if [ -f "$md_file" ]; then
    echo "Adding results from $md_file"
    cat "$md_file" >> "$results_dir/summary.md"
    echo "" >> "$results_dir/summary.md"
  fi
done

# Show comparison if exists
for comparison_file in "$results_dir"/comparison-*.md; do
  if [ -f "$comparison_file" ]; then
    echo "Adding comparison from $comparison_file"
    cat "$comparison_file" >> "$results_dir/summary.md"
    echo "" >> "$results_dir/summary.md"
  fi
done

echo "--- :eyes: Summary preview"
cat "$results_dir/summary.md"

echo "--- :white_check_mark: Aggregation complete"

