# Architecture

`dsh-plugin-supervisor` has two halves:

- **Host** (`index.js`) runs inside the DeepSeek Harness host process. It reads the live plugin inventory, scans local session logs, checks npm metadata, fetches the public market index, and performs plugin-manager actions.
- **Client** (`client.js`) is a plain-JS React module served to the Harness Web UI. It renders the sidebar icon, the main panel and the per-plugin history menus. It talks to the Host through same-origin HTTP endpoints under `/__plugin-supervisor/api/`.

There is no build step and there are no runtime npm dependencies.

## Host data flow

1. **Inventory** — `pluginManager.listBundles()` / `listPlugins()` provide installed packages, rows, activation phases and install targets. The current DSH version comes from `clientModules.graph().release.version`.
2. **Session usage** — `sessionQuery.listSessions()` and `readSession()` provide tool calls and tool results. Usage is folded into daily buckets per tool so different time windows can be aggregated without rescanning.
3. **Tool ownership** — MCP tools are mapped exactly by their `mcp__<server>__` prefix. Other tools are matched to package source code using registration patterns and tool-name constants. Ambiguous matches are reported as shared or left as built-in tools.
4. **Token estimates** — tool-result size is estimated from model-visible content; standing Schema overhead is estimated from the JSON tool schema multiplied by model steps. These are estimates, not provider billing records.
5. **Version checks** — npm packuments are fetched from the configured registry; the newest version compatible with the running DSH is selected from declared `engines.dsh` / `peerDependencies`.
6. **Market** — `https://awesome-dsh-plugin.com/plugins.json` supplies the public catalog; npm's download API enriches the top entries with last-week downloads.

Caches are in memory and, where useful, under `~/.dsh/plugin-supervisor/`.

## HTTP endpoints

- `GET /api/snapshot` — inventory, health, usage, token and history summary.
- `GET /api/market` — market recommendations, with optional refresh.
- `GET /api/backups` — local version backups, without absolute paths.
- `GET /api/job?id=...` — progress and result of a long-running action.
- `POST /api/action` — start a mutation such as update, uninstall, install, restore or delete backup.

Mutations are serialized through one in-process queue. The client polls the job and renders progress inline on the affected plugin row.

## Update and backup flow

1. Resolve a DSH-compatible target version.
2. Back up the current package directory under `~/.dsh/plugin-supervisor/backups/<package>/<version>-<timestamp>/`. If the backup fails, the update is cancelled.
3. Remove the old bundle through `pluginManager.removeBundle()`.
4. Install the new version through `pluginManager.installBundle()`.
5. If installation fails, attempt to reinstall the previous version and keep the backup.

Restore installs the backup's version when necessary, then overlays the backed-up files onto the package directory. It keeps the backup after a restore.

## Security boundaries

- The HTTP server is local-only in practice; cross-site origins are rejected.
- No session content, plugin list or usage data is uploaded.
- Mutating actions are user-triggered from the local UI and go through the Harness plugin manager.
- The public release contains no local debug routes.
