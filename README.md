# DSH Plugin Supervisor · 插件监管中心

DeepSeek Harness 的插件监管面板：把插件的**健康度、兼容性、使用频率、Token 成本**集中到一个侧栏页面里，并支持在页面内直接**更新、禁用、卸载、回滚**。

A sidebar panel for DeepSeek Harness that keeps every plugin's health, compatibility, usage frequency and token cost in one place — with in-page update, disable, uninstall and version rollback.

## 功能 / Features

| 能力 | 说明 |
| --- | --- |
| 插件健康度 | 一次总览所有已装插件的加载状态与异常 |
| DSH 兼容性 | 对照当前 DSH 版本，标出可能不兼容的插件 |
| 使用频率 | 统计各插件被调用的次数，找出真正在用的那几个 |
| 逐插件 Token 成本 | 按插件拆分 token 消耗，知道钱花在哪 |
| 市场精选 / 下载榜 | 直接在面板里看插件市场热门项 |
| 页内操作 | 更新、禁用、卸载不必再跳去插件市场 |
| 版本备份与回滚 | 更新前自动备份旧版本，随时恢复；本地「历史版本」可查看、恢复、删除 |
| 中英双语 | 跟随 DSH 语言设置 |

## 安装 / Install

发布到插件市场后可直接在市场内搜索「插件监管中心」安装。

本地源码安装：

```bash
git clone https://github.com/2033453490/dsh-plugin-supervisor.git
dsh plugin --profile desktop add ./dsh-plugin-supervisor
```

安装后在侧栏出现盾牌图标入口，Host 端 HTTP 前缀为 `/__plugin-supervisor/api/`。

> 修改 `index.js`（Host 端）后需要禁用再启用本插件才会加载新模块；`client.js`（前端）改动通过 Web 端热更新生效。

## 开发 / Development

```
index.js           Host 端：数据采集、HTTP 路由、插件操作
client.js          前端：侧栏面板 UI
cordis.patch.yml   DSH 插件补丁声明
locale/*.json      中英文文案
icon.svg           侧栏图标
```

无构建步骤，纯 ESM。

## 许可 / License

暂未声明，使用前请先联系作者。
