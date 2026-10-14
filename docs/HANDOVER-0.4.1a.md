# Abbey Road 交接文档 · v0.4.1a（versionCode 60）

> **范围**：本文档描述 **从 v0.4.0a 到 v0.4.1a(60) 之间、除弹窗视觉效果以外** 的全部改动（功能、结构、交互规则、构建与测试基建）。
> 弹窗视觉不在本文范围 —— 它已按需求**整体退回 v0.4.0a**（整卡玻璃 `--glass-modal` 78%/70% + `blur(var(--blur-modal)) saturate(1.5)`、遮罩 `blur(4px)` + 18% 压暗、`.modal-head` 为普通内容、操作条为 0.4.0 自带的 `position:sticky` 吸底玻璃）。
> 生成时间：2026-10-14 · 对应提交 `0abaed7`

---

## 1. 版本与发布

| 项 | 值 |
|---|---|
| 版本名 | `0.4.1a` |
| versionCode | **60**（Android） |
| 打包时间 | 由打包脚本自动写入（关于与帮助二级页可见） |
| 仓库 | `EtoileZzz/AbbeyRoad----ScheduleApp`（GitHub） |
| 发布 | Release `v0.4.1a`（Latest），资产：APK / Setup EXE / src zip |
| 交付目录 | `C:\Users\Etoile\Desktop\新建文件夹\`（`AbbeyRoad-v0.4.1a.apk`、`AbbeyRoad-Setup-v0.4.1a.exe`、`AbbeyRoad-v0.4.1a-src.zip`） |
| 源码目录 | `C:\Users\Etoile\Desktop\新建文件夹\abbey-road\`（工作区）；`C:\Users\Etoile\Documents\Codex\abbey-road\`（Git 镜像，用于提交/推送） |

---

## 2. 功能改动清单（不含弹窗视觉）

### 2.1 作业（Homework）

- **修复「备注里写了作业但作业面板不显示」**，并新增 **「刷新作业」**：从现有课程备注重建漏掉的作业条目（设置里可手动触发，带提示文案）。
- 备注中新增/删除作业行 → 条目**生成/进回收站**（不是凭空消失）。
- 涉及：`app/js/core.js`（备注→作业解析）、`app/js/panels.js`（作业面板、刷新按钮）、`app/js/ui.js`。
- 验收：`tools/verify-041.js` 的 `R8 / R8b / R8c`。

### 2.2 删除全面可恢复（软删除体系）★核心

- **软删除**：所有删除先落 `deleted / deletedAt` 标记，记录仍留在文件中。
- **回收站**：设置 → 数据与同步 → 回收站（**平铺**，不再是标签页），列出条目，可单条**恢复**、可**清空**（清空才是真的从文件移除）。
- **5 秒撤销**：删除后浮出「撤销」提示，点一下记录回来。
- **90 天自动清理**：过期条目真删；设「不自动」时跳过。
- **速记墓碑**：速记删除写 tombstone → **导入旧存档不会复活**该速记。
- **导出包含软删记录**（备份不丢隐藏数据）。
- 验收：`R1 / R2 / R3 / R5 / R5b / R5c / R9 / R9b`。

### 2.3 删除跟随作用域

删除课程块时按作用域区分：

- **仅这次** → 只取消这一天（每周时段保留，新增一条「取消」记录）
- **所有时段** → 删除整个每周时段，进回收站
- **单次课** → 只删这次调整

验收：`R7`（含「取消这一天的课 / 保存这一次」等场景化按钮文案）。

### 2.4 学期与周次

- **学期切换不再破坏数据**（非破坏性切换）。
- 作业/任务按**当前学期过滤**（新增 `semesterOfTask(t)`：任务自身的 `semesterId`，否则取所属课程；`taskList(semId)`）。
- `findTask` 改为扫描**原始数组**（`taskRaw()`），修掉跨学期重复。
- **周次越界钳制**（`clampWeek(n, sem)`）：修掉「第 41 / 20 周」的显示。
- **学期进度条**：填充条正常渲染（`.cm-sem-fill { background: var(--accent) }`）+ **期中/期末标记**。
- 验收：`verify-040`、`test-logic` 中学期相关断言。

### 2.5 设置结构改版

- 设置分类改为 **7 个分类**（外观与布局、数据与同步、课程、桌面卡片、提醒、关于与帮助、开发者模式等）；开发者模式开启后为**第 8 个独立分类**。
- 「数据与同步」由标签页改为**从上到下平铺**（四个面板全在，无滑块标签、无重复「回收站」标签）。
- 验收：`R11`。

### 2.6 检查更新（关于与帮助）

- 查 GitHub Releases，比较版本号（支持 `0.4.1a` 这种**数字三段 + 尾字母**）。
- **默认关闭**，可选 每周 / 每月 自动检查；发现新版 → 弹窗提示 + 「打开下载页」，并记录检查时间。
- 验收：`R10 / R10b / R10c`。

### 2.7 桌面卡片（Widget）★核心

- **每种尺寸 3 套功能预设**：`4×1` 今日头、`2×2` 下一节课、其他尺寸各自预设（`A/B/C`）。
- **显示元素自由组合**：「我的」页里按元素开关，payload 里以 `hide[]` 下发；被隐藏的字段**一并清空**，避免残留。
- 原生侧：`WidgetData.hide` 列表 + `WidgetRenderer` 对 `h_sub / h_badge / n_in / n_time / n_place / row metas[i] / w_sub` 调用 `setViewVisibility(GONE)`。
- 涉及：`app/js/widgetdata.js`（`buildPayload()`、`ELEMENTS`、`applyElements()`）、`app/js/panels.js`（`presetRow()` 4 行 + `elementChips()` 8 个开关）、`android/src/.../WidgetData.java`、`WidgetRenderer.java`。
- 验收：`verify-040` 中桌面卡片预设/元素断言。

### 2.8 「我的」页课程只读

- 点课程进入**只读详情**（`课程详情 · 只读`），没有编辑/删除入口，带「只读查看」提示；只剩 ✕ 关闭。
- 验收：`R4`。

### 2.9 开发者模式（入口与面板）

- **入口**：长按底部导航的「设置」（800ms，`pointerdown/up/move` 取消），**只挂这一个位置**；旧入口全部删除。
- **行为**：默认关闭；开启后**停在设置分类页**（不自动跳转）；设置里多出独立分类 **🧪 开发者模式**，**无高频项**；再次长按关闭（若当前停在该分类则退回）。
- **面板内容**：弹窗玻璃样式预设（4 套内置 + 3 个自定义槽；长按槽位可清除）+ 滑块（不透明度 / 模糊 / 饱和度）→ 作用于**整卡**；动效场景；开发者工具。
- 涉及：`app/js/panels.js`（`settingsCats()` 的 `dev` 分类、`devPanel()`、`modalStyleBox()`、`bindDevNav()`）、`app/js/ui.js`（`MODAL_BUILTIN`、`modalCfg`、`activeModalStyle`、`setModalActive`、`setModalSlot`、`applyModalStyleObj`、`applyModalTuning`）、`settings.appearance.devMode / modalStyle / modalSlots`。
- 验收：`R16`（长按开关、独立分类、无高频项、预设可切换、关闭后消失）。

### 2.10 按钮与弹窗交互规则（非视觉）

- **删掉纯文字「取消」「关闭」按钮**（与 ✕ / 点遮罩 / 系统返回等效）；**带场景语义的保留**（如「取消这一天的课」）。
- **✕ / 遮罩空白 / 系统返回** 三者等效关闭。
- 按钮**宽度由文字决定**（不强制等宽）、**一行优先**、放不下换行、间距 **8px**、文字不折行。
- 操作条**吸底**（长弹窗不必滚到底）。
- 验收：`R12b`、`R7`。

### 2.11 流畅模式（性能档）

- `body[data-perf="lite"|"min"]`：**弹窗彻底无模糊**、两条带不透明、卡片不透明度自动夹到 **≥90%**（JS 内联写入，保证在预设/流畅模式两条路径都真正生效）。
- 验收：`R15a`、`R16`。

### 2.12 旧 WebView 兼容

- **移除 `light-dark()`**（旧 WebView 会整条声明丢弃 → 曾导致弹窗透明），改为纯 `rgba()` + `body[data-theme="dark"]` 覆盖。
- 禁用清单（回归扫描）：`light-dark()`、`color-mix()`、`:has()`、CSS 嵌套、`@container`、`scrollbar-gutter`。
- `@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))` 提供实底兜底。
- 保留 `flex gap`（Chrome 84+）这一既有依赖。
- 验收：`R15b`（去注释后扫描，全部为 0 且兜底存在）。

### 2.13 版本信息展示与写入

- 设置 → **关于与帮助 二级页** 显示：`AbbeyRoad v0.4.1a · Android · API xx · versionCode 60` + `打包时间 YYYY-MM-DD HH:mm`（**不再放设置首页高频项**）。
- `app/js/core.js`：`APP_VERSION / APP_BUILD_CODE / APP_BUILD_AT`，并在 `AR.Const` 导出 `appVersion / buildCode / buildAt`。
- `tools/bump-version.js`：打包时自动写入 versionCode 与时间（`stampBuild()`）。
- **发布前硬校验**：解包 APK 比对 `assets/web/js/core.js` 里的 `APP_BUILD_CODE` 是否等于本次 versionCode，不等直接中止发布。

### 2.14 测试与构建基建

- `tools/headless.ps1`：本地静态服务（8123）+ CDP（9333），供 UI 回归使用。
- 回归套件：`tools/test-logic.js`（217 项）、`tools/verify-040.js`（23 项）、`tools/verify-041.js`（26 项，含 R1–R16）、`tools/smoke-ui.js`（138 项）。
- 冒烟自带**清环境**（清 storage + 强制重载 + 选对页面目标），修掉此前「选到非应用页 → AR is not defined」的假失败与状态污染。
- `tools/make-src-zip.js` 产出源码 zip；`windows/build.ps1` 产出便携版与 Setup EXE；Android 构建走 subst 盘 + `android/build.local.ps1`（签名信息不入库）。
- GitHub 推送走 `dist/gh-api-push.js`（本机 `github.com:443` 不通，走 `api.github.com`）。

---

## 3. 关键数据结构

| 位置 | 字段 | 说明 |
|---|---|---|
| `settings.appearance` | `devMode` | 开发者模式开关（长按底部「设置」切换） |
| `settings.appearance` | `modalStyle` | `{ active: 'builtin:glass'\|'slot:N' }` |
| `settings.appearance` | `modalSlots[3]` | 3 个自定义玻璃样式槽（旧字段 `modalCardA/modalBarA/modalBarBlur` 迁移进 slot 0） |
| `settings.widgets` | `presets` | 每个尺寸的功能预设（A/B/C） |
| `settings.widgets` | `hidden` | 被隐藏的显示元素 → payload `hide[]` |
| 记录级 | `deleted` / `deletedAt` | 软删除标记；回收站/撤销/90 天清理依据 |
| 记录级 | tombstone | 速记墓碑，防止导入旧存档复活 |
| 学期 | `semesterId` | 任务可自带，否则继承课程的学期 |

---

## 4. 构建与发布流程（可照做）

```
# 1) 改代码（工作区 abbey-road）
# 2) 版本号 + 写入 versionCode 与打包时间
node tools/bump-version.js 0.4.1a <code>

