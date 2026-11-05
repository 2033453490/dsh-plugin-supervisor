# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting:

<https://github.com/2033453490/dsh-plugin-supervisor/security/advisories/new>

Do not open a public issue for a vulnerability. Include the affected version, a minimal reproduction, and the impact you believe it has. Reports are reviewed on a best-effort basis; this is a small community plugin without a bug bounty.

## Scope and data access

The plugin runs entirely on the local machine:

- It reads the Harness plugin inventory, installed package manifests and local session logs.
- It writes settings and version backups under `~/.dsh/plugin-supervisor/`.
- It contacts the npm registry and `https://awesome-dsh-plugin.com/plugins.json` to check versions and market listings.
- It does not upload plugin inventories, session content, credentials or usage data.
- Update, uninstall and restore actions are executed by the local Harness plugin manager after an in-page confirmation.

The local HTTP API is intended for the local Web UI. Cross-site origins are rejected; the remaining endpoints assume a trusted local user.
