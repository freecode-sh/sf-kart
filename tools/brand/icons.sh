#!/bin/sh
# Draws the favicon from the course chart's lap (tools/brand/favicon.ts → public/favicon.svg) and
# rasterizes its PNG fallbacks (tools/brand/icons.ts). Run after tools/sf/bakeChart.ts.
#
# Usage: sh tools/brand/icons.sh

set -eu
cd "$(dirname "$0")/../.."
npx tsx tools/brand/favicon.ts
npx tsx tools/brand/icons.ts
