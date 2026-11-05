# DSH Plugin Supervisor · 插件监管中心

作者：**CYKshaozi**

DeepSeek Harness 的插件监管侧栏面板：把已安装插件的健康状态、DSH 兼容性、更新、使用频率、版本备份和 Token 成本集中在一个页面里，并支持在页面内更新、禁用、卸载与回滚。

A sidebar supervisor for DeepSeek Harness plugins: health, DSH compatibility, updates, usage frequency, version backups and per-plugin token cost in one panel, with in-page update, disable, uninstall and rollback.

## 功能 / Features

| 能力 | 说明 |
| --- | --- |
| 健康状态 | 汇总插件行是否激活、是否禁用、是否激活失败 |
| DSH 兼容性 | 根据包声明的 `engines.dsh` / `peerDependencies` 与当前 DSH 版本判断兼容性；未声明时标记为未知 |
| 更新建议 | 对比 npm 最新版与兼容版，避免把不支持当前 DSH 的版本装进来 |
| 使用频率 | 从本机会话日志统计工具调用次数、会话数和最后使用时间；无工具的界面型插件标记为“不可观测” |
| Token 成本 | 按工具结果内容与工具 Schema 常驻开销估算逐插件 Token；可填费率折算金额 |
| 插件市场 | 读取 awesome-dsh-plugin 公共索引，展示周下载榜、新锐插件与新收录，并支持页内安装 |
| 版本备份 | 更新前自动备份旧包；每个插件行与详情页都能查看、恢复、删除历史版本 |
| 页内操作 | 更新、禁用、卸载、恢复都不需要跳转插件市场 |
| 冲突提示 | 检测重复工具名、激活失败、版本不兼容和同分类功能重叠 |

## 安装 / Install

从 npm 安装（发布后）：

```bash
dsh plugin --profile desktop add dsh-plugin-supervisor
```

从 GitHub 安装：

```bash
dsh plugin --profile desktop add github:2033453490/dsh-plugin-supervisor
```

本地源码：

```bash
git clone https://github.com/2033453490/dsh-plugin-supervisor.git
dsh plugin --profile desktop add ./dsh-plugin-supervisor
```

安装后左侧栏会出现盾牌图标。Host 端 HTTP 前缀为 `/__plugin-supervisor/api/`。

> 修改 `index.js`（Host 端）后，需要在插件管理器里禁用再启用本插件才会加载新模块；`client.js` 改动刷新页面即可。

## 数据与隐私 / Data & privacy

- 只读取本机数据：插件清单、`node_modules` 中的包声明、`~/.dsh` 下的会话日志。
- 只写入本机：设置与版本备份位于 `~/.dsh/plugin-supervisor/`。
- 网络请求仅用于查询 npm registry 与 `https://awesome-dsh-plugin.com/plugins.json`，不会上传插件清单、会话内容或使用数据。
- 更新、卸载、恢复等操作由本机 DSH 插件管理器执行，执行前会在页面内确认。

## 环境 / Requirements

- DeepSeek Harness Desktop，带 Web UI
- 在 `0.2.1-rc.5` 上完成开发与实测
- Node.js >= 20（Host 端）

## 开发 / Development

```text
index.js           Host 端：数据采集、HTTP 路由、插件操作
client.js          前端：侧栏面板 UI
cordis.patch.yml   DSH 插件补丁声明
locale/*.json      插件管理器显示用的中英文元数据
icon.svg           侧栏与插件管理器图标
```

无构建步骤，纯 ESM。

## 插件市场 / Marketplace

收录条目模板见 `market/2033453490__dsh-plugin-supervisor.yml`。提交到
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
的 `data/plugins/` 目录后，市场会从索引中读取最新条目。

## 许可 / License

MIT © 2026 CYKshaozi
