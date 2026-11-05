import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const SELF = 'dsh-plugin-supervisor'
const ROUTE = '/__plugin-supervisor'
const DAY = 86400000
const MINUTE = 60000
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

function resolveProfileDir() {
  const explicit = process.env.DSH_PROFILE_DIR
  if (explicit && fs.existsSync(path.join(explicit, 'node_modules'))) return explicit
  const root = path.join(DSH_HOME, 'profiles')
  const candidates = []
  if (process.env.DSH_PROFILE) candidates.push(path.join(root, process.env.DSH_PROFILE))
  try {
    for (const name of fs.readdirSync(root)) {
      if (name.includes('.bak-')) continue
      candidates.push(path.join(root, name))
    }
  } catch { /* no profiles directory */ }
  for (const dir of candidates) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      const dependencies = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) }
      if (dependencies[SELF]) return dir
    } catch { /* next candidate */ }
  }
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'node_modules'))) return dir
  }
  return ''
}

const PROFILE_DIR = resolveProfileDir()

function sourceDirOf(source) {
  if (typeof source !== 'string') return null
  if (source.startsWith('link:')) {
    const candidate = path.resolve(source.slice(5))
    return fs.existsSync(candidate) ? candidate : null
  }
  if (source.startsWith('file://')) {
    try {
      const candidate = fileURLToPath(source)
      return fs.existsSync(candidate) ? candidate : null
    } catch { return null }
  }
  return null
}

const MARKET_URL = 'https://awesome-dsh-plugin.com/plugins.json'

const CORE_TOOLS = new Set([
  'ask_user_question', 'bash', 'pwsh', 'read', 'write', 'edit', 'glob', 'grep', 'read_image',
  'web_search', 'web_fetch', 'todo_write', 'create_goal', 'update_goal', 'get_goal', 'skill',
  'subagent', 'subagent_fork', 'list_agents', 'send_message', 'interrupt_agent',
  'job_kill', 'job_list', 'job_output', 'schedule_create', 'schedule_delete', 'schedule_list',
  'schedule_update', 'present', 'working_directory', 'workflow', 'lsp', 'ralph',
  'spawn_teammate', 'wait_agent', 'team_task_create', 'team_task_get', 'team_task_list',
  'team_task_update', 'list_subagent_models', 'session_search', 'session_trace', 'session_event_read',
  'session_event_search', 'session_event_trace', 'terminal_list', 'terminal_open', 'terminal_read',
  'terminal_signal', 'terminal_close',
])

const zstdDecompress = (buffer) => Promise.resolve(zlib.zstdDecompressSync(buffer))

function parseVersion(value) {
  if (typeof value !== 'string') return null
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)) : [],
    raw: value.trim(),
  }
}

function comparePre(a, b) {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  const size = Math.max(a.length, b.length)
  for (let i = 0; i < size; i += 1) {
    const left = a[i]
    const right = b[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue
    if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1
    if (typeof left === 'number') return -1
    if (typeof right === 'number') return 1
    return left < right ? -1 : 1
  }
  return 0
}

function compareVersion(a, b) {
  const left = typeof a === 'string' ? parseVersion(a) : a
  const right = typeof b === 'string' ? parseVersion(b) : b
  if (!left || !right) return 0
  if (left.major !== right.major) return left.major < right.major ? -1 : 1
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1
  return comparePre(left.pre, right.pre)
}

function bump(version, kind) {
  const parsed = parseVersion(version)
  if (!parsed) return null
  if (kind === 'major') return `${parsed.major + 1}.0.0`
  if (kind === 'minor') return `${parsed.major}.${parsed.minor + 1}.0`
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
}

function satisfies(version, range) {
  const parsed = parseVersion(version)
  if (!parsed || typeof range !== 'string' || !range.trim()) return null
  const alternatives = range.split('||').map((part) => part.trim()).filter(Boolean)
  for (const alternative of alternatives) {
    const tokens = alternative.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    let ok = true
    for (const token of tokens) {
      let operator = ''
      let raw = token
      const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(token)
      if (match) { operator = match[1] || ''; raw = match[2] }
      if (raw === '*' || raw === 'x') continue
      if (!parseVersion(raw)) { ok = false; break }
      let lower = raw
      let upper = null
      if (operator === '^') {
        const base = parseVersion(raw)
        if (base.major > 0) upper = `${base.major + 1}.0.0-0`
        else if (base.minor > 0) upper = `0.${base.minor + 1}.0-0`
        else upper = `0.0.${base.patch + 1}-0`
      } else if (operator === '~') {
        const base = parseVersion(raw)
        upper = `${base.major}.${base.minor + 1}.0-0`
      }
      if (upper) {
        ok = compareVersion(parsed, lower) >= 0 && compareVersion(parsed, upper) < 0
      } else if (operator === '>=') ok = compareVersion(parsed, raw) >= 0
      else if (operator === '>') ok = compareVersion(parsed, raw) > 0
      else if (operator === '<=') ok = compareVersion(parsed, raw) <= 0
      else if (operator === '<') ok = compareVersion(parsed, raw) < 0
      else ok = compareVersion(parsed, raw) === 0
      if (!ok) break
    }
    if (ok) return true
  }
  return false
}

function requirementOf(manifest) {
  if (!manifest || typeof manifest !== 'object') return null
  const engines = manifest.engines && typeof manifest.engines === 'object' ? manifest.engines.dsh : null
  if (typeof engines === 'string' && engines.trim()) return engines.trim()
  const peers = manifest.peerDependencies && typeof manifest.peerDependencies === 'object' ? manifest.peerDependencies : null
  if (!peers) return null
  const direct = peers['@deepseek-ai/dsh']
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  // DSH core packages share the runtime version line, so a peer range on any of
  // them is a reliable stand-in when a plugin declares no engines.dsh.
  for (const [name, range] of Object.entries(peers)) {
    if (typeof range !== 'string' || !range.trim() || range.trim() === '*') continue
    if (!/^@deepseek-ai\/dsh(?:-|$)/.test(name)) continue
    return range.trim()
  }
  return null
}

function localize(value, lang = 'zh') {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    if (typeof value.zh === 'string' && (lang === 'zh' || !value.en)) return value.zh
    if (typeof value['zh-CN'] === 'string' && lang === 'zh') return value['zh-CN']
    if (typeof value.en === 'string') return value.en
    for (const key of Object.keys(value)) if (typeof value[key] === 'string') return value[key]
  }
  return ''
}

function packageRootName(moduleName) {
  if (!moduleName || typeof moduleName !== 'string') return null
  const parts = moduleName.split('/')
  if (moduleName.startsWith('@')) return parts.slice(0, 2).join('/')
  return parts[0]
}

function packageDirOf(moduleName) {
  if (!PROFILE_DIR || !moduleName) return null
  if (moduleName.startsWith('@deepseek-ai/')) return null
  if (moduleName.startsWith('file:') || moduleName.startsWith('link:')) return null
  const root = packageRootName(moduleName)
  if (!root) return null
  const dir = path.join(PROFILE_DIR, 'node_modules', root)
  try {
    if (!fs.existsSync(dir)) return null
    return fs.realpathSync(dir)
  } catch {
    return null
  }
}

function readManifest(dir) {
  if (!dir) return {}
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return {}
  }
}

function readJsonSync(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJson(file, value) {
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    await fsp.writeFile(temp, JSON.stringify(value), 'utf8')
    await fsp.rename(temp, file)
  } catch {
    // Cache writes are best effort; a read-only home must not break the page.
  }
}

