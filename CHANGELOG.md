# Changelog

## 1.0.0 — 2026-11-06

Initial public release.

- Sidebar panel with overview, health, usage, market and token-cost views.
- Plugin inventory, DSH compatibility and update checks based on the running host.
- Per-plugin usage attribution from local session logs, with explicit handling of UI-only plugins.
- Per-plugin token estimates from tool result content and standing tool-schema overhead.
- Plugin market browse and one-click install from the awesome-dsh-plugin index.
- In-page update, disable, uninstall and restore actions.
- Automatic local version backup before every update, with per-plugin history, restore and confirmed deletion.
- Inline update progress with phase and percentage feedback.
- No runtime npm dependencies; all data stays local except npm registry and market index requests.
