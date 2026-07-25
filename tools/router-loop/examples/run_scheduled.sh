#!/usr/bin/env bash
#
# The "heartbeat" -- the automation layer that turns a one-off run into a loop
# that runs on its own. Point cron (or a systemd timer, or a CI schedule) at
# this script. Findings come to you; you are not the one kicking it off.
#
# Example crontab entry (every weekday at 07:00):
#   0 7 * * 1-5  /home/user/router/examples/run_scheduled.sh >> /home/user/router/.router/cron.log 2>&1
#
# Inside Claude Code you can get the same heartbeat without cron by wrapping the
# run in `/loop` (re-run on an interval) or `/goal` (keep going until true).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

SPEC="${1:-examples/fix_tests_spec.json}"

# A stop condition still applies every run: the spec's max_iterations and
# max_cost_usd bound each invocation, and this script exits non-zero if the
# loop failed to converge so the scheduler surfaces it.
exec python -m router_loop run --spec "$SPEC"