function isoDay(time) {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function estimateCharsTokens(text) {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

function safeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function errorMessage(error) {
  if (!error) return '未知错误'
  if (typeof error === 'string') return error
  if (typeof error.message === 'string') return error.message
  try { return JSON.stringify(error) } catch { return String(error) }
}

class Supervisor {
  constructor(ctx) {
    this.ctx = ctx
    this.root = path.join(DSH_HOME, 'plugin-supervisor')
    this.cacheDir = path.join(this.root, 'cache')
    this.changedAt = Date.now()
    this.inventory = { at: 0, data: null, promise: null }
    this.npm = { at: 0, data: {}, promise: null }
    this.usage = {
      at: 0,
      promise: null,
      progress: { done: 0, total: 0, status: 'idle' },
      files: new Map(),
      aggregate: null,
      error: null,
    }
    this.market = { at: 0, data: null, promise: null, error: null }
    this.owners = { key: '', data: null, promise: null }
    this.snapshotCache = { at: 0, data: null, promise: null }
    this.jobs = new Map()
    this.mutationQueue = Promise.resolve()
    this.settings = readJsonSync(path.join(this.root, 'settings.json'), { inputPerM: 0, outputPerM: 0 })
    if (!this.settings || typeof this.settings !== 'object') this.settings = { inputPerM: 0, outputPerM: 0 }
    this.history = readJsonSync(path.join(this.root, 'history.json'), { baseline: null, firstSeen: {}, reports: [] })
    if (!this.history || typeof this.history !== 'object') this.history = { baseline: null, firstSeen: {}, reports: [] }
    this.marketBaseline = readJsonSync(path.join(this.root, 'market-baseline.json'), { at: 0, downloads: {} })
    if (!this.marketBaseline || typeof this.marketBaseline !== 'object') this.marketBaseline = { at: 0, downloads: {} }
    const cachedNpm = readJsonSync(path.join(this.cacheDir, 'npm.json'), null)
    if (cachedNpm && typeof cachedNpm === 'object' && Date.now() - safeNumber(cachedNpm.at) < 6 * 3600000) {
      this.npm = { at: safeNumber(cachedNpm.at), data: cachedNpm.data || {}, promise: null }
    }
    const cachedMarket = readJsonSync(path.join(this.cacheDir, 'market.json'), null)
    if (cachedMarket && typeof cachedMarket === 'object' && Date.now() - safeNumber(cachedMarket.at) < 6 * 3600000) {
      this.market = { at: safeNumber(cachedMarket.at), data: cachedMarket.data || null, promise: null, error: null }
    }
  }

  origin() {
    try {
      const webServer = this.ctx.get('webServer')
      return webServer ? webServer.getOrigin() : ''
    } catch {
      return ''
    }
  }

  invalidate() {
    this.changedAt = Date.now()
    this.inventory.at = 0
    this.inventory.data = null
    this.snapshotCache.at = 0
    this.snapshotCache.data = null
    this.owners.key = ''
    this.owners.data = null
  }

  async getInventory(force = false) {
    if (!force && this.inventory.data && Date.now() - this.inventory.at < 15000) return this.inventory.data
    if (this.inventory.promise) return this.inventory.promise
    this.inventory.promise = (async () => {
      try {
        const data = await this.buildInventory()
        this.inventory = { at: Date.now(), data, promise: null }
        return data
      } finally {
        this.inventory.promise = null
      }
    })()
    return this.inventory.promise
  }

  async buildInventory() {
    const pm = this.ctx.get('pluginManager')
    if (!pm) throw new Error('pluginManager 服务不可用')
    const [bundles, entries, registries] = await Promise.all([
      pm.listBundles(),
      pm.listPlugins(),
      pm.registries().catch(() => null),
    ])
    let dshVersion = '0.0.0'
    try {
      const modules = this.ctx.get('clientModules')
      const graph = modules && modules.graph ? modules.graph() : null
      if (graph && graph.release && graph.release.version) dshVersion = graph.release.version
    } catch { /* fall through */ }
    if (dshVersion === '0.0.0' && process.env.DSH_VERSION) dshVersion = process.env.DSH_VERSION

    const entryById = new Map()
    for (const entry of entries) entryById.set(String(entry.entryId), entry)
    const coveredEntries = new Set()
    const coveredModules = new Set()
    const units = []

    for (const bundle of bundles) {
      if (bundle.name === '@deepseek-ai/dsh-base' || bundle.name === '@deepseek-ai/dsh-web-app') continue
      if (bundle.availability !== 'profile' && bundle.name !== SELF) continue
      const dir = packageDirOf(bundle.name) || sourceDirOf(bundle.source)
      const manifest = readManifest(dir)
      const rows = (bundle.rows || []).map((row) => {
        const entry = row.entryId ? entryById.get(String(row.entryId)) : null
        if (row.entryId) coveredEntries.add(String(row.entryId))
        if (row.moduleName) coveredModules.add(row.moduleName)
        return {
          rowId: row.rowId,
          moduleName: row.moduleName,
          entryId: row.entryId ? String(row.entryId) : null,
          title: localize(row.meta && row.meta.title) || row.rowId,
          enabled: entry ? entry.enabled !== false : false,
          fiberPhase: entry ? entry.fiberPhase : null,
        }
      })
      if (rows.length === 0 && bundle.enabled) coveredModules.add(bundle.name)
      const failed = rows.some((row) => row.fiberPhase === 'failed')
      const enabledRows = rows.filter((row) => row.enabled).length
      units.push({
        id: bundle.name,
        kind: 'bundle',
        name: bundle.name,
        version: bundle.version || manifest.version || '0.0.0',
        title: localize(bundle.meta && bundle.meta.title) || manifest.title || bundle.name,
        description: localize(bundle.meta && bundle.meta.description) || manifest.description || '',
        icon: bundle.meta && typeof bundle.meta.icon === 'string' ? bundle.meta.icon : null,
        author: typeof manifest.author === 'string' ? manifest.author : (manifest.author && manifest.author.name) || '',
        official: Boolean(bundle.official),
        enabled: bundle.enabled !== false,
        installed: Boolean(bundle.installed),
        removable: Boolean(bundle.removable),
        availability: bundle.availability,
        source: bundle.source || (bundle.installTarget && bundle.installTarget.spec) || null,
        installSpec: (bundle.installTarget && bundle.installTarget.spec) || null,
        dir,
        manifest,
        rows,
        failed,
        enabledRows,
        fiberPhase: failed ? 'failed' : (bundle.enabled ? (rows[0] && rows[0].fiberPhase) || 'active' : 'inactive'),
        error: bundle.error || null,
        readOnlyReason: bundle.readOnlyReason || null,
        requirement: requirementOf(manifest),
      })
    }

    let configuration = []
    try {
      const editor = this.ctx.get('configEditor')
      if (editor && editor.configuration) configuration = editor.configuration()
    } catch { configuration = [] }
    const configByEntry = new Map()
    for (const item of configuration) {
      if (!item || !item.entry) continue
      configByEntry.set(String(item.entry.id), {
        ...(item.inherited || {}),
        ...(item.override || {}),
      })
    }

    for (const entry of entries) {
      const entryId = String(entry.entryId)
      if (coveredEntries.has(entryId)) continue
      const moduleName = rootModule(entry.moduleName)
      if (moduleName !== '@deepseek-ai/dsh-mcp-client') continue
      const dir = packageDirOf(moduleName)
      const manifest = readManifest(dir)
      const config = configByEntry.get(entryId) || configByEntry.get(`include:${entryId}`) || {}
      const serverName = typeof config.serverName === 'string' && config.serverName ? config.serverName : entryId
      units.push({
        id: `entry:${entryId}`,
        kind: 'entry',
        name: moduleName,
        version: manifest.version || dshVersion || '0.0.0',
        title: `MCP · ${serverName}`,
        description: 'MCP 客户端连接（工具前缀 mcp__' + serverName + '__）',
        icon: null,
        author: '',
        official: Boolean(moduleName.startsWith('@deepseek-ai/')),
        enabled: entry.enabled !== false,
        installed: true,
        removable: false,
        availability: 'profile',
        source: entryId,
        installSpec: null,
        dir,
        manifest,
        rows: [{
          rowId: entryId,
          moduleName,
          entryId,
          title: serverName,
          enabled: entry.enabled !== false,
          fiberPhase: entry.fiberPhase,
        }],
        failed: entry.fiberPhase === 'failed',
        enabledRows: entry.enabled === false ? 0 : 1,
        fiberPhase: entry.fiberPhase || 'inactive',
        error: null,
        readOnlyReason: null,
        requirement: requirementOf(manifest),
        serverName,
      })
    }

    units.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    return {
      at: Date.now(),
      dshVersion,
      registries,
      units,
      counts: {
        units: units.length,
        enabled: units.filter((unit) => unit.enabled).length,
        failed: units.filter((unit) => unit.failed).length,
        removable: units.filter((unit) => unit.removable).length,
      },
    }
  }

  async getUsage(force = false) {
    if (!force && this.usage.aggregate && Date.now() - this.usage.at < 5 * MINUTE) return this.usage.aggregate
    if (this.usage.promise) {
      return this.usage.aggregate || { status: 'scanning', progress: this.usage.progress, windowDays: 30 }
    }
    if (this.usage.aggregate && !force) return this.usage.aggregate
    this.usage.promise = this.scanUsage()
      .then(() => {
        this.usage.aggregate = this.aggregateUsage(30)
        this.usage.at = Date.now()
        this.usage.progress = { ...this.usage.progress, status: 'ready' }
      })
      .catch((error) => {
        this.usage.error = errorMessage(error)
        this.usage.progress = { ...this.usage.progress, status: 'error' }
      })
      .finally(() => { this.usage.promise = null })
    return this.usage.aggregate || { status: 'scanning', progress: this.usage.progress, windowDays: 30 }
  }

  async scanUsage() {
    const query = this.ctx.get('sessionQuery')
    if (!query || !query.listSessions || !query.readSession) throw new Error('sessionQuery 服务不可用')
    const records = await query.listSessions()
    const cutoff = Date.now() - 95 * DAY
    const chosen = records
      .filter((record) => record && record.header && safeNumber(record.header.createdAt) >= cutoff)
      .sort((a, b) => safeNumber(b.header.createdAt) - safeNumber(a.header.createdAt))
      .slice(0, 80)
    this.usage.progress = { done: 0, total: chosen.length, status: 'scanning' }
    const next = new Map()
    let done = 0
    for (const record of chosen) {
      const id = String(record.header.id)
      try {
        const snapshot = await query.readSession(record.header.id)
        const summary = this.parseEvents(snapshot.events || [])
        summary.id = id
        summary.createdAt = safeNumber(record.header.createdAt)
        next.set(id, summary)
      } catch (error) {
        this.usage.parseError = errorMessage(error)
        next.set(id, { id, createdAt: safeNumber(record.header.createdAt), days: {}, lastAt: 0, error: errorMessage(error) })
      }
      done += 1
      this.usage.progress = { done, total: chosen.length, status: 'scanning' }
      await new Promise((resolve) => setImmediate(resolve))
    }
    this.usage.files = next
    this.usage.error = null
    this.usage.at = Date.now()
  }

  parseEvents(events) {
    const days = {}
    let lastAt = 0
    const calls = new Map()
    for (const event of events) {
      if (!event || event.type === 'session' || typeof event.seq !== 'number') continue
      const time = safeNumber(event.time)
      if (!time) continue
      const day = isoDay(time)
      if (!days[day]) days[day] = { input: 0, output: 0, steps: 0, calls: 0, resultTokens: 0, tools: {} }
      const bucket = days[day]
      if (time > lastAt) lastAt = time
      if (event.type === 'assistant/message') {
        const usage = event.data && event.data.usage
        if (usage) {
          bucket.input += safeNumber(usage.inputTokens)
          bucket.output += safeNumber(usage.outputTokens)
        }
        bucket.steps += 1
      } else if (event.type === 'tool/call') {
        const name = event.data && typeof event.data.name === 'string' ? event.data.name : ''
        if (name) {
          if (!bucket.tools[name]) bucket.tools[name] = { calls: 0, errors: 0, resultTokens: 0, chars: 0, lastAt: 0 }
          bucket.tools[name].calls += 1
          bucket.tools[name].lastAt = Math.max(bucket.tools[name].lastAt, time)
          calls.set(String(event.data.callId), name)
          bucket.calls += 1
        }
      } else if (event.type === 'tool/result') {
        const message = event.data && event.data.message
        const callId = message && message.toolCallId ? String(message.toolCallId) : ''
        const name = calls.get(callId) || ''
        if (!name) continue
        if (!bucket.tools[name]) bucket.tools[name] = { calls: 0, errors: 0, resultTokens: 0, chars: 0, lastAt: 0 }
        const target = bucket.tools[name]
        let tokens = 0
        let chars = 0
        if (message && Array.isArray(message.content)) {
          for (const block of message.content) {
            if (!block || typeof block !== 'object') continue
            if (block.type === 'text' && typeof block.text === 'string') {
              chars += block.text.length
              tokens += estimateCharsTokens(block.text)
            } else if (block.type === 'image') {
              tokens += 1200
              chars += 256
            } else {
              const serialized = JSON.stringify(block)
              chars += serialized.length
              tokens += estimateCharsTokens(serialized)
            }
          }
        }
        target.resultTokens += tokens
        target.chars += chars
        target.lastAt = Math.max(target.lastAt, time)
        if (event.data && event.data.error) target.errors += 1
        bucket.resultTokens += tokens
      }
    }
    return { days, lastAt }
  }

  async listSessionFiles(root) {
    const found = []
    const walk = async (dir, depth) => {
      if (depth > 3) return
      let items = []
      try { items = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const item of items) {
        const full = path.join(dir, item.name)
        if (item.isDirectory()) await walk(full, depth + 1)
        else if (/^session.*\.jsonl(\.zstd)?$/.test(item.name)) {
          try {
            const stat = await fsp.stat(full)
            found.push({ path: full, mtimeMs: stat.mtimeMs, size: stat.size })
          } catch { /* skip */ }
        }
      }
    }
    await walk(root, 0)
    found.sort((a, b) => b.mtimeMs - a.mtimeMs)
    const cutoff = Date.now() - 95 * DAY
    return found.filter((file) => file.mtimeMs >= cutoff).slice(0, 80)
  }

  async parseSessionFile(file) {
    const buffer = await fsp.readFile(file.path)
    let text
    if (file.path.endsWith('.zstd')) text = (await zstdDecompress(buffer)).toString('utf8')
    else text = buffer.toString('utf8')
    const days = {}
    let lastAt = 0
    let sessionTokens = { input: 0, output: 0 }
    const calls = new Map()
    const lines = text.split(/\r?\n/)
    for (const line of lines) {
      if (!line || line[0] !== '{') continue
      let event
      try { event = JSON.parse(line) } catch { continue }
      if (!event || event.type === 'session' || typeof event.seq !== 'number') continue
      const time = safeNumber(event.time)
      if (!time) continue
      const day = isoDay(time)
      if (!days[day]) days[day] = { input: 0, output: 0, steps: 0, calls: 0, resultTokens: 0, tools: {} }
      const bucket = days[day]
      if (time > lastAt) lastAt = time
      if (event.type === 'assistant/message') {
        const usage = event.data && event.data.usage
        if (usage) {
          const input = safeNumber(usage.inputTokens)
          const output = safeNumber(usage.outputTokens)
          bucket.input += input
          bucket.output += output
          sessionTokens.input += input
          sessionTokens.output += output
        }
        bucket.steps += 1
      } else if (event.type === 'tool/call') {
        const name = event.data && typeof event.data.name === 'string' ? event.data.name : ''
        if (name) {
          if (!bucket.tools[name]) bucket.tools[name] = { calls: 0, errors: 0, resultTokens: 0, chars: 0, lastAt: 0 }
          bucket.tools[name].calls += 1
          bucket.tools[name].lastAt = Math.max(bucket.tools[name].lastAt, time)
          calls.set(String(event.data.callId), name)
          bucket.calls += 1
        }
      } else if (event.type === 'tool/result') {
        const message = event.data && event.data.message
        const callId = message && message.toolCallId ? String(message.toolCallId) : ''
        const name = calls.get(callId) || ''
        if (!name) continue
        if (!bucket.tools[name]) bucket.tools[name] = { calls: 0, errors: 0, resultTokens: 0, chars: 0, lastAt: 0 }
        const target = bucket.tools[name]
        let tokens = 0
        let chars = 0
        if (message && Array.isArray(message.content)) {
          for (const block of message.content) {
            if (!block || typeof block !== 'object') continue
            if (block.type === 'text' && typeof block.text === 'string') {
              chars += block.text.length
              tokens += estimateCharsTokens(block.text)
            } else if (block.type === 'image') {
              tokens += 1200
              chars += 256
            } else {
              const serialized = JSON.stringify(block)
              chars += serialized.length
              tokens += estimateCharsTokens(serialized)
            }
          }
        }
        target.resultTokens += tokens
        target.chars += chars
        target.lastAt = Math.max(target.lastAt, time)
        if (event.data && event.data.error) target.errors += 1
        bucket.resultTokens += tokens
      }
    }
    return { path: file.path, mtimeMs: file.mtimeMs, size: file.size, days, lastAt, sessionTokens }
  }

  aggregateUsage(windowDays) {
    const cutoff = Date.now() - windowDays * DAY
    const tools = {}
    let input = 0
    let output = 0
    let steps = 0
    let sessions = 0
    let lastAt = 0
    const daily = {}
    for (const summary of this.usage.files.values()) {
      let touched = false
      for (const [day, bucket] of Object.entries(summary.days || {})) {
        const dayStart = new Date(`${day}T00:00:00`).getTime()
        if (!Number.isFinite(dayStart) || dayStart < cutoff) continue
        touched = true
        input += bucket.input
        output += bucket.output
        steps += bucket.steps
        if (!daily[day]) daily[day] = { calls: 0, resultTokens: 0, steps: 0 }
        daily[day].steps += bucket.steps
        daily[day].resultTokens += bucket.resultTokens
        for (const [name, item] of Object.entries(bucket.tools || {})) {
          if (!tools[name]) tools[name] = { name, calls: 0, errors: 0, resultTokens: 0, chars: 0, sessions: 0, lastAt: 0, daily: {} }
          const target = tools[name]
          target.calls += item.calls
          target.errors += item.errors
          target.resultTokens += item.resultTokens
          target.chars += item.chars
          target.lastAt = Math.max(target.lastAt, item.lastAt)
          if (!target.daily[day]) target.daily[day] = 0
          target.daily[day] += item.calls
          daily[day].calls += item.calls
        }
      }
      if (touched) {
        sessions += 1
        if (summary.lastAt > lastAt) lastAt = summary.lastAt
      }
    }
    for (const [name, item] of Object.entries(tools)) {
      item.avgTokens = item.calls > 0 ? Math.round(item.resultTokens / item.calls) : 0
      item.sessions = 0
      for (const summary of this.usage.files.values()) {
        let used = false
        for (const [day, bucket] of Object.entries(summary.days || {})) {
          const dayStart = new Date(`${day}T00:00:00`).getTime()
          if (dayStart < cutoff) continue
          if (bucket.tools && bucket.tools[name] && bucket.tools[name].calls > 0) { used = true; break }
        }
        if (used) item.sessions += 1
      }
    }
    const range = []
    for (let i = windowDays - 1; i >= 0; i -= 1) {
      const day = isoDay(Date.now() - i * DAY)
      range.push({ day, ...(daily[day] || { calls: 0, resultTokens: 0, steps: 0 }) })
    }
    return {
      status: 'ready',
      windowDays,
      scannedAt: this.usage.at || Date.now(),
      sessions,
      files: this.usage.files.size,
      steps,
      totals: { input, output, total: input + output },
      tools: Object.values(tools).sort((a, b) => b.calls - a.calls),
      daily: range,
      error: this.usage.error,
    }
  }

  async getMarket(force = false) {
    if (!force && this.market.data && Date.now() - this.market.at < 6 * 3600000) return this.market.data
    if (this.market.promise) return this.market.data || { status: 'loading' }
    this.market.promise = (async () => {
      try {
        const response = await fetch(MARKET_URL, {
          headers: { accept: 'application/json', 'user-agent': 'dsh-plugin-supervisor/0.1' },
          signal: AbortSignal.timeout(30000),
        })
        if (!response.ok) throw new Error(`市场索引 HTTP ${response.status}`)
        const document = await response.json()
        const data = await this.buildMarket(document)
        this.market = { at: Date.now(), data, promise: null, error: null }
        await writeJson(path.join(this.cacheDir, 'market.json'), { at: this.market.at, data })
      } catch (error) {
        this.market = { at: 0, data: this.market.data, promise: null, error: errorMessage(error) }
      }
    })()
    this.market.promise.finally(() => { this.market.promise = null })
    return this.market.data || { status: this.market.error ? 'error' : 'loading', error: this.market.error || null }
  }

  async buildMarket(document) {
    const categories = (document && document.categories) || {}
    const source = Array.isArray(document && document.plugins) ? document.plugins : []
    const baseline = this.marketBaseline && this.marketBaseline.downloads ? this.marketBaseline : null
    const baselineAge = baseline ? Date.now() - safeNumber(baseline.at) : 0
    const withDelta = baseline && baselineAge >= 5 * DAY && baselineAge <= 21 * DAY
    const items = []
    for (const plugin of source) {
      if (!plugin || typeof plugin !== 'object' || !plugin.name) continue
      const npm = typeof plugin.npm === 'string' ? plugin.npm : null
      const addedAt = plugin.added ? Date.parse(plugin.added) : 0
      const downloads = safeNumber(plugin.downloads)
      const stars = safeNumber(plugin.stars)
      const ageDays = addedAt ? Math.max(0.5, (Date.now() - addedAt) / DAY) : 9999
      const delta = withDelta && npm && baseline.downloads[npm] !== undefined ? downloads - safeNumber(baseline.downloads[npm]) : null
      const spec = this.installSpecOf(plugin)
      if (!spec) continue
      const category = typeof plugin.category === 'string' ? plugin.category : ''
      const categoryInfo = categories[category]
      items.push({
        name: plugin.name,
        npm,
        spec,
        title: plugin.name,
        owner: typeof plugin.owner === 'string' ? plugin.owner : '',
        description: localize(plugin.description),
        category,
        categoryLabel: localize(categoryInfo && categoryInfo.zh) || localize(categoryInfo && categoryInfo.en) || category,
        downloads,
        stars,
        added: plugin.added || null,
        addedAt,
        ageDays: Math.round(ageDays * 10) / 10,
        delta,
        version: plugin.version || null,
        repo: plugin.url || null,
        page: plugin.page || null,
        icon: plugin.icon || null,
        capabilities: Array.isArray(plugin.capabilities) ? plugin.capabilities : [],
      })
    }
    const installedNames = new Set()
    try {
      const inventory = this.inventory.data
      if (inventory) for (const unit of inventory.units) {
        installedNames.add(unit.name)
        if (unit.manifest && unit.manifest.name) installedNames.add(unit.manifest.name)
      }
    } catch { /* ignore */ }
    for (const item of items) item.installed = Boolean(item.npm && installedNames.has(item.npm))
    const weeklyCount = await this.enrichWeekly(items)
    const hot = items.filter((item) => item.npm && item.downloads > 0)
      .sort((a, b) => ((b.weeklyDownloads ?? b.downloads) - (a.weeklyDownloads ?? a.downloads)))
      .slice(0, 24)
    const hotNames = new Set(hot.map((item) => item.npm || item.name))
    const dark = items.filter((item) => item.npm && item.downloads >= 150 && item.ageDays <= 75 && !hotNames.has(item.npm))
      .sort((a, b) => ((b.weeklyDownloads ?? b.downloads) / b.ageDays) - ((a.weeklyDownloads ?? a.downloads) / a.ageDays))
      .slice(0, 18)
    const fresh = items.filter((item) => item.addedAt && Date.now() - item.addedAt <= 21 * DAY)
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, 18)
    const byName = {}
    for (const item of items) byName[item.npm || item.name] = item.category
    const data = {
      status: 'ready',
      at: Date.now(),
      source: MARKET_URL,
      total: items.length,
      categories,
      hot,
      dark,
      fresh,
      byName,
      weekly: { enriched: weeklyCount, at: Date.now() },
      delta: { available: Boolean(withDelta), baselineAt: baseline ? baseline.at : 0 },
      note: weeklyCount > 0
        ? `榜单按 npm 上周下载量排序（已获取 ${weeklyCount} 个包）；新锐插件按下载量与上线天数的比值排序（优先采用周下载）。`
        : (withDelta
          ? '榜单按本周下载增量排序；暂无增量时按近 30 天下载排序。'
          : '榜单按近 30 天下载排序（npm 周下载暂不可用，已记录本次基线）。'),
    }
    if (!baseline || baselineAge > 6 * DAY) {
      const downloads = {}
      for (const item of items) if (item.npm) downloads[item.npm] = item.downloads
      this.marketBaseline = { at: Date.now(), downloads }
      writeJson(path.join(this.root, 'market-baseline.json'), this.marketBaseline)
    }
    return data
  }

  async enrichWeekly(items) {
    const targets = [...items]
      .filter((item) => item.npm && item.downloads > 0)
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, 40)
    if (!targets.length) return 0
    let cursor = 0
    let enriched = 0
    const worker = async () => {
      while (cursor < targets.length) {
        const item = targets[cursor]
        cursor += 1
        try {
          const name = item.npm.startsWith('@')
            ? `@${item.npm.slice(1).replace('/', '%2f')}`
            : encodeURIComponent(item.npm)
          const response = await fetch(`https://api.npmjs.org/downloads/point/last-week/${name}`, {
            headers: { accept: 'application/json', 'user-agent': 'dsh-plugin-supervisor/0.1' },
            signal: AbortSignal.timeout(6000),
          })
          if (!response.ok) continue
          const payload = await response.json()
          const downloads = Number(payload && payload.downloads)
          if (Number.isFinite(downloads)) {
            item.weeklyDownloads = downloads
            enriched += 1
          }
        } catch { /* keep the 30-day fallback */ }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()])
    return enriched
  }

  installSpecOf(plugin) {
    if (typeof plugin.install === 'string') {
      const match = /(?:^|\s)add\s+(.+)$/.exec(plugin.install)
      if (match) {
        let spec = match[1].trim()
        if ((spec.startsWith('"') && spec.endsWith('"')) || (spec.startsWith("'") && spec.endsWith("'"))) spec = spec.slice(1, -1)
        if (spec && !/\s/.test(spec)) return spec
      }
    }
    if (plugin.npm) return plugin.version ? `${plugin.npm}@${plugin.version}` : plugin.npm
    if (plugin.tarball) return plugin.tarball
    if (typeof plugin.url === 'string') {
      const match = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)/.exec(plugin.url)
      if (match) return `github:${match[1]}/${match[2]}`
    }
    return null
  }

  async getOwners(toolNames) {
    const names = [...new Set(toolNames)].filter((name) => name && !CORE_TOOLS.has(name)).sort()
    const key = crypto.createHash('sha1').update(names.join('\n')).digest('hex')
    const versions = (this.inventory.data ? this.inventory.data.units : []).map((unit) => `${unit.name}@${unit.version}`).join(',')
    const fullKey = `${key}:${versions}`
    if (this.owners.data && this.owners.key === fullKey) return this.owners.data
    if (this.owners.promise) return this.owners.promise
    const task = (async () => {
      const units = this.inventory.data ? this.inventory.data.units : []
      const result = { byTool: {}, shared: [] }
      for (const unit of units) {
        if (unit.kind === 'entry' && unit.serverName) {
          const prefix = `mcp__${unit.serverName}__`
          for (const name of names) {
            if (name.startsWith(prefix)) {
              result.byTool[name] = { unitId: unit.id, score: 100, method: 'mcp' }
            }
          }
        }
      }
      const pending = names.filter((name) => !result.byTool[name])
      for (const unit of units) {
        if (!unit.dir) continue
        const scores = await this.scanPackage(unit.dir, pending)
        for (const [name, score] of Object.entries(scores)) {
          if (score < 5) continue
          const current = result.byTool[name]
          if (!current || score > current.score) {
            if (current && current.score === score) {
              current.sharedWith = current.sharedWith || [current.unitId]
              current.sharedWith.push(unit.id)
              result.shared.push({ tool: name, units: current.sharedWith })
              continue
            }
            result.byTool[name] = { unitId: unit.id, score, method: 'source' }
          } else if (current && current.score === score && current.unitId !== unit.id) {
            current.sharedWith = current.sharedWith || [current.unitId]
            current.sharedWith.push(unit.id)
          }
        }
      }
      this.owners.key = fullKey
      this.owners.data = result
      return result
    })()
    this.owners.promise = task
    try {
      return await task
    } finally {
      if (this.owners.promise === task) this.owners.promise = null
    }
  }

  async scanPackage(dir, toolNames) {
    if (!toolNames.length) return {}
    const roots = new Set()
    try {
      const manifest = readManifest(dir)
      if (typeof manifest.main === 'string') roots.add(path.dirname(path.join(dir, manifest.main)))
      if (manifest.exports && typeof manifest.exports === 'object') {
        const mainExport = manifest.exports['.']
        if (typeof mainExport === 'string') roots.add(path.dirname(path.join(dir, mainExport)))
        else if (mainExport && typeof mainExport.default === 'string') roots.add(path.dirname(path.join(dir, mainExport.default)))
      }
      for (const folder of ['src', 'lib', 'dist', 'build']) {
        const candidate = path.join(dir, folder)
        if (fs.existsSync(candidate)) roots.add(candidate)
      }
    } catch { /* fall back to the package root */ }
    if (roots.size === 0) roots.add(dir)
    const files = []
    const seen = new Set()
    for (const root of roots) {
      if (files.length >= 90) break
      let found = []
      try { found = await collectJs(root, 90) } catch { found = [] }
      for (const file of found) {
        if (files.length >= 90) break
        if (!seen.has(file)) { seen.add(file); files.push(file) }
      }
    }
    const scores = {}
    for (const name of toolNames) scores[name] = 0
    const quoted = new Map()
    const registration = new Map()
    const declaration = new Map()
    const constant = new Map()
    const named = new Map()
    for (const name of toolNames) {
      const escaped = escapeRegExp(name)
      quoted.set(name, new RegExp(`['"\`]${escaped}['"\`]`, 'g'))
      registration.set(name, new RegExp(`(?:tools?\\.register|registerTool|defineTool|addTool)\\s*\\([\\s\\S]{0,800}?['"\`]${escaped}['"\`]`))
      declaration.set(name, new RegExp(`name\\s*:\\s*['"\`]${escaped}['"\`][\\s\\S]{0,260}?(?:execute|run|handler|parameters|inputSchema)`))
      constant.set(name, new RegExp(`(?:const|let|var)\\s+[A-Za-z0-9_$]*\\s*=\\s*['"\`]${escaped}['"\`]`))
      named.set(name, new RegExp(`name\\s*:\\s*['"\`]${escaped}['"\`]`))
    }
    for (const file of files) {
      let text
      try {
        const stat = await fsp.stat(file)
        if (stat.size > 3 * 1024 * 1024) continue
        text = await fsp.readFile(file, 'utf8')
      } catch { continue }
      const hasToolApi = /defineTool\s*\(|tools?\.register\s*\(|registerTool\s*\(|addTool\s*\(/.test(text)
      for (const name of toolNames) {
        let score = 0
        if (registration.get(name).test(text)) score += 10
        if (declaration.get(name).test(text)) score += 8
        if (constant.get(name).test(text)) score += 12
        if (named.get(name).test(text)) score += 6
        if (hasToolApi) {
          const matches = text.match(quoted.get(name))
          if (matches) score += Math.min(6, matches.length)
        }
        if (score === 0) continue
        scores[name] += score
      }
    }
    return scores
  }

  async getNpmMap(force = false) {
    if (!force && Date.now() - this.npm.at < 6 * 3600000) return this.npm.data
    if (this.npm.promise) return this.npm.data
    const inventory = this.inventory.data
    if (!inventory) return this.npm.data
    this.npm.promise = (async () => {
      const targets = []
      for (const unit of inventory.units) {
        if (unit.kind !== 'bundle') continue
        if (unit.official) continue
        const spec = unit.installSpec || ''
        if (/^(link:|file:|git\+|github:|https?:)/i.test(spec)) continue
        if (unit.source && /^(link:|file:)/i.test(unit.source)) continue
        if (unit.name.startsWith('@deepseek-ai/')) continue
        targets.push(unit.name)
      }
      const data = { ...this.npm.data }
      const queue = [...new Set(targets)]
      let cursor = 0
      const worker = async () => {
        while (cursor < queue.length) {
          const name = queue[cursor]
          cursor += 1
          try {
            const result = await this.fetchNpm(name, inventory)
            if (result) data[name] = result
          } catch (error) {
            data[name] = { status: 'error', error: errorMessage(error), at: Date.now() }
          }
        }
      }
      await Promise.all([worker(), worker(), worker()])
      this.npm = { at: Date.now(), data, promise: null }
      await writeJson(path.join(this.cacheDir, 'npm.json'), { at: this.npm.at, data })
    })()
    try {
      await this.npm.promise
    } finally {
      this.npm.promise = null
    }
    return this.npm.data
  }

  async fetchNpm(name, inventory) {
    const registries = []
    if (inventory.registries && inventory.registries.registry) registries.push(inventory.registries.registry)
    if (inventory.registries && inventory.registries.resolved) registries.push(inventory.registries.resolved)
    registries.push('https://registry.npmjs.org', 'https://registry.npmmirror.com')
    const seen = new Set()
    const encoded = name.startsWith('@')
      ? `@${name.slice(1).replace('/', '%2f')}`
      : encodeURIComponent(name)
    for (const registry of registries) {
      const base = String(registry || '').replace(/\/$/, '')
      if (!base || seen.has(base)) continue
      seen.add(base)
      try {
        const response = await fetch(`${base}/${encoded}`, {
          headers: { accept: 'application/vnd.npm.install-v1+json' },
          signal: AbortSignal.timeout(8000),
        })
        if (!response.ok) continue
        const document = await response.json()
        if (!document || !document.versions) continue
        const versions = Object.keys(document.versions)
          .map((value) => parseVersion(value))
          .filter(Boolean)
          .sort((a, b) => compareVersion(b, a))
        const latest = (document['dist-tags'] && document['dist-tags'].latest) || (versions[0] && versions[0].raw) || null
        const compatible = []
        for (const version of versions) {
          const manifest = document.versions[version.raw]
          const requirement = requirementOf(manifest)
          const ok = requirement ? satisfies(inventory.dshVersion, requirement) : true
          if (ok) compatible.push({ version: version.raw, requirement })
        }
        const stable = compatible.find((item) => parseVersion(item.version).pre.length === 0)
        const recommended = stable || compatible[0] || null
        const latestManifest = latest ? document.versions[latest] : null
        return {
          status: 'ok',
          registry: base,
          at: Date.now(),
          latest,
          recommended: recommended ? recommended.version : null,
          recommendedRequirement: recommended ? recommended.requirement : null,
          latestRequirement: latestManifest ? requirementOf(latestManifest) : null,
          compatibleCount: compatible.length,
          versionCount: versions.length,
          latestCompatible: recommended ? recommended.version === latest : false,
        }
      } catch { /* next registry */ }
    }
    return { status: 'error', error: '所有 npm 源均不可达', at: Date.now() }
  }

  async snapshot(force = false) {
    if (!force && this.snapshotCache.data && Date.now() - this.snapshotCache.at < 12000) return this.snapshotCache.data
    if (this.snapshotCache.promise) return this.snapshotCache.promise
    this.snapshotCache.promise = (async () => {
      const inventory = await this.getInventory(force)
      if (!this.npm.data || Object.keys(this.npm.data).length === 0) {
        this.getNpmMap(force).catch(() => {})
      }
      const usage = await this.getUsage(force)
      const units = inventory.units
      const toolNames = usage && usage.tools ? usage.tools.map((tool) => tool.name) : []
      const visible = []
      try {
        const tools = this.ctx.get('tools')
        if (tools && tools.schemas) {
          const seen = new Set()
          for (const schema of tools.schemas()) {
            if (!seen.has(schema.name)) { seen.add(schema.name); visible.push(schema) }
          }
          const agentsService = this.ctx.get('agents')
          const agents = agentsService && agentsService.list ? agentsService.list() : []
          for (const agent of agents.slice(0, 12)) {
            try {
              for (const schema of tools.schemas(agent)) {
                if (!seen.has(schema.name)) { seen.add(schema.name); visible.push(schema) }
              }
            } catch { /* one agent's scope may be unavailable */ }
          }
        }
      } catch { /* ignore */ }
      const allToolNames = [...new Set([...toolNames, ...visible.map((schema) => schema.name)])]
      const owners = await this.getOwners(allToolNames)
      const schemaByName = new Map()
      for (const schema of visible) {
        const size = JSON.stringify({ name: schema.name, description: schema.description || '', parameters: schema.parameters || {} }).length
        schemaByName.set(schema.name, { name: schema.name, tokens: Math.max(1, Math.ceil(size / 4)), schema })
      }
      const usageByTool = new Map()
      if (usage && usage.tools) for (const tool of usage.tools) usageByTool.set(tool.name, tool)
      const perUnit = new Map()
      for (const unit of units) {
        perUnit.set(unit.id, {
          calls: 0, errors: 0, resultTokens: 0, sessions: 0, lastAt: 0, tools: [], schemaTokens: 0, daily: {},
        })
      }
      const builtin = { calls: 0, errors: 0, resultTokens: 0, tools: [] }
      for (const toolName of allToolNames) {
        const owner = owners.byTool[toolName]
        const usageItem = usageByTool.get(toolName)
        const schemaItem = schemaByName.get(toolName)
        const targetId = owner ? owner.unitId : null
        if (!targetId) {
          if (usageItem) {
            builtin.calls += usageItem.calls
            builtin.errors += usageItem.errors
            builtin.resultTokens += usageItem.resultTokens
            builtin.tools.push({ name: toolName, calls: usageItem.calls, resultTokens: usageItem.resultTokens })
          }
          continue
        }
        const target = perUnit.get(targetId)
        if (!target) continue
        const schemaTokens = schemaItem ? schemaItem.tokens : 0
        target.schemaTokens += schemaTokens
        const detail = {
          name: toolName,
          schemaTokens,
          calls: usageItem ? usageItem.calls : 0,
          errors: usageItem ? usageItem.errors : 0,
          resultTokens: usageItem ? usageItem.resultTokens : 0,
          sessions: usageItem ? usageItem.sessions : 0,
          lastAt: usageItem ? usageItem.lastAt : 0,
          shared: Boolean(owner.sharedWith),
        }
        target.tools.push(detail)
        if (usageItem) {
          target.calls += usageItem.calls
          target.errors += usageItem.errors
          target.resultTokens += usageItem.resultTokens
          target.lastAt = Math.max(target.lastAt, usageItem.lastAt)
          target.sessions = Math.max(target.sessions, usageItem.sessions)
          for (const [day, count] of Object.entries(usageItem.daily || {})) {
            target.daily[day] = (target.daily[day] || 0) + count
          }
        }
      }
      const steps = usage && usage.steps ? usage.steps : 0
      const npmMap = this.npm.data || {}
      const settingsInput = safeNumber(this.settings.inputPerM)
      const settingsOutput = safeNumber(this.settings.outputPerM)
      const plugins = units.map((unit) => {
        const usageUnit = perUnit.get(unit.id) || { calls: 0, errors: 0, resultTokens: 0, sessions: 0, lastAt: 0, tools: [], schemaTokens: 0, daily: {} }
        const npm = npmMap[unit.name] || null
        const requirement = unit.requirement || (npm && npm.recommendedRequirement) || null
        const compatibility = !requirement
          ? { status: 'unknown', requirement: null, detail: '未声明 DSH 版本要求' }
          : (satisfies(inventory.dshVersion, requirement)
            ? { status: 'ok', requirement, detail: `要求 ${requirement}` }
            : { status: 'bad', requirement, detail: `要求 ${requirement}，当前 ${inventory.dshVersion}` })
        let update = null
        let blockedLatest = null
        if (npm && npm.status === 'ok' && npm.recommended) {
          const recommendedNewer = compareVersion(npm.recommended, unit.version) > 0
          const latestNewer = npm.latest && compareVersion(npm.latest, npm.recommended) > 0
          if (recommendedNewer) {
            update = {
              recommended: npm.recommended,
              latest: npm.latest,
              latestBlocked: Boolean(latestNewer),
              requirement: npm.recommendedRequirement || null,
              latestRequirement: npm.latestRequirement || null,
              note: latestNewer ? '最新版要求更高的 DSH，已保留兼容版本' : null,
            }
          } else if (latestNewer) {
            blockedLatest = { latest: npm.latest, requirement: npm.latestRequirement || null }
          }
        }
        const issues = []
        if (unit.failed) issues.push({ level: 'error', code: 'activation', text: '存在激活失败的插件行' })
        if (compatibility.status === 'bad') issues.push({ level: 'error', code: 'compatibility', text: compatibility.detail })
        if (update) issues.push({ level: 'warn', code: 'update', text: `可更新到 ${update.recommended}` })
        if (blockedLatest) issues.push({ level: 'info', code: 'blocked-latest', text: `最新版 ${blockedLatest.latest} 要求 ${blockedLatest.requirement || '更高 DSH'}，当前已保持最佳兼容版本` })
        if (!unit.enabled) issues.push({ level: 'info', code: 'disabled', text: '已禁用' })
        if (unit.rows.length > 1) {
          const off = unit.rows.filter((row) => !row.enabled).length
          if (off > 0 && unit.enabled) issues.push({ level: 'warn', code: 'row-disabled', text: `${off}/${unit.rows.length} 个配置行未启用` })
        }
        let status = 'ok'
        if (unit.failed) status = 'failed'
        else if (compatibility.status === 'bad') status = 'incompatible'
        else if (update) status = 'update'
        else if (!unit.enabled) status = 'disabled'
        const schemaTotal = usageUnit.schemaTokens * Math.max(steps, 0)
        const attributable = schemaTotal + usageUnit.resultTokens
        const cost = (attributable / 1000000) * settingsInput
        const lastUsedAt = usageUnit.lastAt || null
        const daysSince = lastUsedAt ? Math.floor((Date.now() - lastUsedAt) / DAY) : null
        const observable = usageUnit.tools.length > 0
        let usageLabel = 'unknown'
        if (observable) {
          if (usageUnit.calls === 0) usageLabel = 'idle'
          else if (usageUnit.calls <= 2) usageLabel = 'rare'
          else usageLabel = 'active'
        }
        return {
          id: unit.id,
          kind: unit.kind,
          name: unit.name,
          title: unit.title,
          description: unit.description,
          version: unit.version,
          official: unit.official,
          enabled: unit.enabled,
          removable: unit.removable,
          installed: unit.installed,
          availability: unit.availability,
          source: unit.source,
          installSpec: unit.installSpec,
          fiberPhase: unit.fiberPhase,
          rows: unit.rows,
          enabledRows: unit.enabledRows,
          failed: unit.failed,
          error: unit.error ? { code: unit.error.code, diagnostic: unit.error.diagnostic } : null,
          readOnlyReason: unit.readOnlyReason || null,
          requirement,
          compatibility,
          update,
          blockedLatest,
          issues,
          status,
          tools: usageUnit.tools.sort((a, b) => b.resultTokens - a.resultTokens || b.calls - a.calls),
          usage: {
            observable,
            label: usageLabel,
            calls: usageUnit.calls,
            errors: usageUnit.errors,
            sessions: usageUnit.sessions,
            lastUsedAt,
            daysSince,
            resultTokens: usageUnit.resultTokens,
            daily: usageUnit.daily,
          },
          token: {
            schemaTokens: usageUnit.schemaTokens,
            schemaTotal,
            resultTokens: usageUnit.resultTokens,
            steps,
            attributable,
            cost,
            avgResultTokens: usageUnit.calls > 0 ? Math.round(usageUnit.resultTokens / usageUnit.calls) : 0,
            perKToken: attributable > 0 ? Math.round((usageUnit.calls / attributable) * 1000 * 100) / 100 : null,
          },
          npm: npm ? { status: npm.status, latest: npm.latest || null, recommended: npm.recommended || null, error: npm.error || null } : null,
        }
      })
      const conflicts = this.detectConflicts(plugins, owners, this.market.data)
      const counts = {
        total: plugins.length,
        ok: plugins.filter((plugin) => plugin.status === 'ok').length,
        update: plugins.filter((plugin) => plugin.status === 'update').length,
        incompatible: plugins.filter((plugin) => plugin.status === 'incompatible').length,
        failed: plugins.filter((plugin) => plugin.status === 'failed').length,
        disabled: plugins.filter((plugin) => plugin.status === 'disabled').length,
        observable: plugins.filter((plugin) => plugin.usage.observable).length,
        idle: plugins.filter((plugin) => plugin.usage.observable && plugin.usage.calls === 0).length,
        conflicts: conflicts.length,
      }
      const history = this.recordHistory(plugins)
      const suggestions = this.buildSuggestions(plugins, counts, this.market.data)
      const tokenTotal = plugins.reduce((sum, plugin) => sum + plugin.token.attributable, 0)
      const data = {
        generatedAt: Date.now(),
        changedAt: this.changedAt,
        profile: process.env.DSH_PROFILE || 'desktop',
        dshVersion: inventory.dshVersion,
        settings: this.settings,
        counts,
        usageStatus: usage ? usage.status || 'ready' : 'idle',
        usageError: usage ? usage.error || null : null,
        usageProgress: this.usage.progress,
        usage: usage && usage.status === 'ready' ? {
          windowDays: usage.windowDays,
          scannedAt: usage.scannedAt,
          sessions: usage.sessions,
          files: usage.files,
          steps: usage.steps,
          totals: usage.totals,
          daily: usage.daily,
          builtin,
        } : { windowDays: 30, sessions: 0, files: 0, steps: 0, totals: { input: 0, output: 0, total: 0 }, daily: [], builtin },
        tokenTotal,
        plugins,
        conflicts,
        suggestions,
        history,
        builtin,
        market: this.market.data ? {
          status: 'ready',
          at: this.market.data.at,
          hot: this.market.data.hot.slice(0, 3).map((item) => item.name),
          total: this.market.data.total,
        } : { status: this.market.error ? 'error' : 'idle', error: this.market.error || null },
        updateStatus: this.npm.promise ? 'loading' : (Object.keys(npmMap).length > 0 ? 'ready' : 'idle'),
      }
      this.snapshotCache = { at: Date.now(), data, promise: null }
      return data
    })()
    try {
      return await this.snapshotCache.promise
    } finally {
      this.snapshotCache.promise = null
    }
  }

  detectConflicts(plugins, owners, market) {
    const conflicts = []
    const enabled = plugins.filter((plugin) => plugin.enabled)
    for (const shared of owners.shared || []) {
      const units = [...new Set(shared.units)]
      if (units.length < 2) continue
      const names = units.map((id) => {
        const plugin = plugins.find((item) => item.id === id)
        return plugin ? plugin.title : id
      })
      conflicts.push({
        id: `tool:${shared.tool}`,
        level: 'warn',
        kind: 'duplicate-tool',
        title: `工具 ${shared.tool} 可能被多个插件注册`,
        detail: `来源无法唯一确定：${names.join(' / ')}。若同时启用，通常只有一个会生效。`,
        units,
      })
    }
    for (const plugin of enabled) {
      if (plugin.failed) {
        conflicts.push({
          id: `failed:${plugin.id}`,
          level: 'error',
          kind: 'activation',
          title: `${plugin.title} 激活失败`,
          detail: plugin.rows.filter((row) => row.fiberPhase === 'failed').map((row) => row.rowId).join(', ') || '插件行处于激活失败状态',
          units: [plugin.id],
        })
      }
    }
    if (market && market.byName) {
      const groups = new Map()
      for (const plugin of enabled) {
        const category = market.byName[plugin.name] || market.byName[plugin.installSpec]
        if (!category) continue
        if (!groups.has(category)) groups.set(category, [])
        groups.get(category).push(plugin)
      }
      const labels = market.categories || {}
      for (const [category, group] of groups) {
        if (group.length < 2) continue
        if (category === 'market') continue
        const label = localize(labels[category] && labels[category].zh) || category
        conflicts.push({
          id: `category:${category}`,
          level: 'info',
          kind: 'overlap',
          title: `同一分类下有 ${group.length} 个插件：${label}`,
          detail: `功能可能重叠：${group.map((item) => item.title).join(' / ')}。此为提示，不代表确定性冲突。`,
          units: group.map((item) => item.id),
        })
      }
    }
    const seen = new Set()
    return conflicts.filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
  }

  recordHistory(plugins) {
    const history = this.history
    const current = {}
    for (const plugin of plugins) {
      if (plugin.kind === 'entry') continue
      current[plugin.name] = plugin.version
    }
    const baseline = history.baseline
    const base = baseline && baseline.versions ? baseline.versions : {}
    const changes = { new: [], removed: [], updated: [] }
    for (const [name, version] of Object.entries(current)) {
      if (!base[name]) changes.new.push({ name, version, title: (plugins.find((item) => item.name === name) || {}).title || name })
      else if (base[name] !== version) changes.updated.push({ name, from: base[name], to: version, title: (plugins.find((item) => item.name === name) || {}).title || name })
    }
    for (const name of Object.keys(base)) {
      if (!current[name]) changes.removed.push({ name, version: base[name] })
    }
    const firstSeen = { ...(history.firstSeen || {}) }
    for (const name of Object.keys(current)) if (!firstSeen[name]) firstSeen[name] = new Date().toISOString()
    const shouldBaseline = !baseline || Date.now() - safeNumber(baseline.at) > 6 * 3600000
    if (shouldBaseline) {
      const reports = Array.isArray(history.reports) ? history.reports.slice(-11) : []
      reports.push({ at: Date.now(), changes })
      this.history = { baseline: { at: Date.now(), versions: current }, firstSeen, reports }
      writeJson(path.join(this.root, 'history.json'), this.history)
    } else if (JSON.stringify(firstSeen) !== JSON.stringify(history.firstSeen)) {
      this.history = { ...history, firstSeen }
      writeJson(path.join(this.root, 'history.json'), this.history)
    }
    return {
      since: baseline ? baseline.at : null,
      firstSeen,
      changes,
      reports: (this.history.reports || []).slice(-4).reverse(),
    }
  }

  buildSuggestions(plugins, counts, market) {
    const list = []
    const updates = plugins.filter((plugin) => plugin.status === 'update')
    if (updates.length) {
      list.push({
        id: 'updates',
        tone: 'brand',
        title: `${updates.length} 个插件可更新到兼容版本`,
        detail: updates.map((plugin) => `${plugin.title} → ${plugin.update.recommended}`).slice(0, 3).join('、'),
        action: 'health',
      })
    }
    const idle = plugins.filter((plugin) => plugin.usage.observable && plugin.usage.calls === 0 && plugin.enabled && !plugin.official)
    if (idle.length) {
      list.push({
        id: 'idle',
        tone: 'warn',
        title: `${idle.length} 个插件在统计窗口内无调用`,
        detail: '可在「使用频率」中逐项确认后禁用或卸载；禁用可随时恢复。',
        action: 'usage',
      })
    }
    const expensive = plugins.filter((plugin) => plugin.enabled && plugin.token.schemaTokens >= 600 && plugin.usage.calls <= 1)
    if (expensive.length) {
      list.push({
        id: 'expensive',
        tone: 'warn',
        title: `${expensive.length} 个插件常驻开销较高、调用次数偏低`,
        detail: expensive.map((plugin) => plugin.title).slice(0, 4).join(' / '),
        action: 'tokens',
      })
    }
    if (counts.failed) {
      list.push({
        id: 'failed',
        tone: 'error',
        title: `${counts.failed} 个插件激活失败`,
        detail: '激活失败的行不会运行，并可能影响启动；请在健康页查看具体行。',
        action: 'health',
      })
    }
    if (market && market.hot && market.hot.length) {
      list.push({
        id: 'market',
        tone: 'brand',
        title: '插件市场数据已更新',
        detail: market.hot.map((item) => item.name).slice(0, 3).join(' · '),
        action: 'market',
      })
    }
    return list
  }

  getLocalizedBundles() {
    const inventory = this.inventory.data
    return inventory ? inventory.units.map((unit) => ({ id: unit.id, name: unit.name, title: unit.title })) : []
  }

  async runAction(action, payload, report = () => {}) {
    const pm = this.ctx.get('pluginManager')
    if (!pm) throw new Error('pluginManager 服务不可用')
    if (action === 'setPluginEnabled') {
      const id = String(payload.id || '')
      const entry = (await pm.listPlugins()).find((item) => String(item.entryId) === id)
      if (!entry) throw new Error('未找到插件行: ' + id)
      const result = await pm.setPluginEnabled(entry.entryId, Boolean(payload.enabled))
      this.afterChange()
      return summarizeChange(result)
    }
    if (action === 'setBundleEnabled') {
      const name = String(payload.name || '')
      if (name === SELF) throw new Error('不能禁用监管中心自身')
      const result = await pm.setBundleEnabled(name, Boolean(payload.enabled))
      this.afterChange()
      return summarizeChange(result)
    }
    if (action === 'removeBundle') {
      const name = String(payload.name || '')
      if (name === SELF) throw new Error('不能卸载监管中心自身')
      const bundle = (await pm.listBundles()).find((item) => item.name === name)
      if (!bundle) throw new Error('未找到插件包: ' + name)
      if (!bundle.removable) throw new Error('该包不可由插件管理器卸载: ' + name)
      report(15, '卸载', '正在卸载插件')
      const stop = this.startTicker(report, 15, 90, '卸载', '正在移除插件包，通常需要几十秒')
      let result
      try {
        result = await pm.removeBundle(name)
      } finally {
        stop()
      }
      this.afterChange()
      report(100, '完成', '卸载完成')
      return summarizeChange(result)
    }
    if (action === 'install') {
      const spec = String(payload.spec || '').trim()
      if (!spec || spec.length > 600) throw new Error('安装参数无效')
      if (!/^(?:@[\w.-]+\/)?[\w.-]+(?:@[^\s]+)?$|^https:\/\/|^github:|^git\+|^file:/.test(spec)) throw new Error('安装来源不受支持: ' + spec)
      report(5, '准备', '正在解析安装版本')
      const installedName = packageNameOfSpec(spec)
      if (installedName) {
        const installed = (await pm.listBundles()).find((bundle) => bundle.name === installedName && (bundle.installed || bundle.availability === 'profile'))
        if (installed) return this.updateBundle(pm, installed.name, spec, report)
      }
      const resolved = await this.resolveInstallSpec(spec)
      report(15, '安装', '正在安装插件')
      const stop = this.startTicker(report, 15, 90, '安装', '正在通过 pnpm 安装，通常需要 1–3 分钟')
      let result
      try {
        result = await pm.installBundle(resolved.spec, { saveExact: true })
      } finally {
        stop()
      }
      this.afterChange()
      report(100, '完成', '安装完成')
      const summary = summarizeChange(result)
      summary.spec = resolved.spec
      summary.note = resolved.note
      return summary
    }
    if (action === 'update') {
      const name = String(payload.name || '')
      const spec = String(payload.spec || '').trim()
      if (!name || name === SELF) throw new Error('不能更新监管中心自身')
      if (!spec || spec.length > 600) throw new Error('更新参数无效')
      if (!/^(?:@[\w.-]+\/)?[\w.-]+(?:@[^\s]+)?$/.test(spec)) throw new Error('更新来源不受支持: ' + spec)
      return this.updateBundle(pm, name, spec, report)
    }
    if (action === 'createBackup') {
      const name = String(payload.name || '')
      const bundles = await pm.listBundles()
      const existing = bundles.find((bundle) => bundle.name === name)
      if (!existing) throw new Error('未找到插件包: ' + name)
      report(20, '备份', '正在创建版本备份')
      const backup = await this.createBackup(name, existing.version || 'unknown', existing)
      if (!backup.ok) throw new Error('备份失败: ' + backup.error)
      report(100, '完成', '备份完成')
      return { ok: true, backup: backup.meta }
    }
    if (action === 'deleteBackup') {
      report(30, '删除', '正在删除备份')
      const result = await this.deleteBackup(String(payload.id || ''))
      report(100, '完成', '备份已删除')
      return result
    }
    if (action === 'restoreBackup') {
      return this.restoreBackup(String(payload.id || ''), report)
    }
    if (action === 'setRates') {
      this.settings = {
        inputPerM: Math.max(0, safeNumber(payload.inputPerM)),
        outputPerM: Math.max(0, safeNumber(payload.outputPerM)),
      }
      await writeJson(path.join(this.root, 'settings.json'), this.settings)
      this.snapshotCache.at = 0
      return { ok: true, settings: this.settings }
    }
    if (action === 'rescan') {
      this.invalidate()
      await this.getUsage(true)
      this.getNpmMap(true).catch(() => {})
      this.snapshotCache.at = 0
      return { ok: true }
    }
    if (action === 'refreshMarket') {
      await this.getMarket(true)
      this.snapshotCache.at = 0
      return { ok: true }
    }
    throw new Error('未知操作: ' + action)
  }

  async createBackup(name, version, existing) {
    const source = packageDirOf(name) || sourceDirOf(existing && existing.source)
    if (!source) return { ok: false, error: '未找到插件安装目录，无法创建备份' }
    const safeName = String(name).replace(/[\\/:*?"<>|@]/g, '_')
    const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 17)
    const folder = `${String(version).replace(/[\\/:*?"<>|]/g, '_')}-${stamp}`
    const root = path.join(this.root, 'backups')
    const target = path.join(root, safeName, folder)
    try {
      await fsp.mkdir(target, { recursive: true })
      await fsp.cp(source, target, {
        recursive: true,
        force: true,
        filter: (item) => {
          const base = path.basename(item)
          return base !== 'node_modules' && base !== '.git'
        },
      })
      const stats = await measureDir(target)
      const sourceSpec = existing && typeof existing.source === 'string' ? existing.source : ''
      const meta = {
        id: `${safeName}/${folder}`,
        name,
        version,
        createdAt: Date.now(),
        files: stats.files,
        bytes: stats.bytes,
        spec: /^(link:|file:|https:|github:|git\+)/.test(sourceSpec) ? sourceSpec : `${name}@${version}`,
      }
      await fsp.writeFile(path.join(target, 'backup.json'), JSON.stringify(meta), 'utf8')
      return { ok: true, meta }
    } catch (error) {
      await fsp.rm(target, { recursive: true, force: true }).catch(() => {})
      return { ok: false, error: errorMessage(error) }
    }
  }

  async listBackups() {
    const root = path.join(this.root, 'backups')
    const backups = []
    let groups = []
    try { groups = await fsp.readdir(root, { withFileTypes: true }) } catch { groups = [] }
    for (const group of groups) {
      if (!group.isDirectory()) continue
      let folders = []
      try { folders = await fsp.readdir(path.join(root, group.name), { withFileTypes: true }) } catch { continue }
      for (const folder of folders) {
        if (!folder.isDirectory()) continue
        const dir = path.join(root, group.name, folder.name)
        try {
          const meta = JSON.parse(await fsp.readFile(path.join(dir, 'backup.json'), 'utf8'))
          if (!meta || !meta.id || !meta.name) continue
          backups.push({ ...meta, path: dir })
        } catch { /* incomplete backup */ }
      }
    }
    backups.sort((a, b) => b.createdAt - a.createdAt)
    const publicBackups = backups.map(({ path: _path, ...rest }) => rest)
    return { backups: publicBackups, totalBytes: publicBackups.reduce((sum, item) => sum + safeNumber(item.bytes), 0) }
  }

  resolveBackupDir(id) {
    const root = path.resolve(this.root, 'backups')
    const dir = path.resolve(root, String(id || ''))
    if (dir === root || !dir.startsWith(root + path.sep)) throw new Error('备份标识无效')
    return dir
  }

  async deleteBackup(id) {
    const dir = this.resolveBackupDir(id)
    await fsp.rm(dir, { recursive: true, force: true })
    return { ok: true, id }
  }

  async restoreBackup(id, report = () => {}) {
    report(5, '准备', '正在读取备份信息')
    const dir = this.resolveBackupDir(id)
    let meta
    try { meta = JSON.parse(await fsp.readFile(path.join(dir, 'backup.json'), 'utf8')) } catch { throw new Error('备份元数据不可读') }
    if (!meta || !meta.name || !meta.version) throw new Error('备份元数据不完整')
    const pm = this.ctx.get('pluginManager')
    if (!pm) throw new Error('pluginManager 服务不可用')
    const bundles = await pm.listBundles()
    const current = bundles.find((bundle) => bundle.name === meta.name)
    const currentSpec = current
      ? ((current.installTarget && current.installTarget.spec) || `${meta.name}@${current.version}`)
      : null
    let reinstall = null
    if (!current || current.version !== meta.version) {
      if (current) {
        if (!current.removable) throw new Error('当前插件的安装方式不支持自动恢复: ' + meta.name)
        const removal = await pm.removeBundle(meta.name)
        if (!summarizeChange(removal).ok) throw new Error('恢复前移除当前版本失败，未修改备份')
      }
      try {
        report(15, '安装', '正在安装备份版本')
        const stop = this.startTicker(report, 15, 90, '安装', '正在安装备份版本，通常需要 1–3 分钟')
        let result
        try {
          result = await pm.installBundle(meta.spec || `${meta.name}@${meta.version}`, { saveExact: true })
        } finally {
          stop()
        }
        reinstall = summarizeChange(result)
        if (!reinstall.ok) throw new Error(reinstall.error ? (reinstall.error.diagnostic || reinstall.error.code) : '安装备份版本失败')
      } catch (error) {
        let rolled = 'not-attempted'
        if (currentSpec) {
          try {
            const result = await pm.installBundle(currentSpec, { saveExact: true })
            rolled = result && result.application === 'failed' ? 'failed' : 'applied'
          } catch { rolled = 'failed' }
        }
        throw new Error(`恢复备份版本失败：${errorMessage(error)}；当前版本回滚${rolled === 'applied' ? '成功' : rolled === 'failed' ? '失败' : '未执行'}；备份仍然保留`)
      }
    }
    const target = packageDirOf(meta.name)
    if (!target) throw new Error('未找到当前插件的安装目录，无法恢复文件')
    report(92, '恢复', '正在用备份覆盖插件文件')
    try {
      await fsp.cp(dir, target, {
        recursive: true,
        force: true,
        filter: (item) => path.basename(item) !== 'backup.json' && path.basename(item) !== 'node_modules',
      })
    } catch (error) {
      throw new Error(`备份版本已安装，但文件覆盖失败：${errorMessage(error)}；备份仍然保留`)
    }
    this.afterChange()
    report(100, '完成', '备份恢复完成')
    return { ok: true, name: meta.name, version: meta.version, reinstall, note: '已按备份覆盖插件文件，建议重启 DSH 生效。' }
  }

  async updateBundle(pm, name, spec, report = () => {}) {
    report(2, '准备', '正在解析目标版本')
    const bundles = await pm.listBundles()
    const existing = bundles.find((bundle) => bundle.name === name && (bundle.installed || bundle.availability === 'profile'))
    if (!existing) throw new Error('未找到已安装的插件包: ' + name)
    if (!existing.removable) throw new Error('该插件包不可由插件管理器更新: ' + name)
    const previousVersion = existing.version || 'unknown'
    const previousSpec = (existing.installTarget && existing.installTarget.spec)
      || (existing.source && /^(link:|file:|https:|github:|git\+)/.test(existing.source) ? existing.source : `${name}@${previousVersion}`)
    const resolved = await this.resolveInstallSpec(spec)
    report(10, '备份', '正在创建版本备份')
    const backup = await this.createBackup(name, previousVersion, existing)
    if (!backup.ok) {
      report(100, '失败', '备份失败，更新已取消')
      return { ok: false, phase: 'backup', target: name, error: { code: 'backup-failed', diagnostic: backup.error }, note: '备份失败，已取消更新；插件未做任何修改' }
    }
    report(28, '备份', '备份完成')
    report(32, '卸载', '正在移除旧版本')
    const removal = await pm.removeBundle(name)
    this.afterChange()
    const removalSummary = summarizeChange(removal)
    if (!removalSummary.ok) {
      report(100, '失败', '移除旧版本失败，更新已取消')
      return { ...removalSummary, ok: false, phase: 'remove', note: '更新前移除旧版本失败，未执行安装' }
    }
    const rollback = async () => {
      if (!previousSpec || previousVersion === 'unknown') return 'not-attempted'
      try {
        const result = await pm.installBundle(previousSpec, { saveExact: true })
        this.afterChange()
        return result && result.application === 'failed' ? 'failed' : 'applied'
      } catch {
        return 'failed'
      }
    }
    report(42, '安装', '正在安装新版本')
    const stop = this.startTicker(report, 42, 90, '安装', '正在通过 pnpm 安装，通常需要 1–3 分钟')
    let summary
    try {
      const result = await pm.installBundle(resolved.spec, { saveExact: true })
      this.afterChange()
      summary = summarizeChange(result)
    } catch (error) {
      stop()
      report(94, '回滚', '安装失败，正在回滚旧版本')
      const rolled = await rollback()
      report(100, '失败', '更新失败，旧版本回滚' + (rolled === 'applied' ? '成功' : rolled === 'failed' ? '失败' : '未执行'))
      throw new Error(`新版本安装失败：${errorMessage(error)}；旧版本回滚${rolled === 'applied' ? '成功' : rolled === 'failed' ? '失败' : '未执行'}`)
    }
    stop()
    summary.previousVersion = previousVersion
    summary.spec = resolved.spec
    summary.note = resolved.note || null
    summary.phase = 'install'
    summary.backup = backup.meta.id
    if (!summary.ok) {
      report(94, '回滚', '安装失败，正在回滚旧版本')
      const rolled = await rollback()
      summary.rollback = rolled
      summary.note = `新版本安装失败，旧版本回滚${rolled === 'applied' ? '成功' : rolled === 'failed' ? '失败' : '未执行'}`
      report(100, '失败', summary.note)
    } else {
      report(100, '完成', '更新完成')
    }
    return summary
  }

  async resolveInstallSpec(spec) {
    if (!/^(?:@[\w.-]+\/)?[\w.-]+(?:@[^\s]+)?$/.test(spec)) return { spec, note: null }
    let name = spec
    let requested = null
    const at = spec.lastIndexOf('@')
    if (at > 0) { name = spec.slice(0, at); requested = spec.slice(at + 1) }
    try {
      const inventory = await this.getInventory()
      const npm = await this.fetchNpm(name, inventory)
      if (npm && npm.status === 'ok') {
        if (requested && requested !== 'latest') {
          const response = await fetch(`${npm.registry}/${name.startsWith('@') ? `@${name.slice(1).replace('/', '%2f')}` : encodeURIComponent(name)}`, {
            headers: { accept: 'application/vnd.npm.install-v1+json' },
            signal: AbortSignal.timeout(8000),
          })
          if (response.ok) {
            const document = await response.json()
            const manifest = document.versions && document.versions[requested]
            const requirement = requirementOf(manifest)
            if (manifest && (!requirement || satisfies(inventory.dshVersion, requirement))) {
              return { spec, note: null }
            }
          }
        }
        if (!npm.recommended) {
          throw new Error(`该插件没有兼容 DSH ${inventory.dshVersion} 的版本`)
        }
        if (requested && requested === npm.recommended) return { spec, note: null }
        return {
          spec: `${name}@${npm.recommended}`,
          note: requested && requested !== npm.recommended
            ? `请求的 ${requested} 与当前 DSH 不兼容，或并非最佳版本，已调整为 ${npm.recommended}`
            : (npm.latest && npm.latest !== npm.recommended ? `最新版 ${npm.latest} 要求更高 DSH，已选择兼容版本 ${npm.recommended}` : null),
        }
      }
    } catch (error) {
      if (String(error.message || error).includes('没有兼容')) throw error
    }
    return { spec, note: null }
  }

  afterChange() {
    this.invalidate()
    this.npm.at = 0
  }

  enqueue(task) {
    const next = this.mutationQueue.then(task, task)
    this.mutationQueue = next.catch(() => {})
    return next
  }

  startTicker(report, from, to, phase, message) {
    let value = from
    report(value, phase, message)
    const timer = setInterval(() => {
      value += Math.max(0.4, (to - value) * 0.025)
      if (value > to) value = to
      report(value, phase, message)
    }, 1000)
    return () => clearInterval(timer)
  }
}

function rootModule(moduleName) {
  if (typeof moduleName !== 'string') return ''
  if (moduleName.startsWith('file:')) return moduleName
  return packageRootName(moduleName) || moduleName
}

function packageNameOfSpec(spec) {
  if (!/^(?:@[\w.-]+\/)?[\w.-]+(?:@[^\s]+)?$/.test(spec)) return null
  const at = spec.lastIndexOf('@')
  return at > 0 ? spec.slice(0, at) : spec
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function measureDir(dir) {
  let files = 0
  let bytes = 0
  const walk = async (target) => {
    let items = []
    try { items = await fsp.readdir(target, { withFileTypes: true }) } catch { return }
    for (const item of items) {
      const full = path.join(target, item.name)
      if (item.isDirectory()) await walk(full)
      else if (item.isFile()) {
        try {
          const stat = await fsp.stat(full)
          files += 1
          bytes += stat.size
        } catch { /* ignore unreadable file */ }
      }
    }
  }
  await walk(dir)
  return { files, bytes }
}

async function collectJs(dir, limit) {
  const result = []
  const walk = async (target) => {
    if (result.length >= limit) return
    let items = []
    try { items = await fsp.readdir(target, { withFileTypes: true }) } catch { return }
    for (const item of items) {
      if (result.length >= limit) return
      if (item.name === 'node_modules' || item.name === '.git') continue
      const full = path.join(target, item.name)
      if (item.isDirectory()) await walk(full)
      else if (/\.(js|mjs|cjs)$/.test(item.name) && !/\.map$/.test(item.name) && !/^client\.(js|mjs|cjs)$/.test(item.name) && !/\.client\.(js|mjs|cjs)$/.test(item.name)) result.push(full)
    }
  }
  await walk(dir)
  return result
}

function summarizeChange(result) {
  if (!result || typeof result !== 'object') return { ok: false, error: '插件管理器没有返回结果' }
  return {
    ok: result.application !== 'failed' && !result.error,
    changed: Boolean(result.changed),
    application: result.application || null,
    stage: result.stage || null,
    target: result.target || null,
    version: result.version || null,
    enabled: result.enabled,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    error: result.error ? { code: result.error.code, diagnostic: result.error.diagnostic, incompatible: result.error.incompatible || null } : null,
    pendingBuilds: result.pendingBuilds || [],
  }
}

async function readBody(req, limit = 65536) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(res, value, status = 200) {
  if (res.writableEnded) return
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(body)
}

function allowedOrigin(state, req) {
  const origin = state.origin()
  const header = req.headers.origin
  if (!header || header === 'null') return true
  if (header === origin) return true
  try {
    const requestUrl = new URL(header)
    const serviceUrl = new URL(origin)
    if (requestUrl.protocol === serviceUrl.protocol && requestUrl.hostname === serviceUrl.hostname) return true
    if (['dsh-app:', 'app:', 'file:'].includes(requestUrl.protocol)) return true
    if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(requestUrl.hostname)) return true
  } catch { /* fall through to the referer check */ }
  const referer = req.headers.referer
  if (typeof referer === 'string') {
    try {
      const refererUrl = new URL(referer)
      const serviceUrl = new URL(origin)
      if (refererUrl.protocol === serviceUrl.protocol && refererUrl.hostname === serviceUrl.hostname) return true
    } catch { /* reject */ }
  }
  return false
}

export function apply(ctx) {
  const state = new Supervisor(ctx)

  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(() => scoped.webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: (req, res) => handleRequest(state, req, res),
    }))
    scoped.effect(() => {
      const timer = setTimeout(() => {
        state.getInventory().then(() => state.getUsage()).catch(() => {})
        state.getNpmMap().catch(() => {})
      }, 2500)
      return () => clearTimeout(timer)
    })
  })
}

