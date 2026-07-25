#!/usr/bin/env bash
#
# Drop the router loop into the project you are currently in.
#
# Usage -- from inside the repo you want to add the loop to:
#     /path/to/router/bootstrap.sh
#
# It copies the self-contained `router_loop/` package into the current
# directory (zero dependencies, nothing to install), scaffolds a
# router.spec.json by auto-detecting your verifier, and prints the run command.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="$(pwd)"

if [[ "$SRC_DIR" == "$DEST_DIR" ]]; then
  echo "Run this from *inside the target project*, not from the router repo." >&2
  exit 1
fi

echo "Copying router_loop/ into $DEST_DIR ..."
cp -r "$SRC_DIR/router_loop" "$DEST_DIR/router_loop"

# Scaffold a spec (auto-detects the gate). Non-fatal if one already exists.
python3 -m router_loop init || true

echo
echo "Done. The loop is now vendored in ./router_loop (no install needed)."
echo "Next:"
echo "  1. Open router.spec.json, confirm the 'goal' and the command_gate."
echo "  2. Crank it:   python3 -m router_loop run --spec router.spec.json"
echo
echo "Orchestrator uses Fable, falling back to Opus automatically when Fable"
echo "is unavailable or out of credits."
