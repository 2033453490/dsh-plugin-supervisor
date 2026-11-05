# Marketplace submission

The DSH plugin market reads the public [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) catalog. Listing is a pull request against that catalog, not a separate upload service.

## Eligibility

The catalog CI checks, in order:

1. `package.json` declares `dsh.bundle.patch` and the patch file exists.
2. The repository is at least one day old and has at least 10 commits.
3. The repository carries the `dsh-plugin` topic.
4. `awesome-lint` and the site build pass.

This repository already has `dsh.bundle.patch`, `cordis.patch.yml`, the `dsh-plugin` topic and real code. The age and commit-count gates become true over time; they are not bypassed by this document.

## Publish npm first (recommended)

Publishing to npm is optional for listing but gives the market a download count and avoids build approval on install.

```bash
npm login
npm publish --access public
```

The package's `repository` field must point back at the listed GitHub repository. It does.

## Open the catalog PR

Fork `awesome-dsh-plugin/awesome-dsh-plugin`, then add exactly one file:

```text
data/plugins/2033453490__dsh-plugin-supervisor.yml
```

Use the content in [`market/2033453490__dsh-plugin-supervisor.yml`](../market/2033453490__dsh-plugin-supervisor.yml):

```yaml
url: https://github.com/2033453490/dsh-plugin-supervisor
name: 2033453490/dsh-plugin-supervisor
category: market
description:
  en: '...'
  zh: '...'
```

Do not add an `npm:` field; the catalog links npm packages automatically through the package's `repository` field. Do not edit the generated READMEs by hand. One PR may add at most three entries.

## Screenshots (optional)

Storefronts can show 1–8 screenshots. Add a `screenshots.json` next to `package.json` listing repository-relative image paths; absolute URLs must be GitHub-hosted `https`. Without it, storefronts fall back to images extracted from the README.
