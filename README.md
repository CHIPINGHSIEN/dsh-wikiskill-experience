# dsh-wikiskill-experience

跨会话、跨项目的**经验编译器**：把 agent 踩过的坑与验证过的打法，编译成一份不可篡改的持久 wiki，并在之后的会话里以一段短描述性索引的形式注入；在此之上再叠一个**证据闸门控制、永不自动发布**的程序性回路（提案 → 用户批准 → 可回滚的 `SKILL.md`）。

设计来源：[WikiSkill: Compiling Agent Experience into Persistent Knowledge for Skill Evolution](https://arxiv.org/abs/2608.27454v1)（arXiv:2608.27454v1）+ 本仓库的**双回路**改造。Host-only Cordis bundle，无运行时依赖、无网络访问、插件内部不调用 LLM。

> **English summary.** A Host-only Cordis bundle for DeepSeek Harness that compiles agent experience into a persistent wiki, injects a short descriptive index into later sessions, and adds a gated procedural loop (P2 proposals, P3 user-approved `SKILL.md` publication) that can never self-publish and can be rolled back independently of the wiki. Four tools: `wikiskill_record`, `wikiskill_hint`, `wikiskill_propose`, `wikiskill_release`.

---

## 1. 它解决什么问题

一次会话里学到的教训，默认活不过这次会话；写进 `AGENTS.md` 又会被下一次"优化"冲掉，且无法回滚、无法整体重来。

本插件把经验拆成两层，**两层走完全不同的演化路线**：

| | 回路 ① 描述性（P0 + P1） | 回路 ② 程序性（P2 + P3） |
|---|---|---|
| 产出 | wiki：`raw/` → `patterns/` → `index.md` | `SKILL.md`（可执行技能） |
| 默认 | 常开 | 常开，但**闸门 + 只干预演** |
| 失败代价 | 低：只是"看过什么根因"的知识 | 高：会真的改变 agent 行为 |
| 回滚 | **永不回滚**（它是审计底账） | **可以回滚**（删 `SKILL.md` 即可） |
| 谁能触发 | agent 调 `wikiskill_record` | 提案：agent；发布：**只能用户本人** |

**关键隔离**：门控结果**永不**回写 `patterns/`。wiki 和 skill 是两条独立可审计的账，互不污染。

## 2. 安装

要求：DeepSeek Harness（带 `plugin_manager`），Node.js ≥ 20。插件是 Host-only bundle，**不需要**重启进程，装完即生效。

版本窗口：`engines.node >= 20`，`engines.dsh = ">=0.2.2-rc.1 <0.3.0-0"`（本地实测运行时是 `0.2.2-rc.1`；DSH 会在**安装前**就按这个范围拦不兼容版本，不会等装完才炸）。

### 方式 A：从本地目录安装（已验证）

```
plugin_manager action=install_bundle target="<绝对路径>/wikiskill-plugin"
```

### 方式 B：从打包产物安装

```bash
cd wikiskill-plugin
npm pack --pack-destination dist      # 产出 dist/dsh-wikiskill-experience-0.1.0.tgz
```

然后把 `dist/*.tgz` 的绝对路径作为 `install_bundle` 的 `target`。

### 方式 C：从 GitHub 直装（git 渠道，已发布）

```
plugin_manager action=install_bundle target="git+https://github.com/CHIPINGHSIEN/dsh-wikiskill-experience#<commit-sha>"
```

不给 `#<commit-sha>` 就用默认分支 HEAD（不推荐：内容会随仓库变动）。固定 commit 才是可复现的安装，市场索引里的 git 条目也是这个形态。

### 方式 D：从 npm 安装（**尚未发布**）

```
plugin_manager action=install_bundle target="dsh-wikiskill-experience@0.1.0" registry="https://registry.npmjs.org/"
```

> 包还没有发到 npm（前置条件见 §11）；这条路径在发布之前装不上。

### 装完怎么确认

1. `cordis_inspect_query host / Tool / listTools` 里应出现 4 个工具：`wikiskill_record`、`wikiskill_hint`、`wikiskill_propose`、`wikiskill_release`（后两个由 `p2Enabled` / `p3Enabled` 控制）。
2. 数据根目录被创建：默认 `<DSH_HOME>/experience/wiki/`。
3. 插件管理页的 bundle 详情应显示标题 "WikiSkill experience" 与本地化描述、自有图标（`locale/en.json`、`locale/zh.json`、`icon.svg`）。

### 卸载

```
plugin_manager action=remove_bundle target="dsh-wikiskill-experience"
```

卸载只移除插件：`<DSH_HOME>/experience/wiki/` 里的数据**不会被删**（那是你的经验底账），已发布的 `SKILL.md` 也留在 skill root，需要时用 `wikiskill_release` 的 `rollback` 单独处理。

## 3. 四个工具

| 工具 | 作用 | 会写文件吗 |
|---|---|---|
| `wikiskill_record` | 记录**一条**经验（九个结构化字段）；追加 `raw/YYYY-MM-DD.jsonl` + `logs.md`，然后重编译 wiki | 会（只写自己的 root） |
| `wikiskill_hint` | 只读：返回最近轮次观测到的**候选**触发信号（工具失败 / step 报错 / 疑似用户纠正） | 不会 |
| `wikiskill_propose` | P2：`status` 报资格闸 / `draft` 产原子草案进 `p2/deferred-proposals.md` / `reset` 清队列 | `draft` 时写队列，**绝不**写 `SKILL.md` |
| `wikiskill_release` | P3：`status` / `publish`（默认 DRY-RUN，需用户 token，且只发布队列里已存在的草案）/ `rollback` / `receipts` | 仅经用户批准后写/删一个 `SKILL.md` |

### `wikiskill_record` 的九字段

`patternId`、`kind`（failure/strategy）、`title`、`errorDescription`、`rootCause`（**必须回答 WHY**）、`when`（可迁移的场景条件）、`general`（策略级回避方法）、`projectContext`（只属于本项目的上下文）、`evidence`（证据指针）；另有 `transfer`（`universal` / `conditional` / `project-only`）。

`rootCause` 讲不出 WHY、`general` 写成底层 workaround 的记录，就是坏记录——而 wiki 永不回滚，坏记录会永久留下。所以**语义判断由 agent 做，插件只做确定性编译**。

### P2 资格闸（三条阈值 + rubric 冻结）

`minCases ≥ 20` **且** 最大重复次数 `≥ 5` **且** 去重场景数 `≥ 3` **且** `rubric.md` 已冻结，四条全过才允许 `draft`。参数可用 `minCases` / `minRepeat` / `minScenes` 显式覆盖，覆盖值会在返回值里**明确报告**，不静默。

> **P2 打开 ≠ 绕过闸门**：真实库只有 4 条记录时，`status` 会返回 `eligible:false` 与 `4 < 20`，按规则"停止、不启动演化"。这是设计，不是故障。

### `USER-APPROVED` 契约

`publish` / `rollback` 只有在**用户本人**在自己的指令里给出 `approvalToken: "USER-APPROVED"` 时才真正执行；否则一律 DRY-RUN。工具描述里写死了 "agent tools cannot self-approve"——agent 自己伪造这个 token 等同于不生效。

## 4. 硬保证

- 会话日志**只读**；不新增任何 `SessionEvent` 类型。
- 确定性信号只进内存 hints，**绝不**自动写入 `raw/` 或 `index.md`。
- 可靠性契约：可选服务故障**永不**让工具调用 reject；`ok:true` 时 `raw/` 与 `logs.md` 始终一致；编译/读取失败**显式诊断**，绝不谎报"空库"、绝不把陈旧索引当当前状态；同输入编译出同字节。
- wiki **永不回滚**；门控结果**永不**改写 `patterns/`。
- 发布出去的 `SKILL.md` 落在 watched skill root，删掉即可回滚，**不牵动 wiki**。
- 插件只写自己的 `root`（及配置的 skill root）；**不**读写 profile 的 `cordis.patch.yml`。
- 所有注册都由 effect 托管，卸载即清理。

## 5. 配置

bundle 自带 `cordis.patch.yml`，默认值如下。要改就在 profile 的 `cordis.patch.yml` 里用同一 `id`（`wikiskill-experience`）覆盖——**注意：覆盖会替换整个 `config`**，请复制整块再改。

| 键 | 默认 | 说明 |
|---|---|---|
| `root` | `''` | `''` = `<DSH_HOME>/experience/wiki`；也可给绝对路径 |
| `enabled` | `true` | `false` 仅关掉注入与工具注册 |
| `injectSection` | `true` | 是否每步注入短索引 |
| `mirrorProjectLayer` | `false` | 另在 `<cwd>/.dsh/experience/raw/` 写一份镜像（尽力而为，失败不阻塞主写入） |
| `maxIndexLines` | `12` | 注入索引最大行数（1–50） |
| `topN` | `8` | 注入条目上限（1–20） |
| `p2Enabled` | `true` | 注册 `wikiskill_propose` |
| `p2MinCases` | `20` | 闸门：最少标注案例数 |
| `p2MinRepeat` | `5` | 闸门：单一模式最大重复次数 |
| `p2MinScenes` | `3` | 闸门：去重场景数 |
| `p3Enabled` | `true` | 注册 `wikiskill_release` + 命中回执 |
| `p3SkillRoot` | `''` | `''` = `<DSH_HOME>/skills`（rank 400 的 watched root，写入即热加载） |

数值型配置在激活时会被夹到合法区间（越界不报错，取边界），所以手写配置不会把插件弄崩。

## 6. 数据布局

```
<root>/                              默认 <DSH_HOME>/experience/wiki
├── raw/YYYY-MM-DD.jsonl             不可变经验记录（append-only，内容视为 untrusted data）
├── patterns/<patternId>.md          一页一模式（确定性编译产物）
├── index.md                         短目录：PROBLEM + ROOT CAUSE + FIX
├── logs.md                          append-only 演化日志
├── stats.md                         只读统计（绝不作为闸门输入）
├── manifest.json                    schemaVersion / 启用阶段
├── README.md                        说明
├── skills/                          永远为空 —— 描述性回路与程序性回路的分界线
└── p2/                              rubric.md / deferred-proposals.md / ...（仅 p2Enabled）
<DSH_HOME>/skills/wikiskill-*.md     （仅 P3 发布后）
```

`p3/` 目录（`releases.md`、`hit-receipts.md`、`README.md`）在启用 P3 时创建。

## 7. 验证状态（诚实版）

**已在真实环境验证：**

- 插件以 `dsh-wikiskill-experience@0.1.0` 在 Desktop profile 中 `link` 安装并激活（`application: applied`、`warnings: []`）；`Tool.listTools` 中四个工具**各出现恰好一次**（无新旧重复注册），profile 的 bundles 列表已无旧名。
- 端到端 P3 实机链路：资格闸在默认阈值下正确拒绝（`4 < 20; max repeat 2 < 5`）→ 显式覆盖被报告 → 无 token 时 DRY-RUN → 用户给出 `USER-APPROVED` 后写出 `SKILL.md` → `skill` 工具成功加载 → skill 目录里出现该技能 → 命中回执 `0 → 1` → wiki 未回滚。
- `node tools/verify.mjs`：默认 **50/50** 通过（注册面 / 布局 / 描述回路写入一致性 / 闸门拒绝 / dry-run 不落盘 / 输出 schema 一致性）；`node tools/verify.mjs --publish` **64/64** 通过（额外覆盖「无草案的批准发布被拒绝」→ 显式降阈值造草案 → 批准发布 → 回滚）。
- 打包物自证：`npm pack` 产出 10 个文件 / 33.3 kB；把 tgz 解到独立临时目录后 `node --check index.js` 与 `node tools/verify.mjs --publish` **64/64** 通过 —— 打出来的包自包含、可自证。
- 改名重装不影响数据：`<DSH_HOME>/experience/wiki` 的记录/patterns/p2/p3 与已发布 skill 均未被触碰。

**未验证 / 已知盲区：**

- 工具返回值最终由 Harness 的 `defineTool` 按 `output.schema` 校验（`additionalProperties:false`）。随包自检只能断言顶层 schema 一致性，**无法复现**该层；真实校验以 Harness 运行结果为准。
- `files` 白名单只对 `npm pack` 生效；**本地目录安装是 link 整目录**，不受 `files` 过滤。
- 无 Client UI、无设置面板。`settings.section` 等槽位可用，但 Client 半边的数据通道未在本安装中确证，按"无证据不猜"不实现。
- P2 闸门从未在真实数据上放行过（4 < 20），`draft` 只在测试与显式降阈值时跑通过。
- 改名重装后本次进程内无法区分「新代码代际」是否已生效（不真做一次批准发布就无法观察守卫分支）；进程重启后必然加载新代际。
- Windows 下无法用 `chmod` 造出真实的 EACCES，权限类失败路径只有代码级保证。

## 8. 已知边界与设计取舍

- **Host 插件没有 LLM**：论文里 "Wiki Maintainer" 的根因分析由 agent 调 `wikiskill_record` 时填九个字段承担；插件只做确定性编译与注入，每步 0 次模型调用。
- **触发不等于自动写经验**：确定性信号只产生候选 hints，语义判断留给 agent。否则 wiki 会被低质量记录永久污染（它永不回滚）。
- `cwd` / `sessionId` 归属是 best-effort，取不到记 `unknown`，不影响主流程。
- 每条 raw 记录带 `wikiInjected`，标记该会话是否真的看到过注入索引，供将来筛"干净 rollout"。
- 发布名规范化：`wikiskill-<patternId>`，`_`/`.` 转 `-`，以满足 skill 名 `[a-z0-9]+(-[a-z0-9]+)*` 的硬约束（不满足会被静默跳过）。

## 9. 开发

```bash
node --check index.js        # 语法
npm run verify               # 自检（临时目录，不碰真实 wiki）
npm pack --dry-run           # 查看真正会被发布的文件
```

源码刻意保持**纯 ASCII**（Windows 上的字节级编辑曾两次破坏 UTF-8）；中文只出现在 locale JSON、README 与文档里。`index.js` 不 import 任何 `@deepseek-ai/*`——本地 link 安装无法解析 profile 的 `node_modules`，所以一切通过 `ctx.*` 服务与 Node 内置模块完成；`export const inject` 必须声明每个用到的 `ctx.<service>`。

## 10. 版本与许可

- 版本策略：SemVer。当前 `0.1.x`——首个公开版本，配置键与工具名已稳定，但 P2 放行路径尚无真实数据验证，**故意不标 1.0**。
- 许可：MIT。第三方图纸/素材若引入须保留署名；本包图标为原创。
- 改了什么：见 [CHANGELOG.md](./CHANGELOG.md)。

## 11. 发布（给维护者）

### 社区现状（2026-11-09 实测）

DSH 插件有两条真实分发路径，DSH 都能装：

1. **npm 公共 registry**（`https://registry.npmjs.org/`）——主流。社区插件索引 1000 条里绝大多数是这个来源，install target 形如 `name@version` + registry。
2. **Git 直装**——少数。install target 形如 `git+https://github.com/<repo>#<commit>&path:/...`，固定 commit，不需要 npm 账号，但每发一版都要手换 commit、没有 semver 升级。

社区收录走 `awesome-dsh-plugin` 列表聚合（自动抓 GitHub 上带 `dsh-plugin` topic 的项目，再人工复核后收录），**收录不代表安全审查**。

### 两条渠道的实施状态（2026-11-09）

| 渠道 | 状态 | 落地内容 |
|---|---|---|
| **git**（GitHub 直装） | ✅ **已发布** | 公开仓库 [CHIPINGHSIEN/dsh-wikiskill-experience](https://github.com/CHIPINGHSIEN/dsh-wikiskill-experience)，tag `v0.1.0`，topics 含 `dsh-plugin`（市场爬虫按 topic 发现）；已实测从 `git+https://...#<sha>` 安装成功 |
| **npm** | ⏳ 未发布 | 清单已就绪、包名可用，唯一缺的是 **npm 账号认证**（见下）；认证后一条 `npm publish` 即可 |

双渠道并存不冲突：npm 包负责"能 semver 升级 / 市场索引可自动读版本"，git 仓库负责"源码可见、可固定 commit、不依赖任何 registry"。市场索引按包名一条记录，同一个包通常只会展示其中一个来源。

### 前置条件

- **git 侧不需要单独配 git token**：本机 `gh` 已登录 GitHub（token scope 含 `repo`），仓库内已配置 `credential.https://github.com.helper = !gh auth git-credential`，推送直接用已有登录态。只有要在**别的机器**上推送时才需要新凭据（`gh auth login` 或 SSH key）。
- **npm 账号并已登录**：`npm whoami --registry=https://registry.npmjs.org/`。本机当前返回 `ENEEDAUTH`（未登录），需要 `npm adduser`（交互式，2FA 会要 OTP）或 granular access token。
- **包名可用**：`npm view dsh-wikiskill-experience version --registry=https://registry.npmjs.org/` → 返回 404 才说明没被占。
- **registry 要对**：本机 npm 默认 registry 是 `https://registry.npmmirror.com`（国内镜像，**不能 publish**），发布必须显式 `--registry=https://registry.npmjs.org/`。
- 清单已就绪：无 `private`、有 `license`/`README`/`CHANGELOG`/`LICENSE`、`files` 白名单、`dsh.bundle.patch`、`exports` 含 `./locale/*.json` 与 `./icon`、**无构建步骤**（纯 JS）、`engines.dsh` 已声明。
- 建议补：`author`、`repository`、`homepage`、`bugs`（npm 页面与插件详情页会用到；当前留空）。

### 步骤

```bash
node --check index.js
node tools/verify.mjs --publish                 # 64/64
npm pack --dry-run                              # 复核真正会发布的文件列表
npm publish --registry=https://registry.npmjs.org/
```

发布后用户侧安装：

```
plugin_manager action=install_bundle target="dsh-wikiskill-experience@0.1.0" registry="https://registry.npmjs.org/"
```

> npm 上同一个版本号不可复用：0.1.0 一旦发出去，后续改动必须升版本。
