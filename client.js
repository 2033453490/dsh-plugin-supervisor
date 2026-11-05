window.__ModuleLoader__.load({
  id: 'dsh-plugin-supervisor',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const API = '/__plugin-supervisor/api/'
    const NS = 'plugin-supervisor'

    let tr = (key) => key

    function t(key, vars) {
      let value = key
      try { value = tr(key) } catch { value = key }
      if (!value) value = key
      if (vars) for (const [name, replacement] of Object.entries(vars)) value = value.replace(new RegExp(`\\{${name}\\}`, 'g'), String(replacement))
      return value
    }

    const PALETTE = ['#4f8cff', '#22b8a7', '#a66bff', '#f59e42', '#ef6f8f', '#5ec26a', '#8b7cf6', '#e0a83c', '#3aa9d9', '#c46bd8']

    function hueOf(text) {
      let hash = 0
      for (let i = 0; i < String(text).length; i += 1) hash = (hash * 31 + String(text).charCodeAt(i)) % 100000
      return hash
    }

    function colorOf(text) {
      return PALETTE[hueOf(text) % PALETTE.length]
    }

    function fmt(number) {
      if (number === null || number === undefined || Number.isNaN(Number(number))) return '—'
      return new Intl.NumberFormat('zh-CN').format(Math.round(Number(number)))
    }

    function fmtTokens(number) {
      const value = Number(number) || 0
      if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 2)}M`
      if (value >= 1000) return `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}k`
      return fmt(value)
    }

    function fmtTime(timestamp) {
      if (!timestamp) return t('从未')
      const delta = Date.now() - Number(timestamp)
      if (delta < 60000) return t('刚刚')
      if (delta < 3600000) return `${Math.floor(delta / 60000)} ${t('分钟前')}`
      if (delta < 86400000) return `${Math.floor(delta / 3600000)} ${t('小时前')}`
      return `${Math.floor(delta / 86400000)} ${t('天前')}`
    }

    function fmtMoney(value) {
      if (!value) return '—'
      return `¥${Number(value).toFixed(value < 1 ? 3 : 2)}`
    }

    function fmtBytes(value) {
      const bytes = Number(value) || 0
      if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`
      if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
      if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
      return `${bytes} B`
    }

    function shortName(name) {
      if (!name) return ''
      return name.replace(/^@[^/]+\//, '')
    }

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    async function readJson(response) {
      const text = await response.text()
      let json
      try { json = JSON.parse(text) } catch { throw new Error(text.slice(0, 180) || `HTTP ${response.status}`) }
      if (!response.ok || json.error) throw new Error(json.error || `HTTP ${response.status}`)
      return json
    }

    async function postAction(action, payload, onProgress) {
      const response = await fetch(`${API}action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      })
      const json = await readJson(response)
      if (!json.jobId) return json.result
      if (onProgress) onProgress({ progress: 0, phase: '排队', message: '等待执行' })
      const started = Date.now()
      for (;;) {
        if (Date.now() - started > 900000) throw new Error('操作超时（后台任务可能仍在继续）')
        await sleep(650)
        const jobResponse = await fetch(`${API}job?id=${encodeURIComponent(json.jobId)}`)
        const job = await readJson(jobResponse)
        if (onProgress) onProgress(job)
        if (job.status === 'done') return job.result
        if (job.status === 'error') throw new Error(job.error || '操作失败')
        if (job.status === 'missing') throw new Error('任务状态丢失')
      }
    }

    function useLocaleTick(ctx) {
      const [, setRevision] = useState(0)
      useEffect(() => {
        if (!ctx || !ctx.locale) return undefined
        return ctx.locale.subscribe(() => setRevision((value) => value + 1))
      }, [ctx])
    }

    function useSnapshot() {
      const [state, setState] = useState({ data: null, error: null, loading: true })
      const load = useCallback(async (force) => {
        try {
          const response = await fetch(`${API}snapshot${force ? '?force=1' : ''}`)
          const data = await readJson(response)
          setState({ data, error: null, loading: false })
        } catch (error) {
          setState((current) => ({ ...current, error: String(error.message || error), loading: false }))
        }
      }, [])
      useEffect(() => {
        load(true)
        const timer = setInterval(() => load(false), 20000)
        return () => clearInterval(timer)
      }, [load])
      const busy = Boolean(state.data && (state.data.usageStatus === 'scanning' || state.data.updateStatus === 'loading'))
      useEffect(() => {
        if (!busy) return undefined
        const timer = setInterval(() => load(false), 3000)
        return () => clearInterval(timer)
      }, [busy, load])
      return { ...state, reload: () => load(true), refresh: () => load(false) }
    }

    function useMarket(active) {
      const [state, setState] = useState({ data: null, error: null })
      const load = useCallback(async (force) => {
        try {
          const response = await fetch(`${API}market${force ? '?refresh=1' : ''}`)
          const data = await readJson(response)
          setState({ data, error: data.error || null })
        } catch (error) {
          setState((current) => ({ ...current, error: String(error.message || error) }))
        }
      }, [])
      useEffect(() => { if (active) load(false) }, [active, load])
      const loading = Boolean(active && (!state.data || state.data.status === 'loading'))
      useEffect(() => {
        if (!loading) return undefined
        const timer = setInterval(() => load(false), 2500)
        return () => clearInterval(timer)
      }, [loading, load])
      return { ...state, loading, refresh: () => load(true) }
    }

    function useBackups(active) {
      const [state, setState] = useState({ data: null, error: null, loading: false })
      const load = useCallback(async () => {
        setState((current) => ({ ...current, loading: true }))
        try {
          const response = await fetch(`${API}backups`)
          const data = await readJson(response)
          setState({ data, error: null, loading: false })
        } catch (error) {
          setState({ data: null, error: String(error.message || error), loading: false })
        }
      }, [])
      useEffect(() => { if (active) load() }, [active, load])
      return { ...state, reload: load }
    }

    function Icon({ name, size = 18, stroke = 1.8 }) {
      const paths = {
        grid: [h('rect', { key: 'a', x: 3.5, y: 3.5, width: 7, height: 7, rx: 1.5 }), h('rect', { key: 'b', x: 13.5, y: 3.5, width: 7, height: 7, rx: 1.5 }), h('rect', { key: 'c', x: 3.5, y: 13.5, width: 7, height: 7, rx: 1.5 }), h('rect', { key: 'd', x: 13.5, y: 13.5, width: 7, height: 7, rx: 1.5 })],
        shield: [h('path', { key: 'a', d: 'M12 3.2 19 6v5.2c0 4.4-2.9 7.7-7 9.6-4.1-1.9-7-5.2-7-9.6V6l7-2.8Z' }), h('path', { key: 'b', d: 'M8.8 12.2h2.1l1.2-2.6 1.5 5 1.2-2.4h2.2' })],
        pulse: [h('path', { key: 'a', d: 'M3 12h3.2l2-5.2 3.2 10.4 2.2-7.2 1.8 2H21' })],
        store: [h('path', { key: 'a', d: 'M4 9.5 5.4 4h13.2L20 9.5' }), h('path', { key: 'b', d: 'M4 9.5h16v2.2a2.6 2.6 0 0 1-2.6 2.6h-.8a2.6 2.6 0 0 1-2.6-2.6 2.6 2.6 0 0 1-2.6 2.6h-.8A2.6 2.6 0 0 1 8 11.7a2.6 2.6 0 0 1-2.6 2.6H5.6A1.6 1.6 0 0 1 4 12.7Z' }), h('path', { key: 'c', d: 'M6 14.5V20h12v-5.5' }), h('path', { key: 'd', d: 'M10 20v-3h4v3' })],
        coin: [h('ellipse', { key: 'a', cx: 12, cy: 7, rx: 7, ry: 3 }), h('path', { key: 'b', d: 'M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7' }), h('path', { key: 'c', d: 'M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5' })],
        refresh: [h('path', { key: 'a', d: 'M20 12a8 8 0 1 1-2.3-5.7' }), h('path', { key: 'b', d: 'M20 4v4h-4' })],
        arrow: [h('path', { key: 'a', d: 'M5 12h13' }), h('path', { key: 'b', d: 'm13 7 5 5-5 5' })],
        check: [h('path', { key: 'a', d: 'm5 12.5 4.2 4.2L19 7' })],
        alert: [h('path', { key: 'a', d: 'M12 4 3.5 19h17L12 4Z' }), h('path', { key: 'b', d: 'M12 9v4.5' }), h('path', { key: 'c', d: 'M12 16.6h.01' })],
        trash: [h('path', { key: 'a', d: 'M4 7h16' }), h('path', { key: 'b', d: 'M9 7V4h6v3' }), h('path', { key: 'c', d: 'M6.5 7 8 20h8l1.5-13' }), h('path', { key: 'd', d: 'M10 11v5M14 11v5' })],
        power: [h('path', { key: 'a', d: 'M12 3v9' }), h('path', { key: 'b', d: 'M7.2 6.2a7 7 0 1 0 9.6 0' })],
        download: [h('path', { key: 'a', d: 'M12 3v12' }), h('path', { key: 'b', d: 'm7 10 5 5 5-5' }), h('path', { key: 'c', d: 'M4 20h16' })],
        x: [h('path', { key: 'a', d: 'm6 6 12 12M18 6 6 18' })],
        search: [h('circle', { key: 'a', cx: 11, cy: 11, r: 6.5 }), h('path', { key: 'b', d: 'm16 16 4 4' })],
        clock: [h('circle', { key: 'a', cx: 12, cy: 12, r: 8.2 }), h('path', { key: 'b', d: 'M12 7.5V12l3 2' })],
        plug: [h('path', { key: 'a', d: 'M9 3v5M15 3v5' }), h('path', { key: 'b', d: 'M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6Z' }), h('path', { key: 'c', d: 'M12 17v4' })],
        archive: [h('rect', { key: 'a', x: 3.5, y: 4.5, width: 17, height: 4.2, rx: 1.2 }), h('path', { key: 'b', d: 'M5.4 8.7V20h13.2V8.7' }), h('path', { key: 'c', d: 'M9.5 12.2h5' })],
      }
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      }, paths[name] || paths.grid)
    }

    function PanelGlyph({ size = 22, active }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, style: { display: 'block' },
      },
      h('path', { key: 's', d: 'M12 2.9 19.2 5.8v5.1c0 4.6-3 8.1-7.2 10.1-4.2-2-7.2-5.5-7.2-10.1V5.8L12 2.9Z', opacity: active ? 1 : 0.92 }),
      h('path', { key: 'p', d: 'M8.2 12.1h2.2l1.1-2.5 1.5 4.9 1.2-2.4h2.3' }),
      h('circle', { key: 'd', cx: 17.6, cy: 6.4, r: 1.35, fill: 'currentColor', stroke: 'none' }))
    }

    function Avatar({ plugin, size = 34 }) {
      const color = colorOf(plugin.name || plugin.id || 'x')
      const letter = (plugin.title || plugin.name || '?').trim().charAt(0).toUpperCase()
      return h('span', {
        className: 'psv-avatar',
        style: { width: size, height: size, background: `linear-gradient(145deg, ${color}, color-mix(in srgb, ${color} 62%, #0b1220))`, fontSize: Math.round(size * 0.42) },
        'aria-hidden': true,
      }, letter)
    }

    function StatusDot({ tone }) {
      return h('span', { className: `psv-status-dot psv-${tone}` })
    }

    function Badge({ tone = 'neutral', children, title }) {
      return h('span', { className: `psv-badge psv-badge-${tone}`, title }, children)
    }

    function statusOf(plugin, snapshot) {
      if (plugin.failed) return { tone: 'error', label: t('激活失败') }
      if (plugin.compatibility && plugin.compatibility.status === 'bad') return { tone: 'error', label: t('不兼容') }
      if (plugin.update) return { tone: 'warn', label: t('需更新') }
      if (!plugin.enabled) return { tone: 'idle', label: t('已禁用') }
      if (snapshot && snapshot.updateStatus === 'loading' && !plugin.npm) return { tone: 'idle', label: t('检查中') }
      return { tone: 'ok', label: t('正常运行') }
    }

    function usageOf(plugin) {
      if (!plugin.usage || !plugin.usage.observable) return { tone: 'idle', label: t('不可观测'), rank: 3 }
      if (plugin.usage.calls === 0) return { tone: 'warn', label: t('无调用'), rank: 0 }
      if (plugin.usage.calls <= 2) return { tone: 'warn', label: t('低频使用'), rank: 1 }
      return { tone: 'ok', label: t('高频使用'), rank: 2 }
    }

    function toneColor(tone) {
      if (tone === 'ok') return 'var(--dsw-alias-state-success-primary)'
      if (tone === 'warn') return 'var(--dsw-alias-state-warn-primary)'
      if (tone === 'error') return 'var(--dsw-alias-state-error-primary)'
      if (tone === 'brand') return 'var(--dsw-alias-brand-primary)'
      return 'var(--dsw-alias-state-idle-primary)'
    }

    function Bar({ value, max, tone = 'brand', height = 6 }) {
      const width = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0
      return h('span', { className: 'psv-bar', style: { height } },
        h('span', { className: 'psv-bar-fill', style: { width: `${width}%`, background: toneColor(tone) } }))
    }

    function Spark({ daily, days = 14 }) {
      const values = []
      for (let i = days - 1; i >= 0; i -= 1) {
        const date = new Date(Date.now() - i * 86400000)
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        values.push(daily && daily[key] ? daily[key] : 0)
      }
      const max = Math.max(1, ...values)
      return h('span', { className: 'psv-spark', 'aria-hidden': true },
        values.map((value, index) => h('i', {
          key: index,
          style: { height: `${Math.max(2, (value / max) * 100)}%`, opacity: value ? 0.9 : 0.25 },
        })))
    }

    function Empty({ icon = 'grid', title, detail }) {
      return h('div', { className: 'psv-empty' },
        h('span', { className: 'psv-empty-icon' }, h(Icon, { name: icon, size: 22 })),
        h('b', null, title),
        detail ? h('p', null, detail) : null)
    }

    function Modal({ title, children, onClose, footer, wide }) {
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])
      return h('div', { className: 'psv-mask psv-modal-mask', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('div', { className: `psv-modal${wide ? ' psv-modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('div', { className: 'psv-modal-h' },
            h('b', null, title),
            h('button', { type: 'button', className: 'psv-iconbtn', onClick: onClose, 'aria-label': t('关闭') }, h(Icon, { name: 'x', size: 16 }))),
          h('div', { className: 'psv-modal-b' }, children),
          footer ? h('div', { className: 'psv-modal-f' }, footer) : null))
    }

    function Tile({ icon, tone, label, value, note, onClick }) {
      return h('button', { type: 'button', className: 'psv-tile', onClick },
        h('span', { className: `psv-tile-icon psv-tone-${tone}` }, h(Icon, { name: icon, size: 20 })),
        h('span', { className: 'psv-tile-body' },
          h('span', { className: 'psv-tile-label' }, label),
          h('span', { className: 'psv-tile-num' }, value),
          h('span', { className: 'psv-tile-note' }, note)),
        h('span', { className: 'psv-tile-arrow' }, h(Icon, { name: 'arrow', size: 16 })))
    }

    function TabButton({ active, icon, label, count, onClick }) {
      return h('button', {
        type: 'button', className: `psv-tab${active ? ' on' : ''}`, onClick, 'aria-pressed': active,
      },
      h(Icon, { name: icon, size: 15 }),
      h('span', null, label),
      count !== undefined && count !== null ? h('em', null, count) : null)
    }

    function ConfirmBar({ busy, onCancel, onConfirm, label }) {
      return h('div', { className: 'psv-confirm' },
        h('button', { type: 'button', className: 'psv-btn', onClick: onCancel, disabled: Boolean(busy) }, t('取消')),
        h('button', { type: 'button', className: 'psv-btn primary', onClick: onConfirm, disabled: Boolean(busy) }, busy || label))
    }

    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null, info: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error, info) {
        this.setState({ info })
      }

      render() {
        if (this.state.error) {
          return h('div', { className: 'psv-root' },
            h('style', null, CSS),
            h('div', { className: 'psv-inner' },
              h('div', { className: 'psv-card psv-crash' },
                h('b', null, '监管中心页面渲染出错'),
                h('p', null, '请将以下报错信息提供给开发者；也可先重新加载页面。'),
                h('pre', null, String(this.state.error && this.state.error.stack ? this.state.error.stack : this.state.error)),
                h('button', { type: 'button', className: 'psv-btn primary', onClick: () => location.reload() }, '重新加载'))))
        }
        return this.props.children
      }
    }

    function Page({ ctx }) {
      useLocaleTick(ctx)
      const snapshot = useSnapshot()
      const [tab, setTab] = useState('home')
      const [selectedId, setSelectedId] = useState(null)
      const [busy, setBusy] = useState('')
      const [toast, setToast] = useState(null)
      const [confirm, setConfirm] = useState(null)
      const [progress, setProgress] = useState(null)
      const [healthFilter, setHealthFilter] = useState('all')
      const [usageFilter, setUsageFilter] = useState('all')

      const backups = useBackups(true)

      const data = snapshot.data
      useEffect(() => {
        if (!toast) return undefined
        const timer = setTimeout(() => setToast(null), 5200)
        return () => clearTimeout(timer)
      }, [toast])

      const notify = useCallback((tone, message) => setToast({ tone, message }), [])

      const run = useCallback(async (action, payload, label) => {
        if (busy) return null
        const target = action === 'update' || action === 'removeBundle' ? (payload && payload.name ? String(payload.name) : null) : null
        const tracked = ['update', 'install', 'removeBundle', 'restoreBackup', 'deleteBackup', 'createBackup', 'rescan'].includes(action)
        setBusy(label)
        if (tracked) setProgress({ label, target, percent: 0, phase: '准备', message: '正在提交操作' })
        try {
          const result = await postAction(action, payload, tracked ? (job) => {
            setProgress({
              label,
              target,
              percent: Math.max(0, Math.min(100, Number(job.progress) || 0)),
              phase: job.phase || '',
              message: job.message || '',
            })
          } : undefined)
          if (result && result.ok === false) {
            const detail = result.note || (result.error && (result.error.diagnostic || result.error.code))
            throw new Error(detail || '操作失败')
          }
          let message = `${label} 完成`
          if (result && result.application === 'restart-required') message = `${label} 完成，需要重启 DSH 生效`
          if (result && result.note) message = `${message} · ${result.note}`
          if (result && result.warnings && result.warnings.length) message = `${message} · ${result.warnings[0]}`
          notify('ok', message)
          await snapshot.reload()
          await backups.reload()
          return result
        } catch (error) {
          notify('error', `${label} 失败：${String(error.message || error)}`)
          return null
        } finally {
          setBusy('')
          setProgress(null)
        }
      }, [busy, notify, snapshot, backups.reload])

      const togglePlugin = useCallback((plugin) => {
        const label = plugin.enabled ? t('禁用') : t('启用')
        if (plugin.kind === 'entry') {
          const entryId = plugin.rows && plugin.rows[0] ? plugin.rows[0].entryId : null
          if (!entryId) { notify('error', '未找到对应配置行'); return undefined }
          return run('setPluginEnabled', { id: entryId, enabled: !plugin.enabled }, label)
        }
        return run('setBundleEnabled', { name: plugin.name, enabled: !plugin.enabled }, label)
      }, [run, notify])

      const selected = selectedId && data ? data.plugins.find((plugin) => plugin.id === selectedId) : null

      if (snapshot.error && !data) {
        return h('div', { className: 'psv-root' },
          h('style', null, CSS),
          h('div', { className: 'psv-inner' },
            h('div', { className: 'psv-card psv-error-card' },
              h('b', null, '监管中心无法读取数据'),
              h('p', null, snapshot.error),
              h('button', { type: 'button', className: 'psv-btn primary', onClick: snapshot.reload }, t('重试')))))
      }

      const counts = data ? data.counts : { total: 0, failed: 0, incompatible: 0, update: 0, idle: 0, observable: 0, disabled: 0, ok: 0, conflicts: 0 }
      const healthTone = counts.failed || counts.incompatible ? 'error' : counts.update ? 'warn' : 'ok'

      return h('div', { className: 'psv-root' },
        h('style', null, CSS),
        h('div', { className: 'psv-inner' },
          h('header', { className: 'psv-top' },
            h('div', { className: 'psv-brand' },
              h('span', { className: 'psv-logo' }, h(Icon, { name: 'shield', size: 22 })),
              h('div', null,
                h('h1', null, t('插件监管中心')),
                h('p', null, data ? `配置档案 ${data.profile} · DSH ${data.dshVersion} · ${counts.total} ${t('个插件')}` : t('正在读取…')))),
            h('div', { className: 'psv-actions' },
              data && data.usageStatus === 'scanning' ? h('span', { className: 'psv-live' }, h('i', null), `${t('正在扫描会话…')} ${data.usageProgress ? `${data.usageProgress.done}/${data.usageProgress.total}` : ''}`) : null,
              data && data.updateStatus === 'loading' ? h('span', { className: 'psv-live' }, h('i', null), t('正在检查版本…')) : null,
              h('button', {
                type: 'button', className: 'psv-btn', disabled: Boolean(busy),
                onClick: async () => { setBusy(t('重新检测')); await run('rescan', {}, t('重新检测')); setBusy('') },
              }, h(Icon, { name: 'refresh', size: 14 }), busy === t('重新检测') ? '检测中…' : t('重新检测')))),
          h('nav', { className: 'psv-tabs' },
            h(TabButton, { active: tab === 'home', icon: 'grid', label: t('总览'), onClick: () => setTab('home') }),
            h(TabButton, { active: tab === 'health', icon: 'shield', label: t('健康'), count: counts.failed + counts.incompatible + counts.update || null, onClick: () => setTab('health') }),
            h(TabButton, { active: tab === 'usage', icon: 'pulse', label: t('使用频率'), count: counts.idle || null, onClick: () => setTab('usage') }),
            h(TabButton, { active: tab === 'market', icon: 'store', label: t('市场'), onClick: () => setTab('market') }),
            h(TabButton, { active: tab === 'tokens', icon: 'coin', label: 'Token 成本', onClick: () => setTab('tokens') })),
          !data ? h('div', { className: 'psv-loading' }, h('span', { className: 'psv-spinner' }), t('正在读取…')) :
            tab === 'home' ? h(Home, { data, onOpen: setSelectedId, onTab: setTab, onOpenPlugin: setSelectedId }) :
            tab === 'health' ? h(Health, { data, filter: healthFilter, setFilter: setHealthFilter, onOpen: setSelectedId, onUpdate: (plugin) => setConfirm({ type: 'update', plugin }), progress, backups: backups.data ? backups.data.backups : [], onRestoreBackup: (backup) => setConfirm({ type: 'restoreBackup', backup }), onDeleteBackup: (backup) => setConfirm({ type: 'deleteBackup', backup }) }) :
            tab === 'usage' ? h(Usage, { data, filter: usageFilter, setFilter: setUsageFilter, onOpen: setSelectedId, onToggle: togglePlugin, onRemove: (plugin) => setConfirm({ type: 'remove', plugin }), progress, backups: backups.data ? backups.data.backups : [], onRestoreBackup: (backup) => setConfirm({ type: 'restoreBackup', backup }), onDeleteBackup: (backup) => setConfirm({ type: 'deleteBackup', backup }) }) :
            tab === 'market' ? h(Market, { data, onInstall: (item) => setConfirm({ type: 'install', item }), notify }) :
            h(Tokens, { data, busy, onSaveRates: (rates) => run('setRates', rates, t('保存')), onOpen: setSelectedId }),
          h('footer', { className: 'psv-foot' },
            h('span', null, data ? `更新于 ${fmtTime(data.generatedAt)} · 数据来自本机插件管理器、DSH 会话日志与 awesome-dsh-plugin.com` : ''),
            h('span', null, data && data.usage ? `${t('近 30 天会话')}: ${data.usage.sessions} · ${t('估算')}` : '')),
        ),
        selected ? h(PluginDrawer, {
          plugin: selected,
          data,
          progress,
          history: backups.data ? backups.data.backups.filter((backup) => backup.name === selected.name) : [],
          onClose: () => setSelectedId(null),
          onToggle: togglePlugin,
          onRemove: (plugin) => setConfirm({ type: 'remove', plugin }),
          onUpdate: (plugin) => setConfirm({ type: 'update', plugin }),
          onRestoreBackup: (backup) => setConfirm({ type: 'restoreBackup', backup }),
          onDeleteBackup: (backup) => setConfirm({ type: 'deleteBackup', backup }),
        }) : null,
        confirm ? h(ConfirmDialog, {          confirm,
          busy,
          data,
          onClose: () => setConfirm(null),
          onRun: async (action, payload, label) => {
            setConfirm(null)
            const result = await run(action, payload, label)
            if (action === 'restoreBackup' || action === 'deleteBackup') await backups.reload()
            return result
          },
        }) : null,
        progress && !progress.target ? h(ProgressPanel, { progress }) : null,
        toast ? h('div', { className: `psv-toast psv-toast-${toast.tone}`, role: 'status' },
          h(Icon, { name: toast.tone === 'error' ? 'alert' : 'check', size: 15 }),
          h('span', null, toast.message)) : null)
    }

    function Home({ data, onTab, onOpen }) {
      const counts = data.counts
      const healthTone = counts.failed || counts.incompatible ? 'error' : counts.update ? 'warn' : 'ok'
      const healthy = counts.total ? Math.round(((counts.total - counts.failed - counts.incompatible - counts.update) / counts.total) * 100) : 100
      const score = Math.max(0, Math.min(100, healthy))
      const usage = data.usage || {}
      const suggestions = data.suggestions || []
      const changes = data.history && data.history.changes ? data.history.changes : { new: [], updated: [], removed: [] }
      const changeCount = changes.new.length + changes.updated.length + changes.removed.length
      const top = [...data.plugins].sort((a, b) => b.token.attributable - a.token.attributable).slice(0, 5)
      return h('div', { className: 'psv-stack' },
        h('section', { className: 'psv-hero' },
          h('div', { className: 'psv-ring', style: { background: `conic-gradient(var(--dsw-alias-state-success-primary) ${score}%, color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent) 0)` } },
            h('div', { className: 'psv-ring-in' },
              h('b', null, `${score}%`),
              h('span', null, t('健康度')))),
          h('div', { className: 'psv-hero-copy' },
            h('h2', null, counts.failed || counts.incompatible ? '存在需要处理的插件' : counts.update ? '整体运行正常，有可用更新' : '所有插件运行正常'),
            h('p', null, `${counts.total} 个插件包 · ${counts.failed} 个激活失败 · ${counts.incompatible} 个不兼容 · ${counts.update} 个可更新`),
            h('div', { className: 'psv-chips' },
              h('span', { className: 'psv-chip' }, h(StatusDot, { tone: 'ok' }), `${usage.sessions || 0} 个会话已扫描`),
              h('span', { className: 'psv-chip' }, h(StatusDot, { tone: counts.conflicts ? 'warn' : 'ok' }), `${counts.conflicts} 项冲突提示`),
              h('span', { className: 'psv-chip' }, h(Icon, { name: 'clock', size: 12 }), `统计窗口 ${usage.windowDays || 30} 天`))),
          h('div', { className: 'psv-hero-actions' },
            h('button', { type: 'button', className: 'psv-btn primary', onClick: () => onTab('health') }, t('健康状态'), h(Icon, { name: 'arrow', size: 14 })),
            h('button', { type: 'button', className: 'psv-btn', onClick: () => onTab('usage') }, t('使用频率')))),
        h('div', { className: 'psv-grid4' },
          h(Tile, { icon: 'shield', tone: healthTone, label: t('健康状态'), value: `${counts.failed + counts.incompatible + counts.update} ${t('待处理')}`, note: `${counts.ok} 正常运行 · ${counts.disabled} 已禁用`, onClick: () => onTab('health') }),
          h(Tile, { icon: 'pulse', tone: 'brand', label: t('使用频率'), value: `${counts.idle} 个`, note: `近 30 天无工具调用 · 可观测 ${counts.observable} 个`, onClick: () => onTab('usage') }),
          h(Tile, { icon: 'store', tone: 'brand', label: t('插件市场'), value: data.market.status === 'ready' ? `${data.market.total} ${t('已收录')}` : t('未加载'), note: data.market.hot && data.market.hot.length ? data.market.hot.join(' · ') : '进入后加载排行', onClick: () => onTab('market') }),
          h(Tile, { icon: 'coin', tone: 'warn', label: t('Token 成本'), value: fmtTokens(data.tokenTotal), note: `${fmtTokens(usage.builtin ? usage.builtin.resultTokens : 0)} 内置工具结果未归因`, onClick: () => onTab('tokens') })),
        h('div', { className: 'psv-two' },
          h('section', { className: 'psv-card' },
            h('div', { className: 'psv-card-h' }, h('b', null, t('建议事项')), h('span', null, `${suggestions.length} 条`)),
            suggestions.length ? h('div', { className: 'psv-suggest' },
              suggestions.map((item) => h('button', {
                key: item.id, type: 'button', className: 'psv-suggest-row', onClick: () => onTab(item.action || 'health'),
              },
              h('span', { className: `psv-suggest-dot psv-tone-${item.tone || 'brand'}` }),
              h('span', { className: 'psv-suggest-text' }, h('b', null, item.title), h('span', null, item.detail)),
              h(Icon, { name: 'arrow', size: 14 })))) :
              h(Empty, { icon: 'check', title: '暂无需要处理的事项', detail: '插件运行正常，未发现明显成本异常。' })),
          h('section', { className: 'psv-card' },
            h('div', { className: 'psv-card-h' }, h('b', null, t('近期变更')), changeCount ? h('span', null, `${changeCount} 项`) : null),
            changeCount ? h('div', { className: 'psv-changes' },
              changes.new.length ? h('div', { className: 'psv-change-row' }, h(Badge, { tone: 'ok' }, '新增'), h('span', null, changes.new.map((item) => shortName(item.name)).join(' · '))) : null,
              changes.updated.length ? h('div', { className: 'psv-change-row' }, h(Badge, { tone: 'warn' }, '更新'), h('span', null, changes.updated.map((item) => `${shortName(item.name)} ${item.from} → ${item.to}`).join(' · '))) : null,
              changes.removed.length ? h('div', { className: 'psv-change-row' }, h(Badge, { tone: 'idle' }, '移除'), h('span', null, changes.removed.map((item) => shortName(item.name)).join(' · '))) : null,
              h('p', { className: 'psv-note' }, `对比基准：${fmtTime(data.history.since)}`)) :
              h(Empty, { icon: 'clock', title: '暂无可对比的变更', detail: '监管中心会记录插件版本与安装状态，后续访问即可查看变化。' }))),
        h('section', { className: 'psv-card' },
          h('div', { className: 'psv-card-h' }, h('b', null, t('插件概览')), h('span', null, '按可归因 Token 排序')),
          h('div', { className: 'psv-table' },
            top.map((plugin) => {
              const status = statusOf(plugin, data)
              return h('button', { key: plugin.id, type: 'button', className: 'psv-tr', onClick: () => onOpen(plugin.id) },
                h('span', { className: 'psv-td psv-td-main' },
                  h(Avatar, { plugin, size: 28 }),
                  h('span', { className: 'psv-tr-name' }, h('b', null, plugin.title), h('em', null, shortName(plugin.name)))),
                h('span', { className: 'psv-td' }, h(Badge, { tone: status.tone }, status.label)),
                h('span', { className: 'psv-td psv-num' }, fmtTokens(plugin.token.attributable)),
                h('span', { className: 'psv-td psv-muted' }, `${plugin.usage.calls} ${t('调用')}`),
                h(Icon, { name: 'arrow', size: 13 }))
            })))
      )
    }

    function Health({ data, filter, setFilter, onOpen, onUpdate, progress, backups, onRestoreBackup, onDeleteBackup }) {
      const failed = data.plugins.filter((plugin) => plugin.failed)
      const incompatible = data.plugins.filter((plugin) => plugin.compatibility && plugin.compatibility.status === 'bad')
      const updates = data.plugins.filter((plugin) => plugin.update)
      const filters = [
        { id: 'all', label: t('全部'), count: data.plugins.length },
        { id: 'failed', label: t('激活失败'), count: failed.length },
        { id: 'incompatible', label: t('不兼容'), count: incompatible.length },
        { id: 'update', label: t('需更新'), count: updates.length },
        { id: 'disabled', label: t('已禁用'), count: data.plugins.filter((plugin) => !plugin.enabled).length },
      ]
      let rows = data.plugins
      if (filter === 'failed') rows = failed
      else if (filter === 'incompatible') rows = incompatible
      else if (filter === 'update') rows = updates
      else if (filter === 'disabled') rows = rows.filter((plugin) => !plugin.enabled)
      else rows = [...rows].sort((a, b) => {
        const rank = (plugin) => plugin.failed ? 0 : plugin.compatibility && plugin.compatibility.status === 'bad' ? 1 : plugin.update ? 2 : plugin.enabled ? 3 : 4
        return rank(a) - rank(b) || a.title.localeCompare(b.title, 'zh-CN')
      })
      return h('div', { className: 'psv-stack' },
        h('section', { className: 'psv-card' },
          h('div', { className: 'psv-card-h' }, h('b', null, '冲突与风险'), h('span', null, `${data.conflicts.length} 项`)),
          data.conflicts.length ? h('div', { className: 'psv-conflicts' }, data.conflicts.map((item) => h('div', { key: item.id, className: 'psv-conflict' },
            h('span', { className: `psv-conflict-icon psv-tone-${item.level === 'error' ? 'error' : item.level === 'warn' ? 'warn' : 'idle'}` }, h(Icon, { name: item.level === 'info' ? 'pulse' : 'alert', size: 15 })),
            h('div', { className: 'psv-conflict-text' }, h('b', null, item.title), h('p', null, item.detail)),
            h('span', { className: 'psv-conflict-kind' }, item.kind)))) :
            h('div', { className: 'psv-okline' }, h(Icon, { name: 'check', size: 16 }), '未发现确定性冲突：无重复工具、无激活失败、未发现版本不兼容。功能重叠仍需人工确认。'),
          h('p', { className: 'psv-note' }, '说明：DSH 未向第三方插件提供插槽（slot）占用者查询接口，因此这里检测的是重复工具名、激活失败、版本不兼容与同分类重叠；同一插槽的覆盖关系仅可作为功能重叠提示。')),
        h('div', { className: 'psv-chips psv-filters' }, filters.map((item) => h('button', {
          key: item.id, type: 'button', className: `psv-filter${filter === item.id ? ' on' : ''}`, onClick: () => setFilter(item.id),
        }, item.label, item.count ? h('em', null, item.count) : null))),
        rows.length ? h('div', { className: 'psv-rows' }, rows.map((plugin) => {
          const status = statusOf(plugin, data)
          const compat = plugin.compatibility || { status: 'unknown' }
          const active = Boolean(progress && progress.target === plugin.name)
          return h('div', { key: plugin.id, className: `psv-row psv-row-${status.tone}` },
            h('button', { type: 'button', className: 'psv-row-main', onClick: () => onOpen(plugin.id) },
              h(Avatar, { plugin }),
              h('span', { className: 'psv-row-title' },
                h('span', { className: 'psv-row-name' }, plugin.title, plugin.official ? h(Badge, { tone: 'neutral' }, t('官方')) : null),
                h('span', { className: 'psv-row-sub' }, shortName(plugin.name), ' · ', plugin.version)),
              active ? h(InlineProgress, { progress }) : h(React.Fragment, null,
                h('span', { className: 'psv-row-col' },
                  h('em', null, t('状态')),
                  h(Badge, { tone: status.tone }, status.label)),
                h('span', { className: 'psv-row-col' },
                  h('em', null, t('版本')),
                  plugin.update ? h('span', { className: 'psv-update' }, `${plugin.version} → ${plugin.update.recommended}`) : h('span', { className: plugin.blockedLatest ? 'psv-blocked' : null, title: plugin.blockedLatest ? `最新 ${plugin.blockedLatest.latest} 要求 ${plugin.blockedLatest.requirement || '更高 DSH'}` : null }, plugin.blockedLatest ? `${plugin.version} · 已保持兼容版本` : plugin.version)),
                h('span', { className: 'psv-row-col' },
                  h('em', null, 'DSH'),
                  h('span', { className: compat.status === 'bad' ? 'psv-bad' : compat.status === 'ok' ? 'psv-ok' : 'psv-muted' },
                    compat.status === 'ok' ? t('兼容') : compat.status === 'bad' ? t('不兼容') : t('未声明'))))),
            active ? null : h('span', { className: 'psv-row-actions psv-row-actions-health' },
              h(HistoryMenu, { backups: backups.filter((backup) => backup.name === plugin.name), onRestore: onRestoreBackup, onDelete: onDeleteBackup }),
              plugin.update ? h('button', { type: 'button', className: 'psv-btn sm primary', onClick: () => onUpdate(plugin) }, h(Icon, { name: 'download', size: 12 }), t('更新')) : h('span', { className: 'psv-action-slot' }),
              h('button', { type: 'button', className: 'psv-btn sm', onClick: () => onOpen(plugin.id) }, t('详情'))))
        })) : h(Empty, { icon: 'check', title: '当前筛选条件下没有插件', detail: '请调整筛选条件。' }))
    }

    function Usage({ data, filter, setFilter, onOpen, onToggle, onRemove, progress, backups, onRestoreBackup, onDeleteBackup }) {
      const observable = data.plugins.filter((plugin) => plugin.usage.observable)
      const maxCalls = Math.max(1, ...observable.map((plugin) => plugin.usage.calls))
      const filters = [
        { id: 'all', label: t('全部'), count: data.plugins.length },
        { id: 'idle', label: t('无调用'), count: observable.filter((plugin) => plugin.usage.calls === 0).length },
        { id: 'rare', label: t('低频使用'), count: observable.filter((plugin) => plugin.usage.calls > 0 && plugin.usage.calls <= 2).length },
        { id: 'active', label: t('高频使用'), count: observable.filter((plugin) => plugin.usage.calls > 2).length },
        { id: 'unknown', label: t('不可观测'), count: data.plugins.length - observable.length },
      ]
      let rows = [...data.plugins]
      if (filter === 'idle') rows = rows.filter((plugin) => plugin.usage.observable && plugin.usage.calls === 0)
      else if (filter === 'rare') rows = rows.filter((plugin) => plugin.usage.observable && plugin.usage.calls > 0 && plugin.usage.calls <= 2)
      else if (filter === 'active') rows = rows.filter((plugin) => plugin.usage.observable && plugin.usage.calls > 2)
      else if (filter === 'unknown') rows = rows.filter((plugin) => !plugin.usage.observable)
      else rows.sort((a, b) => {
        const rank = (plugin) => plugin.usage.observable ? plugin.usage.calls : 99999
        return rank(a) - rank(b) || a.title.localeCompare(b.title, 'zh-CN')
      })
      return h('div', { className: 'psv-stack' },
        h('div', { className: 'psv-grid3' },
          h('div', { className: 'psv-mini' }, h('em', null, t('近 30 天会话')), h('b', null, fmt(data.usage.sessions)), h('span', null, `${data.usage.files} 个日志文件`)),
          h('div', { className: 'psv-mini' }, h('em', null, t('可观测插件')), h('b', null, `${data.counts.observable} / ${data.counts.total}`), h('span', null, '有工具可归因')),
          h('div', { className: 'psv-mini' }, h('em', null, t('无调用')), h('b', null, data.counts.idle), h('span', null, `另有 ${data.counts.total - data.counts.observable} 个界面型插件`))),
        h('div', { className: 'psv-chips psv-filters' }, filters.map((item) => h('button', {
          key: item.id, type: 'button', className: `psv-filter${filter === item.id ? ' on' : ''}`, onClick: () => setFilter(item.id),
        }, item.label, item.count ? h('em', null, item.count) : null))),
        h('div', { className: 'psv-rows' }, rows.map((plugin) => {
          const usage = usageOf(plugin)
          const days = plugin.usage.daysSince
          const active = Boolean(progress && progress.target === plugin.name)
          return h('div', { key: plugin.id, className: 'psv-row psv-row-usage' },
            h('button', { type: 'button', className: 'psv-row-main', onClick: () => onOpen(plugin.id) },
              h(Avatar, { plugin }),
              h('span', { className: 'psv-row-title' },
                h('span', { className: 'psv-row-name' }, plugin.title),
                h('span', { className: 'psv-row-sub' }, plugin.usage.observable ? `${plugin.tools.length} 个工具可归因` : '没有可归因的工具')),
              active ? h(InlineProgress, { progress }) : h(React.Fragment, null,
                h('span', { className: 'psv-usage-bar' },
                  h(Bar, { value: plugin.usage.calls, max: maxCalls, tone: usage.tone }),
                  h('em', null, `${plugin.usage.calls} ${t('调用')} · ${plugin.usage.sessions} 会话`)),
                h('span', { className: 'psv-row-col' },
                  h('em', null, t('最后使用')),
                  h('span', null, plugin.usage.lastUsedAt ? fmtTime(plugin.usage.lastUsedAt) : t('从未')),
                  days !== null && days !== undefined ? h('span', { className: 'psv-muted' }, `已 ${days} 天`) : null),
                h(Badge, { tone: usage.tone }, usage.label))),
            active ? null : h('span', { className: 'psv-row-actions psv-row-actions-usage' },
              h(HistoryMenu, { backups: backups.filter((backup) => backup.name === plugin.name), onRestore: onRestoreBackup, onDelete: onDeleteBackup }),
              h('button', { type: 'button', className: 'psv-btn sm', onClick: () => onToggle(plugin) }, plugin.enabled ? t('禁用') : t('启用')),
              plugin.removable ? h('button', { type: 'button', className: 'psv-btn sm danger', onClick: () => onRemove(plugin) }, t('卸载')) : h('span', { className: 'psv-action-slot' }),
              h('button', { type: 'button', className: 'psv-btn sm', onClick: () => onOpen(plugin.id) }, t('详情'))))
        })),
        h('p', { className: 'psv-note' }, t('本页仅统计可归因到工具调用的开销；界面型插件可能显示为不可观测。'), ' “无调用”仅表示近 30 天没有工具调用记录，不代表界面未被使用；卸载前请确认。'))
    }

    function Market({ data, onInstall, notify }) {
      const market = useMarket(true)
      const [kind, setKind] = useState('hot')
      const [query, setQuery] = useState('')
      const payload = market.data
      const installed = useMemo(() => new Set(data ? data.plugins.map((plugin) => plugin.name) : []), [data])
      const list = useMemo(() => {
        if (!payload || payload.status !== 'ready') return []
        const source = kind === 'hot' ? payload.hot : kind === 'dark' ? payload.dark : payload.fresh
        const needle = query.trim().toLowerCase()
        if (!needle) return source
        return source.filter((item) => `${item.name} ${item.owner} ${item.description} ${item.categoryLabel}`.toLowerCase().includes(needle))
      }, [payload, kind, query])
      return h('div', { className: 'psv-stack' },
        h('section', { className: 'psv-card' },
          h('div', { className: 'psv-card-h' },
            h('b', null, t('插件市场')),
            h('span', { className: 'psv-market-actions' },
              payload && payload.status === 'ready' ? h('span', { className: 'psv-muted' }, `索引 ${fmt(payload.total)} 个 · ${fmtTime(payload.at)}`) : null,
              h('button', { type: 'button', className: 'psv-btn sm', onClick: () => market.refresh() }, h(Icon, { name: 'refresh', size: 13 }), t('刷新')))),
          h('p', { className: 'psv-note' }, payload && payload.note ? payload.note : '数据来自 awesome-dsh-plugin.com 公共索引；安装时会再次校验 DSH 兼容版本。'),
          h('div', { className: 'psv-market-toolbar' },
            h('div', { className: 'psv-chips' },
              h('button', { type: 'button', className: `psv-filter${kind === 'hot' ? ' on' : ''}`, onClick: () => setKind('hot') }, t('本周下载')),
              h('button', { type: 'button', className: `psv-filter${kind === 'dark' ? ' on' : ''}`, onClick: () => setKind('dark') }, t('新锐插件')),
              h('button', { type: 'button', className: `psv-filter${kind === 'fresh' ? ' on' : ''}`, onClick: () => setKind('fresh') }, t('新收录'))),
            h('label', { className: 'psv-search' }, h(Icon, { name: 'search', size: 14 }),
              h('input', { className: 'psv-input', placeholder: t('搜索插件'), value: query, onChange: (event) => setQuery(event.target.value) })))),
        market.error ? h('div', { className: 'psv-inline-error' }, h(Icon, { name: 'alert', size: 15 }), `市场索引不可用：${market.error}`,
          h('button', { type: 'button', className: 'psv-btn sm', onClick: () => market.refresh() }, t('重试'))) : null,
        !payload || payload.status === 'loading' ? h('div', { className: 'psv-loading' }, h('span', { className: 'psv-spinner' }), t('正在加载市场…')) :
          !list.length ? h(Empty, { icon: 'store', title: '没有匹配的插件', detail: '请调整关键词，或稍后刷新索引。' }) :
            h('div', { className: 'psv-market-grid' }, list.map((item, index) => {
              const isInstalled = item.installed || (item.npm && installed.has(item.npm))
              return h('article', { key: item.npm || item.name, className: 'psv-mcard' },
                h('div', { className: 'psv-mcard-top' },
                  h('span', { className: 'psv-mrank' }, `#${index + 1}`),
                  h('span', { className: 'psv-mtitle' }, h('b', null, item.npm || item.name), h('em', null, `作者 ${item.owner || '未知'}`)),
                  item.categoryLabel ? h(Badge, { tone: 'neutral' }, item.categoryLabel) : null),
                h('p', { className: 'psv-mdesc' }, item.description || '暂无描述'),
                h('div', { className: 'psv-mstats' },
                  h('span', null, h('b', null, fmt(item.weeklyDownloads !== null && item.weeklyDownloads !== undefined ? item.weeklyDownloads : item.downloads)), item.weeklyDownloads !== null && item.weeklyDownloads !== undefined ? ' 近 7 天下载' : ' 近 30 天下载'),
                  h('span', null, h('b', null, fmt(item.stars)), ' 星标'),
                  item.delta !== null && item.delta !== undefined ? h('span', { className: 'psv-ok' }, `本周 +${fmt(item.delta)}`) : null,
                  h('span', null, item.added ? `收录 ${item.added}` : '')),
                h('div', { className: 'psv-mfoot' },
                  h('span', { className: 'psv-muted' }, item.version ? `v${item.version}` : (item.ageDays < 9999 ? `约 ${Math.round(item.ageDays)} 天` : '')),
                  h('span', { className: 'psv-mfoot-actions' },
                    item.page ? h('a', { className: 'psv-link', href: item.page, target: '_blank', rel: 'noreferrer' }, '详情') : null,
                    isInstalled ? h('span', { className: 'psv-installed' }, h(Icon, { name: 'check', size: 13 }), t('已安装')) :
                      h('button', { type: 'button', className: 'psv-btn sm primary', onClick: () => onInstall(item) }, h(Icon, { name: 'download', size: 13 }), t('安装')))))
            })))
    }

    function Tokens({ data, busy, onSaveRates, onOpen }) {
      const [inputRate, setInputRate] = useState(data.settings ? String(data.settings.inputPerM || '') : '')
      const [outputRate, setOutputRate] = useState(data.settings ? String(data.settings.outputPerM || '') : '')
      useEffect(() => {
        setInputRate(data.settings ? String(data.settings.inputPerM || '') : '')
        setOutputRate(data.settings ? String(data.settings.outputPerM || '') : '')
      }, [data.settings && data.settings.inputPerM, data.settings && data.settings.outputPerM])
      const plugins = data.plugins
      const burn = [...plugins].filter((plugin) => plugin.token.resultTokens > 0).sort((a, b) => b.token.resultTokens - a.token.resultTokens).slice(0, 8)
      const standing = [...plugins].sort((a, b) => b.token.schemaTokens - a.token.schemaTokens).slice(0, 8)
      const value = [...plugins].filter((plugin) => plugin.token.attributable > 0 && plugin.usage.calls > 0)
        .sort((a, b) => b.token.perKToken - a.token.perKToken).slice(0, 6)
      const maxBurn = Math.max(1, ...burn.map((plugin) => plugin.token.resultTokens))
      const maxSchema = Math.max(1, ...standing.map((plugin) => plugin.token.schemaTokens))
      return h('div', { className: 'psv-stack' },
        h('div', { className: 'psv-grid4' },
          h('div', { className: 'psv-mini' }, h('em', null, t('可归因总 Token')), h('b', null, fmtTokens(data.tokenTotal)), h('span', null, `${data.usage.steps} 个模型步骤`)),
          h('div', { className: 'psv-mini' }, h('em', null, t('工具结果占用')), h('b', null, fmtTokens(plugins.reduce((sum, plugin) => sum + plugin.token.resultTokens, 0))), h('span', null, '历史工具返回值')),
          h('div', { className: 'psv-mini' }, h('em', null, t('Schema 常驻开销')), h('b', null, fmtTokens(plugins.reduce((sum, plugin) => sum + plugin.token.schemaTotal, 0))), h('span', null, '工具声明 × 请求数')),
          h('div', { className: 'psv-mini' }, h('em', null, t('会话总 Token')), h('b', null, fmtTokens(data.usage.totals ? data.usage.totals.total : 0)), h('span', null, `含模型输入输出`))),
        h('section', { className: 'psv-card' },
          h('div', { className: 'psv-card-h' }, h('b', null, t('费率')), h('span', null, '可选：将 Token 折算为金额')),
          h('div', { className: 'psv-rates' },
            h('label', null, t('输入 ¥ / 百万 Token'), h('input', { className: 'psv-input', type: 'number', min: '0', step: '0.01', value: inputRate, onChange: (event) => setInputRate(event.target.value) })),
            h('label', null, t('输出 ¥ / 百万 Token'), h('input', { className: 'psv-input', type: 'number', min: '0', step: '0.01', value: outputRate, onChange: (event) => setOutputRate(event.target.value) })),
            h('button', { type: 'button', className: 'psv-btn primary', disabled: Boolean(busy), onClick: () => onSaveRates({ inputPerM: Number(inputRate) || 0, outputPerM: Number(outputRate) || 0 }) }, t('保存'))),
          h('p', { className: 'psv-note' }, '当前仅按输入费率折算可归因 Token；工具结果属于输入侧，因此输出费率暂不参与插件排行。')),
        h('div', { className: 'psv-two' },
          h('section', { className: 'psv-card' },
            h('div', { className: 'psv-card-h' }, h('b', null, t('Token 消耗排行')), h('span', null, '工具结果占用')),
            burn.length ? h('div', { className: 'psv-ranklist' }, burn.map((plugin) => h('button', { key: plugin.id, type: 'button', className: 'psv-rank', onClick: () => onOpen(plugin.id) },
              h(Avatar, { plugin, size: 26 }),
              h('span', { className: 'psv-rank-main' }, h('b', null, plugin.title), h('span', null, `${plugin.usage.calls} 调用 · 平均 ${fmtTokens(plugin.token.avgResultTokens)}/次`), h(Bar, { value: plugin.token.resultTokens, max: maxBurn, tone: 'warn' })),
              h('span', { className: 'psv-rank-num' }, fmtTokens(plugin.token.resultTokens))))) :
              h(Empty, { icon: 'coin', title: '暂无工具结果 Token 数据', detail: '产生工具调用后，此处将显示统计。' })),
          h('section', { className: 'psv-card' },
            h('div', { className: 'psv-card-h' }, h('b', null, t('常驻开销排行')), h('span', null, '每次请求都会携带 Schema')),
            h('div', { className: 'psv-ranklist' }, standing.map((plugin) => h('button', { key: plugin.id, type: 'button', className: 'psv-rank', onClick: () => onOpen(plugin.id) },
              h(Avatar, { plugin, size: 26 }),
              h('span', { className: 'psv-rank-main' }, h('b', null, plugin.title), h('span', null, `${plugin.tools.length} 个工具 · ${plugin.usage.calls} 调用`), h(Bar, { value: plugin.token.schemaTokens, max: maxSchema, tone: plugin.usage.calls === 0 ? 'error' : 'brand' })),
              h('span', { className: 'psv-rank-num' }, fmtTokens(plugin.token.schemaTokens))))))),
        value.length ? h('section', { className: 'psv-card' },
          h('div', { className: 'psv-card-h' }, h('b', null, t('调用效率')), h('span', null, '每 1k 可归因 Token 对应的调用次数')),
          h('div', { className: 'psv-value-grid' }, value.map((plugin) => h('button', { key: plugin.id, type: 'button', className: 'psv-value', onClick: () => onOpen(plugin.id) },
            h(Avatar, { plugin, size: 26 }),
            h('span', null, h('b', null, plugin.title), h('em', null, `${plugin.token.perKToken} 次 / 1k`)))))) : null,
        h('section', { className: 'psv-card' },
          h('div', { className: 'psv-card-h' }, h('b', null, '逐插件 Token 明细'), h('span', null, t('数据为估算'))),
          h('div', { className: 'psv-table psv-table-wide' },
            h('div', { className: 'psv-thead' },
              h('span', null, t('插件')), h('span', { className: 'psv-num' }, t('调用')), h('span', { className: 'psv-num' }, t('常驻 Schema')), h('span', { className: 'psv-num' }, t('结果 Token')), h('span', { className: 'psv-num' }, t('平均结果')), h('span', { className: 'psv-num' }, t('估算成本'))),
            [...plugins].sort((a, b) => b.token.attributable - a.token.attributable).map((plugin) => h('button', { key: plugin.id, type: 'button', className: 'psv-tr', onClick: () => onOpen(plugin.id) },
              h('span', { className: 'psv-td psv-td-main' }, h(Avatar, { plugin, size: 24 }), h('span', { className: 'psv-tr-name' }, h('b', null, plugin.title), h('em', null, shortName(plugin.name)))),
              h('span', { className: 'psv-td psv-num' }, fmt(plugin.usage.calls)),
              h('span', { className: 'psv-td psv-num' }, fmtTokens(plugin.token.schemaTotal)),
              h('span', { className: 'psv-td psv-num' }, fmtTokens(plugin.token.resultTokens)),
              h('span', { className: 'psv-td psv-num' }, fmtTokens(plugin.token.avgResultTokens)),
              h('span', { className: 'psv-td psv-num' }, fmtMoney(plugin.token.cost))))) )
      )
    }

    function ProgressPanel({ progress }) {
      const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0))
      const detail = [progress.phase, progress.message].filter(Boolean).join(' · ') || '正在处理…'
      return h('div', { className: 'psv-progress', role: 'status', 'aria-live': 'polite' },
        h('div', { className: 'psv-progress-head' },
          h('b', null, progress.label),
          h('em', null, `${percent}%`)),
        h('div', { className: 'psv-progress-bar' }, h('i', { style: { width: `${percent}%` } })),
        h('p', null, detail))
    }

    function InlineProgress({ progress }) {
      const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0))
      return h('span', { className: 'psv-inline-progress', role: 'status', 'aria-live': 'polite', title: [progress.phase, progress.message].filter(Boolean).join(' · ') },
        h('span', { className: 'psv-inline-bar' }, h('i', { style: { width: `${percent}%` } })),
        h('em', null, `${percent}%`),
        h('span', { className: 'psv-inline-phase' }, progress.phase || progress.message || '处理中'))
    }

    function HistoryMenu({ backups, onRestore, onDelete }) {
      const [open, setOpen] = useState(false)
      const anchor = useRef(null)
      useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          if (anchor.current && !anchor.current.contains(event.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
      }, [open])
      return h('span', { className: 'psv-history-anchor', ref: anchor },
        h('button', {
          type: 'button', className: 'psv-btn sm', 'aria-expanded': open,
          onClick: () => setOpen((value) => !value),
        }, h(Icon, { name: 'clock', size: 12 }), `历史版本${backups.length ? ` (${backups.length})` : ''}`),
        open ? h('div', { className: 'psv-history-menu psv-history-menu-row' },
          backups.length ? backups.map((backup) => h('div', { className: 'psv-history-item', key: backup.id },
            h('div', { className: 'psv-history-meta' },
              h('b', null, `v${backup.version}`),
              h('span', null, `${fmtTime(backup.createdAt)} · ${fmtBytes(backup.bytes)}`)),
            h('div', { className: 'psv-history-actions' },
              h('button', { type: 'button', className: 'psv-btn sm primary', onClick: () => { setOpen(false); onRestore(backup) } }, '恢复'),
              h('button', { type: 'button', className: 'psv-btn sm danger', onClick: () => { setOpen(false); onDelete(backup) } }, '删除')))) :
            h('div', { className: 'psv-history-empty' }, '暂无历史版本')) : null)
    }

    function PluginDrawer({ plugin, data, progress, history, onClose, onToggle, onRemove, onUpdate, onRestoreBackup, onDeleteBackup }) {
      const [historyOpen, setHistoryOpen] = useState(false)
      useEffect(() => { setHistoryOpen(false) }, [plugin.id])
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])
      const status = statusOf(plugin, data)
      const compat = plugin.compatibility || { status: 'unknown', detail: '' }
      return h('div', { className: 'psv-mask', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('aside', { className: 'psv-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': plugin.title },
          h('div', { className: 'psv-drawer-h' },
            h(Avatar, { plugin, size: 42 }),
            h('div', { className: 'psv-drawer-title' }, h('b', null, plugin.title), h('span', null, plugin.name)),
            h('button', { type: 'button', className: 'psv-iconbtn', onClick: onClose, 'aria-label': t('关闭') }, h(Icon, { name: 'x', size: 16 }))),
          h('div', { className: 'psv-drawer-badges' },
            h(Badge, { tone: status.tone }, status.label),
            h(Badge, { tone: plugin.enabled ? 'ok' : 'idle' }, plugin.enabled ? t('启用') : t('已禁用')),
            h(Badge, { tone: plugin.official ? 'neutral' : 'brand' }, plugin.official ? t('官方') : t('第三方')),
            h(Badge, { tone: 'neutral' }, `v${plugin.version}`)),
          progress && progress.target === plugin.name ? h('div', { className: 'psv-drawer-progress' }, h(InlineProgress, { progress })) : null,
          h('div', { className: 'psv-drawer-b' },
            h('section', { className: 'psv-d-section' },
              h('h4', null, '健康'),
              h('div', { className: 'psv-kv' },
                h('div', { className: 'psv-compat-row' },
                  h('div', { className: 'psv-compat-item' },
                    h('span', null, 'DSH 兼容'),
                    h('b', { className: compat.status === 'bad' ? 'psv-bad' : compat.status === 'ok' ? 'psv-ok' : 'psv-muted' }, compat.status === 'ok' ? t('兼容') : compat.status === 'bad' ? t('不兼容') : t('未声明'))),
                  history.length ? h('div', { className: 'psv-history' },
                    h('button', { type: 'button', className: 'psv-history-btn', onClick: () => setHistoryOpen((value) => !value), 'aria-expanded': historyOpen },
                      h(Icon, { name: 'clock', size: 12 }),
                      '历史版本',
                      h('em', null, history.length),
                      h('span', { className: 'psv-caret' }, historyOpen ? '▴' : '▾')),
                    historyOpen ? h('div', { className: 'psv-history-menu' },
                      history.map((backup) => h('div', { className: 'psv-history-item', key: backup.id },
                        h('div', { className: 'psv-history-meta' },
                          h('b', null, `v${backup.version}`),
                          h('span', null, `${fmtTime(backup.createdAt)} · ${fmtBytes(backup.bytes)}`)),
                        h('div', { className: 'psv-history-actions' },
                          h('button', { type: 'button', className: 'psv-btn sm primary', onClick: () => { setHistoryOpen(false); onRestoreBackup(backup) } }, '恢复'),
                          h('button', { type: 'button', className: 'psv-btn sm danger', onClick: () => { setHistoryOpen(false); onDeleteBackup(backup) } }, '删除'))))) : null) : null),
                h('span', null, t('要求')), h('b', null, compat.requirement || '—'),
                h('span', null, t('版本')), h('b', null, plugin.version),
                plugin.update ? h('span', null, '可用更新') : null, plugin.update ? h('b', { className: 'psv-ok' }, `${plugin.update.recommended}${plugin.update.latestBlocked ? `（最新 ${plugin.update.latest} 要求更高 DSH）` : ''}`) : null,
                plugin.blockedLatest ? h('span', null, '最新版') : null,
                plugin.blockedLatest ? h('b', { className: 'psv-muted' }, `${plugin.blockedLatest.latest} 要求 ${plugin.blockedLatest.requirement || '更高 DSH'}，已保持兼容版本`) : null)),
            plugin.issues.length ? h('div', { className: 'psv-issues' }, plugin.issues.map((issue, index) => h('div', { key: index, className: `psv-issue psv-${issue.level}` },
              h(Icon, { name: issue.level === 'error' ? 'alert' : 'pulse', size: 14 }), h('span', null, issue.text)))) : null,
            h('section', { className: 'psv-d-section' },
              h('h4', null, '使用'),
              h('div', { className: 'psv-kv' },
                h('span', null, t('调用')), h('b', null, `${plugin.usage.calls} 次 / ${plugin.usage.sessions} 个会话`),
                h('span', null, t('最后使用')), h('b', null, plugin.usage.lastUsedAt ? fmtTime(plugin.usage.lastUsedAt) : t('从未')),
                h('span', null, t('可观测')), h('b', null, plugin.usage.observable ? '是（有工具）' : '否（界面型或未注册工具）'),
                h('span', null, t('配置行')), h('b', null, `${plugin.enabledRows}/${plugin.rows.length} 启用`)),
              h('div', { className: 'psv-spark-wrap' }, h(Spark, { daily: plugin.usage.daily, days: 14 }), h('span', { className: 'psv-muted' }, '近 14 天调用'))),
            h('section', { className: 'psv-d-section' },
              h('h4', null, 'Token 明细'),
              h('div', { className: 'psv-kv' },
                h('span', null, 'Schema / 次'), h('b', null, fmtTokens(plugin.token.schemaTokens)),
                h('span', null, 'Schema 累计'), h('b', null, fmtTokens(plugin.token.schemaTotal)),
                h('span', null, t('结果 Token')), h('b', null, fmtTokens(plugin.token.resultTokens)),
                h('span', null, t('平均结果')), h('b', null, fmtTokens(plugin.token.avgResultTokens)),
                h('span', null, t('估算成本')), h('b', null, fmtMoney(plugin.token.cost)))),
            plugin.tools.length ? h('section', { className: 'psv-d-section' },
              h('h4', null, `${t('工具')} (${plugin.tools.length})`),
              h('div', { className: 'psv-tool-list' }, plugin.tools.map((tool) => h('div', { key: tool.name, className: 'psv-tool' },
                h('span', { className: 'psv-tool-name' }, tool.name, tool.shared ? h(Badge, { tone: 'warn' }, '共享') : null),
                h('span', { className: 'psv-tool-meta' }, `${tool.calls} 调用 · ${fmtTokens(tool.resultTokens)} · Schema ${fmtTokens(tool.schemaTokens)}`))))) : null,
            h('section', { className: 'psv-d-section' },
              h('h4', null, t('配置行')),
              h('div', { className: 'psv-rows-list' }, plugin.rows.map((row) => h('div', { key: row.rowId, className: 'psv-rowline' },
                h('span', { className: `psv-status-dot psv-${row.fiberPhase === 'failed' ? 'error' : row.enabled ? 'ok' : 'idle'}` }),
                h('span', null, row.title || row.rowId),
                h('em', null, row.fiberPhase || '—'))))),
            h('section', { className: 'psv-d-section' },
              h('h4', null, t('来源')),
              h('div', { className: 'psv-kv' },
                h('span', null, t('安装来源')), h('b', { className: 'psv-break' }, plugin.installSpec || plugin.source || '—'),
                h('span', null, t('状态')), h('b', null, plugin.fiberPhase || '—'),
                h('span', null, t('可卸载')), h('b', null, plugin.removable ? '是' : '否')))),
          h('div', { className: 'psv-drawer-f' },
            plugin.update ? h('button', { type: 'button', className: 'psv-btn primary', onClick: () => onUpdate(plugin) }, h(Icon, { name: 'download', size: 14 }), t('更新')) : null,
            h('button', { type: 'button', className: 'psv-btn', onClick: () => onToggle(plugin) }, h(Icon, { name: 'power', size: 14 }), plugin.enabled ? t('禁用') : t('启用')),
            plugin.removable ? h('button', { type: 'button', className: 'psv-btn danger', onClick: () => onRemove(plugin) }, h(Icon, { name: 'trash', size: 14 }), t('卸载')) : null)))
    }

    function ConfirmDialog({ confirm, busy, data, onClose, onRun }) {
      let title = t('确认')
      let body = null
      let label = t('确认')
      let action = ''
      let payload = {}
      if (confirm.type === 'remove') {
        title = t('确认卸载')
        label = t('卸载')
        body = `将从当前配置档案（profile）中移除「${confirm.plugin.title}」（${confirm.plugin.name}）。此操作会卸载该插件包，相关配置可能保留。`
        action = 'removeBundle'
        payload = { name: confirm.plugin.name }
      } else if (confirm.type === 'update') {
        title = t('确认更新')
        label = t('更新')
        const target = confirm.plugin.update ? confirm.plugin.update.recommended : 'latest'
        body = `将「${confirm.plugin.title}」从 ${confirm.plugin.version} 更新至 ${target}。更新过程会先移除旧版本再安装新版本，期间该插件会短暂不可用。插件配置与数据不会随卸载删除；如果你直接修改过插件安装目录内的文件，更新会覆盖这些修改。${confirm.plugin.update && confirm.plugin.update.latestBlocked ? `最新版 ${confirm.plugin.update.latest} 要求更高 DSH，已选择兼容版本。` : ''}`
        action = 'update'
        payload = { name: confirm.plugin.name, spec: `${confirm.plugin.name}@${target}` }
      } else if (confirm.type === 'install') {
        title = t('确认安装')
        label = t('安装')
        body = `安装「${confirm.item.name}」（${confirm.item.npm || confirm.item.spec}）。${t('安装时会自动选择兼容当前 DSH 的版本。')}`
        action = 'install'
        payload = { spec: confirm.item.spec }
      } else if (confirm.type === 'restoreBackup') {
        const backup = confirm.backup
        title = '确认恢复备份'
        label = '恢复'
        body = `将把「${backup.name}」恢复到 v${backup.version}（${fmtTime(backup.createdAt)} 的备份）。恢复会安装备份对应版本，并用备份文件覆盖当前插件目录；期间该插件会短暂不可用。`
        action = 'restoreBackup'
        payload = { id: backup.id }
      } else if (confirm.type === 'deleteBackup') {
        const backup = confirm.backup
        title = '确认删除备份'
        label = '删除'
        body = `将永久删除「${backup.name}」v${backup.version} 的备份（${fmtBytes(backup.bytes)}），此操作不可撤销。`
        action = 'deleteBackup'
        payload = { id: backup.id }
      }
      return h(Modal, {
        title,
        onClose: busy ? () => {} : onClose,
        footer: h(ConfirmBar, { busy, label, onCancel: onClose, onConfirm: () => onRun(action, payload, label) }),
        children: h('div', null, h('p', { className: 'psv-modal-text' }, body), h('p', { className: 'psv-note' }, '操作由插件管理器执行，结果将在此处显示。')),
      })
    }

    const CSS = `
.psv-root { height: 100%; min-height: 480px; overflow: auto; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; }
.psv-crash { border-color: var(--dsw-alias-state-error-primary); }
.psv-crash pre { max-height: 320px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-size: 11px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); padding: 10px; border-radius: 8px; }
.psv-inner { max-width: 1180px; margin: 0 auto; padding: 26px 30px 64px; display: flex; flex-direction: column; gap: 18px; }
.psv-top { display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
.psv-brand { display: flex; align-items: center; gap: 12px; }
.psv-logo { width: 42px; height: 42px; border-radius: 13px; display: grid; place-items: center; color: #fff; background: linear-gradient(145deg, #3f7dfb, #1fb6a6); box-shadow: 0 6px 20px rgba(48, 124, 255, .22); }
.psv-brand h1 { margin: 0; font-size: 20px; letter-spacing: .2px; }
.psv-brand p { margin: 3px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.psv-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.psv-live { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.psv-live i { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-brand-primary); animation: psv-pulse 1.4s ease-in-out infinite; }
.psv-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--dsw-alias-border-l1); padding-bottom: 8px; flex-wrap: wrap; }
.psv-tab { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); display: inline-flex; align-items: center; gap: 7px; padding: 8px 12px; border-radius: 9px; cursor: pointer; font: inherit; }
.psv-tab:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); color: var(--dsw-alias-label-primary); }
.psv-tab.on { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); color: var(--dsw-alias-brand-primary); font-weight: 600; }
.psv-tab em { font-style: normal; font-size: 10px; min-width: 18px; padding: 0 5px; border-radius: 9px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); text-align: center; }
.psv-tab.on em { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent); }
.psv-stack { display: flex; flex-direction: column; gap: 16px; }
.psv-hero { display: flex; align-items: center; gap: 22px; padding: 20px 22px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px; background: linear-gradient(135deg, color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, var(--dsw-alias-bg-layer-1)), var(--dsw-alias-bg-layer-1) 62%); flex-wrap: wrap; }
.psv-ring { width: 92px; height: 92px; border-radius: 50%; display: grid; place-items: center; flex: 0 0 auto; }
.psv-ring-in { width: 74px; height: 74px; border-radius: 50%; background: var(--dsw-alias-bg-layer-1); display: flex; flex-direction: column; align-items: center; justify-content: center; }
.psv-ring-in b { font-size: 20px; line-height: 1.1; }
.psv-ring-in span { font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.psv-hero-copy { flex: 1 1 320px; min-width: 240px; }
.psv-hero-copy h2 { margin: 0 0 5px; font-size: 17px; }
.psv-hero-copy p { margin: 0 0 10px; color: var(--dsw-alias-label-secondary); }
.psv-hero-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.psv-chips { display: flex; gap: 7px; flex-wrap: wrap; align-items: center; }
.psv-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 20px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); color: var(--dsw-alias-label-secondary); font-size: 11px; }
.psv-status-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex: 0 0 auto; }
.psv-status-dot.psv-ok { background: var(--dsw-alias-state-success-primary); }
.psv-status-dot.psv-warn { background: #d99a1f; }
.psv-status-dot.psv-error { background: var(--dsw-alias-state-error-primary); }
.psv-status-dot.psv-idle { background: var(--dsw-alias-state-idle-primary); }
.psv-grid4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.psv-grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.psv-tile { text-align: left; display: flex; align-items: center; gap: 12px; padding: 14px; border-radius: 14px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; cursor: pointer; transition: transform .14s ease, border-color .14s ease; }
.psv-tile:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, var(--dsw-alias-border-l1)); }
.psv-tile-icon { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; flex: 0 0 auto; }
.psv-tone-brand { color: var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); }
.psv-tone-ok { color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent); }
.psv-tone-warn { color: #d99a1f; background: rgba(217, 154, 31, .14); }
.psv-tone-error { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
.psv-tone-idle { color: var(--dsw-alias-label-tertiary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); }
.psv-tile-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.psv-tile-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.psv-tile-num { font-size: 18px; font-weight: 700; letter-spacing: .2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.psv-tile-note { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.psv-tile-arrow { color: var(--dsw-alias-label-tertiary); }
.psv-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); padding: 16px; }
.psv-card-h { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.psv-card-h b { font-size: 14px; }
.psv-card-h span { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.psv-two { display: grid; grid-template-columns: 1.15fr .85fr; gap: 14px; }
.psv-suggest { display: flex; flex-direction: column; gap: 2px; }
.psv-suggest-row { display: flex; align-items: center; gap: 10px; padding: 10px 8px; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; border-radius: 9px; cursor: pointer; }
.psv-suggest-row:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent); }
.psv-suggest-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: currentColor; }
.psv-suggest-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.psv-suggest-text b { font-size: 12.5px; }
.psv-suggest-text span { font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.psv-changes { display: flex; flex-direction: column; gap: 8px; }
.psv-change-row { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; }
.psv-change-row span { color: var(--dsw-alias-label-secondary); word-break: break-all; }
.psv-note { margin: 8px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 1.6; }
.psv-table { display: flex; flex-direction: column; }
.psv-thead, .psv-tr { display: grid; grid-template-columns: minmax(180px, 1.6fr) 90px 80px 90px 22px; gap: 10px; align-items: center; }
.psv-table-wide .psv-thead, .psv-table-wide .psv-tr { grid-template-columns: minmax(150px, 1.6fr) 60px 90px 90px 80px 80px; }
.psv-thead { padding: 6px 8px; font-size: 10.5px; color: var(--dsw-alias-label-tertiary); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.psv-tr { border: 0; border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 55%, transparent); background: transparent; color: inherit; font: inherit; text-align: left; padding: 8px; cursor: pointer; border-radius: 7px; }
.psv-tr:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent); }
.psv-td { min-width: 0; }
.psv-td-main { display: flex; align-items: center; gap: 9px; }
.psv-tr-name { display: flex; flex-direction: column; min-width: 0; }
.psv-tr-name b { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.psv-tr-name em { font-style: normal; font-size: 10.5px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.psv-num { text-align: right; font-variant-numeric: tabular-nums; }
.psv-muted { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.psv-avatar { border-radius: 9px; display: inline-grid; place-items: center; color: #fff; font-weight: 700; flex: 0 0 auto; box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); }
.psv-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 20px; font-size: 10.5px; line-height: 1.55; white-space: nowrap; }
.psv-badge-ok { color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent); }
.psv-badge-warn { color: #d99a1f; background: rgba(217, 154, 31, .14); }
.psv-badge-error { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
.psv-badge-idle { color: var(--dsw-alias-label-tertiary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); }
.psv-badge-neutral { color: var(--dsw-alias-label-secondary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent); }
.psv-badge-brand { color: var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); }
.psv-filters { margin: 2px 0; }
.psv-filter { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); border-radius: 20px; padding: 5px 11px; font: inherit; font-size: 11.5px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.psv-filter:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
.psv-filter.on { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 13%, transparent); color: var(--dsw-alias-brand-primary); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent); }
.psv-filter em { font-style: normal; font-size: 10px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent); border-radius: 9px; padding: 0 5px; }
.psv-rows { display: flex; flex-direction: column; gap: 7px; }
.psv-row { display: flex; align-items: stretch; gap: 8px; border: 1px solid var(--dsw-alias-border-l1); border-left: 3px solid transparent; border-radius: 11px; background: var(--dsw-alias-bg-layer-1); padding: 4px 8px 4px 4px; }
.psv-row-error { border-left-color: var(--dsw-alias-state-error-primary); }
.psv-row-warn { border-left-color: #d99a1f; }
.psv-row-idle { border-left-color: var(--dsw-alias-state-idle-primary); }
.psv-row-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; padding: 6px 4px; border-radius: 8px; }
.psv-row-main:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 3.5%, transparent); }
.psv-row-title { display: flex; flex-direction: column; min-width: 0; flex: 1 1 180px; }
.psv-row-name { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.psv-row-sub { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.psv-row-col { display: flex; flex-direction: column; gap: 2px; min-width: 82px; }
.psv-row-col em { font-style: normal; font-size: 9.5px; color: var(--dsw-alias-label-tertiary); letter-spacing: .3px; text-transform: uppercase; }
.psv-row-col > span { font-size: 11.5px; }
.psv-row-actions { display: grid; align-items: center; gap: 6px; flex: 0 0 auto; }
.psv-row-actions-health { grid-template-columns: 112px 66px 56px; }
.psv-row-actions-usage { grid-template-columns: 112px 58px 58px 56px; }
.psv-row-actions > .psv-btn, .psv-row-actions > .psv-history-anchor > .psv-btn { width: 100%; justify-content: center; white-space: nowrap; }
.psv-row-actions .psv-history-anchor { width: 100%; }
.psv-action-slot { display: block; }
.psv-inline-progress { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 140px; }
.psv-inline-bar { flex: 1; height: 8px; border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); overflow: hidden; }
.psv-inline-bar i { display: block; height: 100%; border-radius: 10px; background: linear-gradient(90deg, #3f7dfb, #1f9d8f); transition: width .45s ease; }
.psv-inline-progress em { font-style: normal; font-size: 11px; font-weight: 600; color: var(--dsw-alias-brand-primary); min-width: 34px; text-align: right; font-variant-numeric: tabular-nums; }
.psv-inline-phase { font-size: 10.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
.psv-usage-bar { display: flex; flex-direction: column; gap: 4px; flex: 1 1 110px; min-width: 100px; }
.psv-usage-bar em { font-style: normal; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.psv-bar { display: block; width: 100%; background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); border-radius: 10px; overflow: hidden; }
.psv-bar-fill { display: block; height: 100%; border-radius: 10px; transition: width .3s ease; }
.psv-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); padding: 7px 11px; border-radius: 8px; font: inherit; font-size: 12px; cursor: pointer; }
.psv-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.psv-btn:disabled { opacity: .55; cursor: default; }
.psv-btn.primary { background: linear-gradient(135deg, #3f7dfb, #1f9d8f); border-color: rgba(255,255,255,.14); color: #fff; font-weight: 600; }
.psv-btn.primary:hover:not(:disabled) { filter: brightness(1.07); background: linear-gradient(135deg, #4f8cff, #23b3a3); }
.psv-btn.danger { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent); }
.psv-btn.sm { padding: 4px 8px; font-size: 11px; border-radius: 7px; }
.psv-iconbtn { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 5px; border-radius: 7px; display: grid; place-items: center; }
.psv-iconbtn:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); color: var(--dsw-alias-label-primary); }
.psv-empty { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 26px 14px; text-align: center; color: var(--dsw-alias-label-secondary); }
.psv-empty-icon { color: var(--dsw-alias-label-tertiary); margin-bottom: 2px; }
.psv-empty b { font-size: 12.5px; color: var(--dsw-alias-label-primary); }
.psv-empty p { margin: 0; font-size: 11px; max-width: 380px; }
.psv-okline { display: flex; align-items: flex-start; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.psv-okline svg { color: var(--dsw-alias-state-success-primary); flex: 0 0 auto; margin-top: 1px; }
.psv-conflicts { display: flex; flex-direction: column; gap: 8px; }
.psv-conflict { display: flex; align-items: flex-start; gap: 9px; padding: 9px; border-radius: 9px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, transparent); }
.psv-conflict-icon { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; flex: 0 0 auto; }
.psv-conflict-text { flex: 1; min-width: 0; }
.psv-conflict-text b { font-size: 12px; }
.psv-conflict-text p { margin: 2px 0 0; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.psv-conflict-kind { font-size: 9.5px; color: var(--dsw-alias-label-tertiary); border: 1px solid var(--dsw-alias-border-l1); border-radius: 5px; padding: 1px 5px; }
.psv-mini { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 13px; padding: 13px 14px; display: flex; flex-direction: column; gap: 2px; }
.psv-mini em { font-style: normal; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.psv-mini b { font-size: 20px; letter-spacing: .2px; }
.psv-mini span { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.psv-market-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.psv-search { display: flex; align-items: center; gap: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); border-radius: 8px; padding: 4px 8px; color: var(--dsw-alias-label-tertiary); }
.psv-input { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 6px 8px; font: inherit; font-size: 12px; min-width: 0; }
.psv-search .psv-input { border: 0; background: transparent; outline: none; padding: 2px; width: 160px; }
.psv-market-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.psv-mcard { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 13px; padding: 13px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.psv-mcard-top { display: flex; align-items: flex-start; gap: 8px; }
.psv-mrank { font-size: 10px; font-weight: 700; color: var(--dsw-alias-label-tertiary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent); border-radius: 5px; padding: 2px 5px; margin-top: 2px; }
.psv-mtitle { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.psv-mtitle b { font-size: 12.5px; overflow-wrap: anywhere; }
.psv-mtitle em { font-style: normal; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.psv-mdesc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; min-height: 54px; }
.psv-mstats { display: flex; flex-wrap: wrap; gap: 8px; font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.psv-mstats b { color: var(--dsw-alias-label-primary); font-size: 11.5px; }
.psv-mfoot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 6px; border-top: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 60%, transparent); }
.psv-mfoot-actions { display: flex; align-items: center; gap: 8px; }
.psv-link { color: var(--dsw-alias-brand-primary); text-decoration: none; font-size: 11px; }
.psv-link:hover { text-decoration: underline; }
.psv-installed { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-state-success-primary); font-size: 11px; }
.psv-rates { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.psv-rates label { display: flex; flex-direction: column; gap: 4px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.psv-ranklist { display: flex; flex-direction: column; gap: 6px; }
.psv-rank { display: flex; align-items: center; gap: 9px; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; padding: 5px; border-radius: 8px; cursor: pointer; width: 100%; }
.psv-rank:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent); }
.psv-rank-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.psv-rank-main b { font-size: 12px; }
.psv-rank-main span { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.psv-rank-num { font-size: 12px; font-variant-numeric: tabular-nums; }
.psv-value-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.psv-value { display: flex; align-items: center; gap: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: inherit; font: inherit; border-radius: 9px; padding: 8px; text-align: left; cursor: pointer; min-width: 0; }
.psv-value span { display: flex; flex-direction: column; min-width: 0; }
.psv-value b { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.psv-value em { font-style: normal; font-size: 10.5px; color: var(--dsw-alias-state-success-primary); }
.psv-spark { display: inline-flex; align-items: flex-end; gap: 2px; height: 26px; }
.psv-spark i { flex: 1; min-width: 3px; background: var(--dsw-alias-brand-primary); border-radius: 2px; }
.psv-spark-wrap { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.psv-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(560px, 94vw); background: var(--dsw-alias-bg-layer-1); border-left: 1px solid var(--dsw-alias-border-l1); z-index: 60; display: flex; flex-direction: column; box-shadow: -24px 0 60px rgba(0,0,0,.25); animation: psv-slide .22s ease; }
.psv-drawer-h { display: flex; align-items: center; gap: 11px; padding: 16px 18px 10px; }
.psv-drawer-title { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.psv-drawer-title b { font-size: 16px; }
.psv-drawer-title span { font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.psv-drawer-badges { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 18px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.psv-drawer-progress { padding: 8px 18px 4px; }
.psv-compat-row { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 12px; position: relative; }
.psv-compat-item { display: flex; flex-direction: column; gap: 2px; }
.psv-history { position: relative; }
.psv-history-anchor { position: relative; display: inline-flex; }
.psv-history-menu-row { top: calc(100% + 4px); right: 0; }
.psv-history-empty { padding: 8px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.psv-history-btn { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 4px 8px; font: inherit; font-size: 11px; cursor: pointer; }
.psv-history-btn:hover { border-color: var(--dsw-alias-border-l2); }
.psv-history-btn em { font-style: normal; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.psv-caret { font-size: 9px; color: var(--dsw-alias-label-tertiary); }
.psv-history-menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 5; width: 300px; max-height: 240px; overflow: auto; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; box-shadow: 0 16px 40px rgba(0,0,0,.35); padding: 5px; }
.psv-history-actions { display: flex; gap: 4px; flex-shrink: 0; }
.psv-history-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px; border-radius: 7px; }
.psv-history-item:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent); }
.psv-history-meta { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.psv-history-meta b { font-size: 11.5px; }
.psv-history-meta span { font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.psv-drawer-b { overflow: auto; padding: 6px 18px 20px; flex: 1; }
.psv-d-section { padding: 12px 0; border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 60%, transparent); }
.psv-d-section:last-child { border-bottom: 0; }
.psv-d-section h4 { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: var(--dsw-alias-label-tertiary); }
.psv-kv { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 5px 10px; font-size: 12px; }
.psv-kv > span { color: var(--dsw-alias-label-secondary); }
.psv-kv > b { font-weight: 500; overflow-wrap: anywhere; }
.psv-break { overflow-wrap: anywhere; font-size: 11px; }
.psv-issues { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
.psv-issue { display: flex; align-items: flex-start; gap: 6px; font-size: 11.5px; padding: 5px 7px; border-radius: 7px; }
.psv-issue.psv-error { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent); }
.psv-issue.psv-warn { color: #d99a1f; background: rgba(217, 154, 31, .1); }
.psv-issue.psv-info { color: var(--dsw-alias-label-secondary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent); }
.psv-tool-list { display: flex; flex-direction: column; gap: 4px; }
.psv-tool { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; padding: 4px 6px; border-radius: 6px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, transparent); }
.psv-tool-name { display: flex; align-items: center; gap: 5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.psv-tool-meta { color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.psv-rows-list { display: flex; flex-direction: column; gap: 4px; }
.psv-rowline { display: flex; align-items: center; gap: 7px; font-size: 11.5px; padding: 3px 0; }
.psv-rowline em { margin-left: auto; font-style: normal; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.psv-drawer-f { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 18px; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.psv-mask { position: fixed; inset: 0; background: rgba(5, 10, 18, .55); backdrop-filter: blur(2px); z-index: 55; display: flex; align-items: center; justify-content: center; padding: 20px; }
.psv-modal-mask { z-index: 75; }
.psv-modal { width: min(460px, 94vw); background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; box-shadow: 0 24px 70px rgba(0,0,0,.4); overflow: hidden; }
.psv-modal-wide { width: min(760px, 96vw); }
.psv-modal-h { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.psv-modal-b { padding: 16px; }
.psv-modal-f { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--dsw-alias-border-l1); }
.psv-modal-text { margin: 0 0 8px; font-size: 12.5px; line-height: 1.7; }
.psv-confirm { display: flex; gap: 8px; }
.psv-progress { position: fixed; right: 24px; bottom: 24px; z-index: 70; width: min(340px, 92vw); background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 12px 14px; box-shadow: 0 16px 40px rgba(0,0,0,.35); }
.psv-progress-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.psv-progress-head b { font-size: 12.5px; }
.psv-progress-head em { font-style: normal; font-size: 12px; font-weight: 600; color: var(--dsw-alias-brand-primary); }
.psv-progress-bar { height: 6px; border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); margin: 9px 0 7px; overflow: hidden; }
.psv-progress-bar i { display: block; height: 100%; border-radius: 10px; background: linear-gradient(90deg, #3f7dfb, #1f9d8f); transition: width .45s ease; }
.psv-progress p { margin: 0; font-size: 10.5px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.psv-toast { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 80; display: flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 10px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); box-shadow: 0 16px 40px rgba(0,0,0,.3); font-size: 12px; max-width: min(640px, 92vw); }
.psv-toast-ok { color: var(--dsw-alias-state-success-primary); }
.psv-toast-error { color: var(--dsw-alias-state-error-primary); }
.psv-toast span { color: var(--dsw-alias-label-primary); }
.psv-loading { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 180px; color: var(--dsw-alias-label-secondary); }
.psv-spinner { width: 17px; height: 17px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--dsw-alias-label-primary) 15%, transparent); border-top-color: var(--dsw-alias-brand-primary); animation: psv-spin .8s linear infinite; }
.psv-inline-error { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); border-radius: 9px; padding: 9px 11px; }
.psv-error-card { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.psv-foot { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; color: var(--dsw-alias-label-tertiary); font-size: 10.5px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 12px; margin-top: 4px; }
.psv-bad { color: var(--dsw-alias-state-error-primary); }
.psv-ok { color: var(--dsw-alias-state-success-primary); }
.psv-update { color: #d99a1f; }
.psv-blocked { color: var(--dsw-alias-label-tertiary); font-size: 10.5px; }
@keyframes psv-spin { to { transform: rotate(360deg) } }
@keyframes psv-slide { from { transform: translateX(18px); opacity: .6 } to { transform: none; opacity: 1 } }
@keyframes psv-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
@media (max-width: 980px) {
  .psv-grid4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .psv-market-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .psv-two { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .psv-inner { padding: 18px 14px 50px; }
  .psv-grid4, .psv-grid3, .psv-market-grid, .psv-value-grid { grid-template-columns: 1fr; }
  .psv-row { flex-wrap: wrap; }
  .psv-row-actions { width: 100%; justify-content: flex-start; padding-left: 44px; }
  .psv-thead { display: none; }
  .psv-tr, .psv-table-wide .psv-thead, .psv-table-wide .psv-tr { grid-template-columns: 1fr 70px 70px; }
  .psv-td:nth-child(4), .psv-td:nth-child(5) { display: none; }
}
`

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        try { ctx.locale.register(NS, 'zh-CN', {}) } catch { /* already registered */ }
        // 这个插件的界面以中文为主：不跟随 DSH 的英文语言包翻译，避免中文键被英文词典替换。
        tr = (key) => key

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'plugin-supervisor',
          order: 40,
          label: () => t('插件监管中心'),
        }, PanelGlyph))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'plugin-supervisor',
        }, () => h(Boundary, null, h(Page, { ctx }))))
      },
    }
  },
})
