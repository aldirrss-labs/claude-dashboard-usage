# Deploying as a systemd user service

No root or sudo required — this runs as a **user** service under your own account.

## Install

```bash
npm install
npm run build
deploy/install.sh
```

That is the whole thing. The dashboard is then at `http://127.0.0.1:4317`, running at all times and
independent of any terminal session.

`install.sh` discovers everything machine-specific rather than assuming it:

- **Where the repo is** — taken from the script's own location, so the repo can be cloned anywhere.
- **Which node to use** — resolved from `PATH` and dereferenced through any nvm shim. systemd user
  services do not source your shell profile, so the unit needs an absolute path to the real
  interpreter.
- **Whether the build exists** — it refuses to install a unit that would start and immediately fail,
  and separately checks that `postbuild` copied the static assets in (without them the page loads
  with every stylesheet and script 404ing, which is a confusing way to find out).

The unit itself is generated from [`claude-rooms.service.in`](claude-rooms.service.in) into
`~/.config/systemd/user/claude-rooms.service`. The template is committed; the filled-in unit is
not, because its two most important values differ on every machine.

### Options

```bash
PORT=8080 deploy/install.sh          # different port
HOST=0.0.0.0 deploy/install.sh       # reachable from the network — read the warning below first
```

The service binds to `127.0.0.1` by default. **Think before changing that.** The dashboard has no
authentication of any kind, and once you save accounts, its database holds live OAuth tokens for
every one of them — anyone who can reach the port can read them and switch your active login.

## Redeploying after code changes

```bash
npm run build
systemctl --user restart claude-rooms.service
```

Re-run `deploy/install.sh` as well if you moved the repo, changed node version, or want a different
port — it rewrites the unit and restarts in one step.

The SQLite database at `~/.claude-dashboard/usage.db` is untouched by rebuilds, so historical usage
survives every redeploy.

## Checking on it

```bash
systemctl --user status claude-rooms.service
journalctl --user -u claude-rooms.service -f
```

## Uninstalling

```bash
systemctl --user disable --now claude-rooms.service
rm ~/.config/systemd/user/claude-rooms.service
systemctl --user daemon-reload
loginctl disable-linger "$USER"   # optional
```

This leaves `~/.claude-dashboard/` in place. Delete that directory too if you want the usage history
and saved account credentials gone.

## Troubleshooting

- **Port already in use**: reinstall on another port with `PORT=<free port> deploy/install.sh`.
- **Service won't start after a reboot**: confirm lingering is on with
  `loginctl show-user "$USER" | grep Linger` — it should read `Linger=yes`. `install.sh` enables it,
  but says so if it could not.
- **Page loads unstyled, console full of 404s**: the standalone build is missing its static assets.
  Run `npm run build` again — the `postbuild` script copies them — then restart the service.
- **Stale data / ingestion not running**: check
  `journalctl --user -u claude-rooms.service` for `[ingest] cycle failed`. The scheduler runs
  every 5 minutes and retries on its own; one failed cycle does not stop the service.
- **`node not found on PATH`**: if node comes from nvm, run the installer from an interactive shell
  where `node --version` works, since that is where the path is resolved from.
