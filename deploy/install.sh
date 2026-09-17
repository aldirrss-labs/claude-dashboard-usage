#!/usr/bin/env bash
#
# Install (or reinstall) the dashboard as a systemd user service.
#
# Everything machine-specific is discovered here rather than committed: the
# repo's location comes from where this script sits, and the node binary from
# whichever node is on PATH. Clone the repo anywhere, run this, and the unit
# points at the right places.
#
#   PORT=4317 HOST=127.0.0.1 deploy/install.sh
#
set -euo pipefail

SERVICE_NAME="claude-rooms.service"
# The unit was called this before the project was renamed. Left installed it
# would keep running the same server on the same port, so the new unit could
# never bind — hence it is retired here rather than merely ignored.
LEGACY_SERVICE_NAME="claude-dashboard.service"
PORT="${PORT:-4317}"
# Loopback by default: the dashboard has no authentication and, once accounts
# are saved, the database holds live OAuth tokens. Set HOST=0.0.0.0 only if you
# genuinely want it reachable from the network.
HOST="${HOST:-127.0.0.1}"

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_dir/.." && pwd)
template="$script_dir/${SERVICE_NAME}.in"
standalone="$repo_root/.next/standalone"

[ -f "$template" ] || die "missing template: $template"

if [ ! -f "$standalone/server.js" ]; then
  die "no build found at $standalone/server.js — run 'npm run build' first"
fi

# Static assets live outside the standalone output; npm's postbuild copies them
# in. Check rather than assume, because a missing copy produces a page that
# loads with every stylesheet and script 404ing, which is confusing to debug.
if [ ! -d "$standalone/.next/static" ]; then
  die "static assets missing from $standalone — run 'npm run build' (its postbuild step copies them)"
fi

command -v systemctl >/dev/null 2>&1 || die "systemctl not found; this installer targets systemd"
systemctl --user show-environment >/dev/null 2>&1 ||
  die "no systemd user session available (try logging in on a normal desktop/ssh session)"

node_bin=$(command -v node) || die "node not found on PATH"
# Resolve through nvm's shims: systemd user services do not source your shell
# profile, so ExecStart needs the real interpreter, not a wrapper on PATH.
node_bin=$(readlink -f "$node_bin")
[ -x "$node_bin" ] || die "resolved node is not executable: $node_bin"

# The MCP room shells out to `claude`, which is not on a systemd user service's
# PATH for the same reason node is not. Resolve it here; absence is a warning,
# not an error, since every other room works without it.
claude_bin=$(command -v claude 2>/dev/null || true)
[ -n "$claude_bin" ] && claude_bin=$(readlink -f "$claude_bin")

unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$unit_dir"
unit_path="$unit_dir/$SERVICE_NAME"

sed \
  -e "s|@WORKING_DIRECTORY@|$standalone|g" \
  -e "s|@NODE_BIN@|$node_bin|g" \
  -e "s|@PORT@|$PORT|g" \
  -e "s|@HOST@|$HOST|g" \
  -e "s|@CLAUDE_BIN@|${claude_bin:-claude}|g" \
  "$template" >"$unit_path"

printf 'wrote   %s\n' "$unit_path"
printf '  repo  %s\n' "$repo_root"
printf '  node  %s (%s)\n' "$node_bin" "$("$node_bin" --version)"
printf '  bind  %s:%s\n' "$HOST" "$PORT"
if [ -n "$claude_bin" ]; then
  printf '  claude %s\n' "$claude_bin"
else
  printf '  claude NOT FOUND — the MCP room will not be able to manage servers\n'
fi

legacy_unit="$unit_dir/$LEGACY_SERVICE_NAME"
if [ -f "$legacy_unit" ]; then
  systemctl --user disable --now "$LEGACY_SERVICE_NAME" >/dev/null 2>&1 || true
  rm -f "$legacy_unit"
  printf 'retired %s\n' "$legacy_unit"
fi

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
# `restart` rather than `enable --now`: --now only *starts* a stopped service,
# so re-running the installer against an already-running one would leave the
# old unit in effect and silently ignore the file just written.
systemctl --user restart "$SERVICE_NAME"

# Without lingering, the user manager is torn down at logout and takes the
# service with it. Reversible with `loginctl disable-linger $USER`.
if loginctl enable-linger "$USER" 2>/dev/null; then
  printf 'lingering enabled (service survives logout and reboot)\n'
else
  printf 'note: could not enable lingering; the service will stop when you log out.\n'
  printf '      run: loginctl enable-linger %s\n' "$USER"
fi

printf '\n'
systemctl --user --no-pager --lines=0 status "$SERVICE_NAME" || true
printf '\ndashboard: http://%s:%s\n' "$HOST" "$PORT"
