#!/usr/bin/env node
/**
 * Release consistency checks for dsh-plugin-supervisor.
 *
 * These checks are intentionally dependency-free so they run in CI before
 * anything is published. They verify the public package shape, the identities
 * used by the Host and Client halves, and the absence of local-only debug
 * endpoints.
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

function check(condition, message) {
  if (!condition) failures.push(message)
}

const pkg = JSON.parse(read('package.json'))
check(pkg.name === 'dsh-plugin-supervisor', 'package.name must be dsh-plugin-supervisor')
check(pkg.version === '1.0.0', 'package.version must be 1.0.0')
check(pkg.private === undefined, 'package.private must be absent for a public release')
check(pkg.author === 'CYKshaozi', 'package.author must be CYKshaozi')
check(pkg.license === 'MIT', 'package.license must be MIT')
check(typeof pkg.repository?.url === 'string' && pkg.repository.url.includes('2033453490/dsh-plugin-supervisor'), 'repository.url must point at the public repository')
check(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch must be ./cordis.patch.yml')
check(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform must be web')
check(Array.isArray(pkg.files) && pkg.files.includes('README.md') && pkg.files.includes('LICENSE'), 'files must include README.md and LICENSE')

const patch = read('cordis.patch.yml')
check(patch.includes("name: 'dsh-plugin-supervisor'"), 'cordis.patch.yml must use the public package name')

const host = read('index.js')
check(host.includes("const SELF = 'dsh-plugin-supervisor'"), 'Host SELF constant must match the public package name')
check(!host.includes('@local/dsh-plugin-supervisor'), 'Host must not reference the local package alias')
check(!/api\/debug|api\/client-error|api\/action-log/.test(host), 'Host must not expose local debug endpoints')

const client = read('client.js')
check(client.includes("id: 'dsh-plugin-supervisor'"), 'Client module id must match the public package name')
check(!client.includes('@local/dsh-plugin-supervisor'), 'Client must not reference the local package alias')
check(!client.includes('client-error'), 'Client must not report to a local-only debug endpoint')

const zh = JSON.parse(read('locale/zh.json'))
const en = JSON.parse(read('locale/en.json'))
check(typeof zh.meta?.title === 'string' && zh.meta.title.length > 0, 'locale/zh.json must declare meta.title')
check(typeof en.meta?.title === 'string' && en.meta.title.length > 0, 'locale/en.json must declare meta.title')

for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE']) {
  check(fs.existsSync(path.join(root, file)), `required file is missing: ${file}`)
}

if (failures.length > 0) {
  console.error('Release checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Release checks passed')