async function handleRequest(state, req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  if (url.pathname !== ROUTE && !url.pathname.startsWith(`${ROUTE}/`)) return sendJson(res, { error: 'not found' }, 404)
  const route = url.pathname.slice(ROUTE.length).replace(/^\//, '')
  try {
    if (!allowedOrigin(state, req)) return sendJson(res, { error: 'origin rejected' }, 403)
    if (req.method === 'GET' && route === 'api/snapshot') {
      const force = url.searchParams.get('force') === '1'
      return sendJson(res, await state.snapshot(force))
    }
    if (req.method === 'GET' && route === 'api/market') {
      const force = url.searchParams.get('refresh') === '1'
      const data = await state.getMarket(force)
      return sendJson(res, data || { status: 'loading' })
    }
    if (req.method === 'GET' && route === 'api/backups') {
      return sendJson(res, await state.listBackups())
    }
    if (req.method === 'GET' && route === 'api/job') {
      const job = state.jobs.get(url.searchParams.get('id') || '')
      return sendJson(res, job || { status: 'missing' })
    }
    if (req.method === 'POST' && route === 'api/action') {
      const raw = await readBody(req)
      let payload
      try { payload = JSON.parse(raw || '{}') } catch { return sendJson(res, { error: 'invalid json' }, 400) }
      const action = String(payload.action || '')
      const allowed = new Set(['setPluginEnabled', 'setBundleEnabled', 'removeBundle', 'install', 'update', 'createBackup', 'deleteBackup', 'restoreBackup', 'setRates', 'rescan', 'refreshMarket'])
      if (!allowed.has(action)) return sendJson(res, { error: 'unsupported action' }, 400)
      if (action === 'setRates') {
        const result = await state.runAction(action, payload)
        return sendJson(res, { ok: true, result })
      }
      const id = crypto.randomUUID()
      const job = { id, status: 'running', action, startedAt: Date.now(), progress: 0, phase: '排队', message: '等待执行' }
      if (state.jobs.size > 40) {
        const oldest = state.jobs.keys().next().value
        if (oldest) state.jobs.delete(oldest)
      }
      state.jobs.set(id, job)
      const mutating = ['install', 'update', 'removeBundle', 'restoreBackup'].includes(action)
      const report = (progress, phase, message) => {
        const value = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)))
        job.progress = value
        job.phase = phase || job.phase
        job.message = message || job.message
      }
      Promise.resolve()
        .then(() => (mutating ? state.enqueue(() => state.runAction(action, payload, report)) : state.runAction(action, payload, report)))
        .then((result) => {
          job.status = 'done'
          job.progress = 100
          job.phase = '完成'
          job.message = '操作完成'
          job.result = result
          job.endedAt = Date.now()
        })
        .catch((error) => {
          job.status = 'error'
          job.progress = 100
          job.phase = '失败'
          job.message = errorMessage(error)
          job.error = errorMessage(error)
          job.endedAt = Date.now()
        })
      return sendJson(res, { ok: true, jobId: id })
    }
    return sendJson(res, { error: 'not found' }, 404)
  } catch (error) {
    return sendJson(res, { error: errorMessage(error) }, 500)
  }
}
