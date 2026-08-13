# Deploying as a systemd user service

1. Build the app:

   ```bash
   cd /mnt/data/Project/WEB/claude-dashboard-usage
   npm run build
   ```

   This produces `.next/standalone/server.js`. Static assets and public files need to
   be copied manually since standalone mode doesn't include them by default:

   ```bash
   cp -r .next/static .next/standalone/.next/static
   cp -r public .next/standalone/public 2>/dev/null || true
   ```

2. Install the unit as a **user** service (no root/sudo required). If Node is
   installed via nvm (as opposed to a system package), systemd user services don't
   source your shell profile, so `ExecStart` needs an absolute path to the node
   binary rather than relying on `PATH`. Check yours with `which node` and update
   `ExecStart` in `deploy/claude-dashboard.service` if it differs from the
   `%h/.nvm/versions/node/v24.15.0/bin/node` default:

   ```bash
   mkdir -p ~/.config/systemd/user
   cp deploy/claude-dashboard.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now claude-dashboard.service
   ```

3. Enable lingering so the service keeps running after logout:

   ```bash
   loginctl enable-linger $USER
   ```

4. Check status and logs:

   ```bash
   systemctl --user status claude-dashboard.service
   journalctl --user -u claude-dashboard.service -f
   ```

5. The dashboard is now reachable at `http://localhost:4317` at all times, independent
   of any terminal session.

6. To redeploy after code changes: repeat step 1, then:

   ```bash
   systemctl --user restart claude-dashboard.service
   ```

   The SQLite database at `~/.claude-dashboard/usage.db` is untouched by rebuilds —
   historical usage data survives every redeploy.

## Troubleshooting

- **Port already in use**: change `Environment=PORT=4317` in the unit file to a free
  port, then `systemctl --user daemon-reload && systemctl --user restart claude-dashboard.service`.
- **Service won't start after a reboot**: confirm lingering is enabled with
  `loginctl show-user $USER | grep Linger` — it should read `Linger=yes`.
- **Stale data / ingestion not running**: check `journalctl --user -u claude-dashboard.service`
  for `[ingest] cycle failed` log lines. The scheduler runs every 5 minutes and retries
  automatically; a single failed cycle does not stop the service.
