# Testing

## Automated checks

```bash
npm test
npm pack --dry-run
```

`npm test` runs `scripts/check-release.mjs`, which verifies the package name, author, license, repository, bundle patch, Host/Client identities, locale metadata, required files and the absence of local debug endpoints. It has no dependencies.

`npm pack --dry-run` confirms the published file set. The tarball should contain `index.js`, `client.js`, `cordis.patch.yml`, `icon.svg`, both locales, `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md` and the release-check script.

## Manual smoke test

Use a disposable DSH profile, not a working one:

1. Install the package from the local checkout.
2. Open the Plugin Supervisor panel from the sidebar shield icon.
3. Confirm overview, health, usage, market and token tabs render.
4. Open a plugin detail; confirm the history row shows a backup only when one exists.
5. Update a test plugin and confirm the inline progress bar advances and the row returns to normal afterwards.
6. Restore the backup and confirm the plugin version and files return.
7. Delete the backup and confirm it disappears from the history menu.

Do not run update, uninstall or restore tests against the only copy of a plugin you need.