# 3) 回归（必须先清环境，再依次跑）
powershell -File tools/headless.ps1        # 若未在跑
node tools/verify-041.js                   # 26
node tools/verify-040.js                   # 23
node tools/smoke-ui.js                     # 138
node tools/test-logic.js                   # 217

# 4) Android APK（subst 盘 + 本地签名脚本）
powershell -File build-android-038b.ps1 <projRoot> <build.local.ps1>

# 5) 解包校验 versionCode（硬门槛）
#    读 APK 内 assets/web/js/core.js 的 APP_BUILD_CODE，须等于本次 code

# 6) 源码 zip + Windows EXE
node tools/make-src-zip.js  →  Compress-Archive
powershell -File windows/build.ps1

# 7) 复制三个交付物到项目目录，同步到 Git 镜像并推送 + 替换 Release
node dist/gh-api-push.js push
gh release delete v0.4.1a --yes --cleanup-tag
gh release create v0.4.1a --title "v0.4.1a" --notes-file dist/release-v0.4.1a-final.md <3 个资产>
```

**版本号规则**：修 bug → 尾字母递增（`0.4.1a`→`0.4.1b`）；加功能 → 数字递增。Android **versionCode 必须递增**，否则设备无法覆盖安装。

---

## 5. 已知限制与坑（重要）

1. **卡片内的 `backdrop-filter` 采不到卡片背后的页面**（实测：卡片内 30px→0 的像素差仅 6.3k，卡片外遮罩同样操作 94k）。因此"背景化开"只能由**卡片外**的层负责（遮罩）。这不是参数问题。
2. 0.4.0a 的遮罩只有 **4px**，所以背景"化开"很轻 —— 这是刻意的原样；要更糊只调遮罩 blur 一个值。
3. 弹窗视觉以 **0.4.0a** 为准（78%/70% + `blur(var(--blur-modal))`），**不要再引入** `light-dark()`、`color-mix()`、`:has()`、嵌套、`@container`（旧 WebView 会整条丢弃声明）。
4. 操作条吸底用 `position: sticky`（父级是卡片的滚动容器），**不要**改成"卡片外绝对定位"——那会让动画与设置变复杂（本会话已踩过）。
5. 开发者预设的透明度/模糊除写 CSS 变量外，还会**内联写一次**到卡片上，保证预设与流畅模式在两条路径都生效；改动该函数时不要删掉内联写入。
6. 冒烟/回归前必须**清 storage + 强制重载**，否则会出状态污染导致的假失败。
7. 本机 `github.com:443` 不通 → 推送只能用 `dist/gh-api-push.js`（走 `api.github.com`）。
8. 签名/密钥文件不入库，Android 构建依赖 `android/build.local.ps1`。

---

## 6. 回归套件覆盖对照（便于二次开发时定位）

| 断言 | 覆盖内容 |
|---|---|
| R1 / R2 | 删日程 / 删整门课（软删除、回收站、恢复） |
| R3 | 5 秒撤销 |
| R4 | 「我的」页只读 |
| R5 / R5b / R5c | 回收站平铺 / 恢复 / 清空真删 |
| R7 | 删除作用域（仅这次 / 所有时段 / 单次） |
| R8 / R8b / R8c | 备注→作业、删除入回收站、刷新作业 |
| R9 / R9b | 速记墓碑 / 90 天清理与「不自动」 |
| R10 / R10b / R10c | 版本比较 / 检查更新入口与默认值 / 发现新版流程 |
| R11 | 数据与同步平铺 |
| R12 | 弹窗 = v0.4.0a 契约（整卡唯一玻璃层、无 `.modal-glass/.modal-scroll`、卡片自滚、标题普通、操作条 sticky） |
| R12b | 操作条按钮规则（自然宽度 / 一行 / 间距 / 不折行） |
| R15a | 玻璃数值（78/70 + blur）+ 流畅模式（无模糊、卡片 90%） |
| R15b | 旧 WebView 兼容扫描 |
| R16 | 开发者模式入口、独立分类、预设可切换 |

---

## 7. 建议的后续项

- 遮罩模糊强度若需增强：只改 `.modal-scrim` 的 `blur()` 一个值（1 行）。
- 弹窗预设面板可补一根「淡出/遮罩模糊」滑块（当前只有不透明度/模糊/饱和度）。
- 老设备（无 `backdrop-filter`）目前靠 `@supports not` 实底兜底；如需更细的降级策略（如按 `data-perf` 自动切换），可在 `applyModalStyleObj` 里扩展。
