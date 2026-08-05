# MoeReview

<p align="center">
  <strong>面向论文发现、中文阅读和深度学习的本地优先工作台。</strong><br />
  先找到值得读的论文，再用大白话读懂，最后按需进入解析、问答和做题。
</p>

<p align="center"><a href="./README.en.md">English</a> · 简体中文</p>

<p align="center">
  <img alt="Node.js >= 18" src="https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=111" />
  <img alt="Electron" src="https://img.shields.io/badge/electron-windows-47848F?logo=electron&logoColor=white" />
  <img alt="Local first" src="https://img.shields.io/badge/storage-local--first-blue" />
  <img alt="License: GPL v3" src="https://img.shields.io/badge/license-GPLv3-blue" />
</p>

MoeReview 是一个运行在本机上的论文发现与阅读平台。它把“刷到论文、看懂论文、深入学习”组织成一条连续流程：发现页负责推荐，详情页负责沉浸式阅读，学习页负责解析和练习。

<p align="center">
  <video controls preload="metadata" width="720" src="https://github.com/sunziqin/MoeReview-PaperHub/releases/latest/download/moereview-product-intro.mp4">
    <a href="https://github.com/sunziqin/MoeReview-PaperHub/releases/latest/download/moereview-product-intro.mp4">观看项目介绍视频（MP4）</a>
  </video>
</p>

<p align="center">
  <a href="https://github.com/sunziqin/MoeReview-PaperHub/releases/latest/download/moereview-product-intro.mp4">下载项目介绍视频</a> ·
  <a href="https://github.com/sunziqin/MoeReview-PaperHub/releases/latest">查看最新 Release</a>
</p>

## 功能

- 个性化论文发现流：支持兴趣频道、最新论文、LLM、计算机视觉、强化学习和本地行为排序。
- 中文/英文关键词搜索：支持作者、来源、领域和中文语音输入。
- 一键大白话摘要：先说论文要解决什么、怎么做、结果意味着什么，并保留 `中文术语（English keyword）`。
- 原文、中文、双语阅读：翻译和摘要按需生成，并按论文、模型和提示词指纹永久缓存，避免重复消耗 Token。
- PDF 保真入口：原始 PDF 负责图、表、柱状图、折线图、公式和页面布局；提取文本负责章节阅读、翻译和来源锚定。
- 论文资料库：收藏、稍后阅读、浏览历史、阅读进度和学习记录分开管理。
- 学习模式：从论文详情进入解析、章节讲解、选中文本问答、术语表、知识卡片和做题。
- 统一设置中心：AI 服务、论文来源、阅读翻译、推荐、主题、导航和本地数据集中配置。
- 高并发翻译：低、中、高、最高四档；可配置范围、并发数和翻译提示词。最高档自动处理本机已发现的论文，不扫描全网。
- MCP 兼容：MCP 是可选适配入口；Web UI 和学习模块默认直接调用 Hub 的 API，不依赖 MCP 才能工作。
- Windows 桌面版：提供 NSIS 安装包和 portable 便携版。

## 运行方式

### Windows 桌面版

从 GitHub Releases 下载：

- `MoeReview-<version>-x64.exe`：安装版。
- `MoeReview-<version>-portable.exe`：便携版。

启动后，MoeReview 会在本机启动 Hub 并打开桌面窗口。首次使用请进入“设置”，配置 OpenAI-compatible API 的 Base URL、模型和 API Key。

### 源码运行

要求 Node.js 18 或更高版本。Windows PowerShell 使用 `npm.cmd`，可以执行：

```powershell
npm.cmd run setup
npm.cmd run build
npm.cmd start
```

浏览器打开 `http://127.0.0.1:3456/discover`。也可以直接运行：

```powershell
.\start.cmd
```

源码启动需要先构建 Web 和 Hub。`scripts/start.ps1 -NoOpen` 可只启动 Hub，不自动打开浏览器。

## 构建 Windows 安装包

在 Windows 上执行：

```powershell
npm.cmd run setup
npm.cmd run build:desktop
```

产物会写入 `release/`，包括安装版和 portable 版。发布前运行：

```powershell
npm.cmd run release:check
```

桌面壳只是启动器，业务仍由同一套 Hub 和 Web 构建产物提供。打包不会把 `~/.examforge`、API Key、论文 PDF 或本地缓存带进安装包。

## 架构

```text
Electron / Browser
        |
        | HTTP + WebSocket (loopback only)
        v
MoeReview Hub ---- provider APIs (arXiv / Semantic Scholar / configured AI API)
        |
        +-- local paper cache, summaries, translations, library, sessions
        |
        +-- optional MCP stdio adapter
```

- **Web UI**：路由、发现流、阅读器、学习界面和用户输入。
- **Hub**：本地 HTTP/WebSocket、论文 provider、AI 调用、缓存、会话、数据持久化和密钥。
- **Electron**：Windows 桌面窗口、Hub 生命周期、外链和单实例控制。
- **MCP Adapter**：只做 MCP stdio 兼容转发，不拥有论文数据或独立渲染链路。

## 本地数据与隐私

运行数据默认保存在：

```text
~/.examforge/
├─ config.json                 # 非秘密应用设置
├─ secrets.json                # API Key，仅由 Hub 读取
├─ papers/
│  ├─ feed-cache.json          # 论文元数据
│  ├─ library.json             # 收藏、稍后阅读、进度
│  ├─ interactions.json        # 本地推荐行为
│  ├─ summaries.json            # 摘要缓存
│  ├─ translations.json        # 完整翻译缓存
│  ├─ translation-segment-cache.json
│  ├─ documents.json           # 提取文本
│  └─ pdf-cache/               # 本地 PDF 缓存
└─ sessions/                   # 学习会话和历史
```

默认 Hub 只监听 `127.0.0.1`，不向局域网暴露会话、配置和论文数据。推荐行为可以在设置中关闭、清除和导出。详细边界见 [SECURITY.md](./SECURITY.md)。

## 开发

```text
web/            React + Vite 前端
mcp-server/     TypeScript Hub 与 MCP Adapter
desktop/        Electron Windows 壳
docs/           当前架构、运行链路和模块契约
promo-video/    介绍视频工程源文件
scripts/        启动、检查和发布脚本
```

验证命令：

```powershell
npm.cmd --prefix mcp-server run build
npm.cmd --prefix web run build
npm.cmd --prefix web run lint
git diff --check
```

欢迎通过 [CONTRIBUTING.md](./CONTRIBUTING.md) 提交问题和改进。

## 介绍视频

项目介绍视频已放在 [GitHub Release](https://github.com/sunziqin/MoeReview-PaperHub/releases/latest) 中，可直接[在线播放](https://github.com/sunziqin/MoeReview-PaperHub/releases/latest/download/moereview-product-intro.mp4)或下载。视频不放入源码仓库，避免让 clone 和源码审查承受不必要的二进制体积。

## 许可证

MoeReview 使用 GNU General Public License v3.0，见 [LICENSE](./LICENSE)。
