# dsh-session-delete

A DeepSeek Harness (DSH) plugin that adds a **Delete conversation** row directly
below **Archive session** in every Session's `⋯` menu, and permanently removes
that Session after a confirmation dialog.

> **English summary.** DSH has no session-deletion API at all: `sessionPersistence`
> is append-only and its own contract states that logs accumulate under the
> persistence root "until an external actor removes them — the seam has no delete
> interface". This plugin is that external actor. Confirming the dialog removes
> the Session's log directory, its projection cache, and its workspace
> accounting. **It is not recoverable** — use *Archive session* to keep a
> Session. Deletion is refused (409) while a Turn is still in progress. The
> README below is in Chinese; the install steps are in
> [安装 / 卸载](#安装--卸载).

在每个会话的「⋯」菜单里，于**归档会话**下方增加一行**删除对话**，二次确认后**永久删除**该会话。

## 它到底删除什么

DSH 本身没有删除会话的接口。`sessionPersistence` 是只追加的，它自己的文档明确写着会话日志会一直堆积在持久化根目录下、直到外部把它们移除（"the seam has no delete interface"）。所以本插件的 Host 半边就是那个"外部"。

一次删除会移除三处东西：

| 目标 | 路径 | 说明 |
|---|---|---|
| 会话日志目录 | `~/.dsh/sessions/<项目目录>/<会话 id>/` | 整个目录，里面只有该会话自己的产物 |
| 投影缓存 | `~/.dsh/storages/session_projcache/sessions/<会话 id>.json` | 侧栏/对话用的派生缓存 |
| 工作区归属 | `~/.dsh/storages/workspace.json` 中该会话的记账 | 通过 workspace registry 自己的写入路径释放 |

**这是不可恢复的**——文件是直接删掉的，没有回收站。需要保留会话时请用「归档会话」。

## 安全约束

- **正在进行的回合会被拒绝**（409，`session/busy`），提示先停止再删除。判定依据是会话事件尾是否停在未闭合的 `turn/start`。
- 会话 id 来自页面，按不可信输入处理：形状白名单校验通过后才会参与路径构造，`../`、分隔符、超长 id 一律 400 拒绝。
- 路径推导**只用来构造要查找的名字**：`locateSessionDir` 先确认目录确实存在，才会有人删它。所以即使 DSH 将来改了目录命名规则，结果也只是"找不到"，而不是删错东西。
- 删除顺序是有意的：**先删文件，最后才释放工作区归属**，因为后者才是客户端观察到的那次写入。

### 为什么不按"会话是否活跃"拒绝

第一版按"该会话有活着的 Agent"拒绝，结果**几乎每个能点的会话都被拒**——DSH 会把浏览器加载过的每个会话都常驻：都有 Agent，日志文件的写句柄也一直开着。于是按钮和确认框都正常，点下去却永远返回"still active"。

而且这个前提下"文件被占用"本身也不成立：Node 在 Windows 上用 `FILE_SHARE_DELETE` 打开文件，所以**带打开句柄的文件照样能删掉**（本机实测：用独占方式打开一个已加载会话的日志会被拒绝，但 `rm` 成功）。所以"有活句柄"从来不是拒绝的理由。

保留的这种"回合进行中"检查才是有意义的：它挡住的不是"文件被占用"，而是"日志正被一个还在追加写入的回合使用"。

### 已知代价

删除一个 DSH 仍加载着的会话后，若该会话之后真被写入（例如你正在看的那条对话又发了一轮），那次写入会失败。这正是"永久删除当前正在使用的对话"的固有代价，本插件不试图规避它。

## 结构

```
index.js          Host 半边：POST /api/session.delete 的注册与删除实现
paths.js          路径推导（encodeSegment / projectKey / locateSessionDir）
client.js         Client 半边：菜单行 + shell.overlay 确认对话框
cordis.patch.yml  Loader 补丁：插入一行 session-delete
locale/{zh,en}.json  插件管理页的标题与描述
icon.svg          插件图标
check-paths.mjs   路径推导对照真实 ~/.dsh/sessions 的校验
check-route.mjs   Host 路由的端到端校验（桩 ctx + 临时 DSH_HOME）
```

### 为什么 Client 半边自己写控件

Harness 的客户端插件规范明确要求第三方插件**不要** `require('@deepseek-ai/dsh-client-ui-primitives')` 或任何 Harness Client 包：它们的接口会变、纯 JS 插件没有类型检查，而且组件抛错会直接让整个插槽条目空白（控制台提示 `slot entry crashed in '<slot>'`）。所以这里的菜单行与对话框是按内置控件的样子重写的——类名带本插件前缀，样式只引用 `--dsw-*` 主题 token，React 由平台模块表提供。

客户端与 Host 之间走 `ctx.connection` 注册的**受认证精确 Fetch 路由**，与内置的 `/api/session.export` 完全同一种机制；`host.call` 只属于动态 Cordis 插件，静态 bundle 拿不到。

### 删除后界面如何更新

两处已有机制，都不需要插件自己搓刷新：

1. 侧栏的会话行来自每个工作区的有序 `sessionIds`，所以行消失是因为 Host 释放了工作区归属——这个变更走工作区自己的 `follow` 流（workspace controller 本来就在跑）。
2. `sessions` 列表是另一份投影，不会自己重拉，所以 Client 半边显式调用 `ctx.sessions.refresh()`。

## 校验

```powershell
cd dsh-session-delete
node check-paths.mjs       # 对照真实会话树校验两个编码器与目录定位
node check-route.mjs       # 桩 ctx 下跑完路由的状态码/响应体/实际删除
node check-regression.mjs  # 复现第一版那个把功能堵死的 bug
node audit-cleanup.mjs <sessionId>   # 删除后只读核查：三个存储是否真的清干净
```

`check-paths.mjs` 的只读部分会读真实的 `~/.dsh/sessions`；所有写操作都发生在 `mkdtemp` 出来的临时目录里，并在结束时删除。

`audit-cleanup.mjs` 只读，不改任何东西。它把插件负责的三个存储当成一个关系来比对，并双向报告不一致：有缓存却无会话目录、有会话目录却无缓存、账本里还留着该会话、任何状态文件里还能搜到该 id。其他会话的账本差异会被标成"观察项"而不是失败，避免把与本次删除无关的既有情况算到它头上。

## 已知的存储盲区

**附件不会被删除。** 会话日志里的图片以内容寻址方式存在 `~/.dsh/attachments/`，同一个对象可能被多条会话引用，按会话删会误删别的会话的图。所以本插件不动它——这也意味着删掉一条带图的会话不会回收那部分磁盘。

## 安装 / 卸载

这是一个 DSH **bundle**：`package.json` 声明 `dsh.bundle.patch`，`cordis.patch.yml` 插入一行插件。用官方的插件管理器安装，**不要**手写 profile 的 `package.json` / `cordis.patch.yml`，也不要自己在该目录跑 pnpm——`install_bundle` 会做这些事。

**取一份代码**（二选一）：

```powershell
# 用 Releases 里的源码包（推荐：对应已发布版本）
#   在 Releases 页下载 Source code (zip) 后解压，例如到 ~/src/dsh-session-delete

# 或者直接 clone
git clone https://github.com/Be201/dsh-session-delete.git ~/src/dsh-session-delete
```

**安装：**

1. 让 agent 调用 `plugin_manager`：`action: install_bundle`，`target` 为上面的**绝对路径**。
2. 或用 CLI：`dsh plugin --profile <profile> install <绝对路径>`。

安装会把它作为 bundle 选入 profile，并在 `<profile>/node_modules/@local/` 下建立指向该目录的 junction。

> **从 zip 解压的注意**：解压后目录名可能变成 `dsh-session-delete-1.0.0`，这没关系——`install_bundle` 认的是目录里的 `package.json`，不认目录名。

- **停用（保留文件）**：`plugin_manager` 的 `set_plugin`，target `session-delete`，`enabled: false`。
- **卸载**：`plugin_manager` 的 `remove_bundle`，target `@local/dsh-session-delete`。
- **改动代码后**：该目录被 junction 引用，Host 侧 `index.js` 的改动需要**重启 DSH** 才生效（`hmr.root` 默认不监听 profile 之外的路径）；Client 侧 `client.js` 需要**刷新页面**。

> **删除该目录前请先卸载**——否则会留下一个指向不存在路径的 junction 与一条失效的 bundle 依赖。

### 已验证的环境

Node.js 22+（`check-*.mjs` 用到 `node --check`、`node:test` 之外的标准库，以及 `node:zlib` 的 zstd）。已在 Windows + DSH `0.2.0-rc.2`（`desktop` profile）上实测可用。

## 安全性

- **不是任意文件删除。** 会话 id 来自页面，先过形状白名单（`[A-Za-z0-9][A-Za-z0-9._:-]{0,199}`），再由 `encodeSegment` 单射编码成**单个路径段**，`../`、分隔符、NUL、超长输入都会被编码掉或被拒绝。
- **只删已存在的目录。** `locateSessionDir` 先 `stat` 确认候选目录真实存在，`rm` 才被调用；DSH 若改目录命名规则，结果只是"找不到"，而不是删错东西。
- **路由受认证。** `/api/session.delete` 注册在 `ctx.connection` 的共享 Fetch 载体上，走 DSH 自己的 Host/Origin 校验与浏览器认证；未带 token 的请求返回 401，且有 CSRF 意义的跨站请求取不到凭据。
- **失败不谎报成功。** 删除成功后的列表刷新是尽力而为的，不会把一个已经完成的删除显示成失败。
- **已知边界（不是任意文件删除，但仍值得知道）：**
  - 无效的 `DSH_HOME` 会把删除重定向到另一个目录树；仍然要求目标处有匹配的会话目录，但插件信任这个环境变量。
  - 插件以 Host 进程权限运行（与任何 DSH 插件一样），因此能删除本用户能删的任何东西——这是 DSH 插件的固有模型，不是本插件引入的。
  - 删除一个 DSH 仍加载着的会话后，若它之后真被写入，那次写入会失败。
