---
name: dsh-client-theme
description: "给 DeepSeek Harness 客户端（桌面端 / Web GUI）做主题、换肤、配色、开机动画或 HUD 装饰时使用：覆盖 --dsw-* token、注入 CSS 与覆盖层、装进 dsh profile 生效，并用截图验收。"
whenToUse: "用户说「把 DSH 改成 XX 风格」「换个皮肤/配色」「照这个视频或截图做主题」「加开机动画」，或要改 dsh-theme-* 插件、调主题里的某一块时。"
---

# DSH 客户端主题（换肤 / 开机动画）

主题通过跑在浏览器渲染进程里的**客户端插件包**提供：

1. 用 `ctx.theme.overrideTokens(source, tokens)` 往当前主题上叠一层 token；
2. 往 `document.head` 注入一段 `<style>`（皮肤 CSS）；
3. 往 `body` 挂装饰节点（HUD、封面层、开机覆盖层）。

插件包放进 profile 的 `node_modules`，再在 `cordis.patch.yml` 里加一行加载项，客户端启动时就会加载它。**不要**改 `app.asar` 或官方包 —— 升级即失效。

## 事实模型（先看懂再动手）

| 层 | 在哪 | 作用 |
| --- | --- | --- |
| token 样式表 | `@deepseek-ai/dsh-client-ui-theme/lib/client.js` 内联的 8 张表 | `--dsw-static-*` 调色板 / `--dsw-alias-*` 语义 / `--dsw-specific-*` 局部 |
| 两套 alias | `body{}`（light）与 `body[data-ds-dark-theme]{}`（dark） | alias 的值大量写成 `var(--dsw-static-…)` |
| ThemeRuntime | `ctx.theme` 服务 | `getTheme()` / `setTheme(id)` / `overrideTokens(source, { token: { light, dark } })` |
| presenter | `dsh-client-ui-layout` | 把当前 token 写成 **body 的内联样式**，所以覆盖层优先级最高 |

由此得到两个结论：

- **改 `--dsw-static-*` 三个色阶（neutral-bluish / blue / deepseek）就能整片换色**，所有 alias 自动跟随；
- dark alias 只在 `body[data-ds-dark-theme]` 下生效。参考主题按**深色皮肤**处理：从 `getTheme().active.colorScheme` 判断是否启用；进入深色时挂载 token/CSS/HUD，进入浅色时完整卸载，保留原生浅色界面。
- **皮肤不调用 `setTheme()`，不写用户持久偏好。** 使用皮肤时，在客户端 Appearance 中选择 Dark，或使用会解析为深色的 System。运行时把参考色板中的深色值转换为 `{ light: dark, dark }`，避免一层 token 内混入浅色 surface。

## 别走的路

| 做法 | 为什么不行 |
| --- | --- |
| 改 `app.asar` / 官方包 | 应用升级即失效，签名也可能失效 |
| 只改 Settings | 设置里只有 light / dark / system |
| 用 CSS Modules 的 hash 类名当选择器 | 每次构建都会变；用 `data-slot` / `data-*` 钩子 |
| 用 rAF 持续等待 DOM，或启动无上限的定时轮询 | 离屏 rAF 会停；缺失节点不应造成永久轮询。用 MutationObserver 监听节点变化，ResizeObserver 监听盒子尺寸 |

## 五步

### 1. 从参考主题生成独立插件包

```
reference/
  shared/
    runtime.js      # 两套主题共用的生命周期、模式切换、DOM 观察和开机时序
    boot.html       # 开机结构，使用 {{unit}} / {{syncTarget}} 等配置占位符
  unit00/          # unit02/ 结构相同
    package.json
    theme/
      config.json  # 包 id、机体编号、文案、同步率、播放参数
      tokens.json  # 深色 token 字符串映射
      skin.css     # 皮肤与动效，封面使用 __DSH_THEME_COVER__ 占位符
      cover.jpg    # 封面原图
    lib/
      index.js     # 空的 Host 入口
      client.js    # 自动生成的独立浏览器包
```

修改 `theme/` 或 `reference/shared/` 后执行：

```bash
node scripts/build-themes.mjs
```

构建只需要 Node.js，无第三方构建依赖。先解析所有生成的 JS，再按文件原子替换；内容未变化时不写入，避免无意义 HMR。每套生成的插件都独立包含运行逻辑、CSS 和一份封面，不需要在 profile 里另装共享运行包。

**不要直接编辑生成的 `lib/client.js`。** 新主题可复制一套目录，修改 `package.json` 和 `theme/config.json` 中一致的包名/id；构建器会发现 `reference/shared/` 之外的主题目录。

`package.json` 关键字段：

```json
{
  "name": "dsh-theme-<name>",
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": { "default": "./lib/index.js" }, "./client": { "default": "./lib/client.js" } },
  "dsh": { "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-theme", "@deepseek-ai/dsh-client-ui-layout"] } }
}
```

生成的 `lib/client.js` 使用原生 `window.__ModuleLoader__.load({ id, factory })` 入口。构建器将共享运行时内嵌到 factory，返回带 `apply` 和 `inject: ["theme"]` 的插件对象；挂载和清理集中维护。

完整实现见 `reference/shared/runtime.js`；可直接安装的包见 `reference/unit02/lib/client.js` 和 `reference/unit00/lib/client.js`。

### 2. 定 token 映射

先在 `theme/tokens.json` 修改三条色阶，再补语义 alias；源码色板存深色字符串，运行时会转换成 API 要求的双槽值：

| 色阶 | 覆盖后 | 影响 |
| --- | --- | --- |
| `--dsw-static-neutral-bluish-00 … 1000` | 暖灰 / 冷灰 / 任何中性色 | 背景、文字、边框全部 |
| `--dsw-static-blue-50 … 950` | 主色 | 选中态、链接、进度 |
| `--dsw-static-deepseek-50 … 900` | 品牌色 | 品牌、按钮、业务状态 |

再按需要补：

| token | 用途 |
| --- | --- |
| `--dsw-alias-bg-base` | 内容区底色（半透明可露出底图） |
| `--dsw-specific-sidebar-fill` | 侧边栏底色 |
| `--dsw-specific-input-major` | 输入框底色 |
| `--dsw-alias-brand-primary` / `--dsw-alias-label-primary-foreground` | 主按钮底色 / 按钮上的字 |
| `--dsw-specific-sidebar-nav-item-active(-accent)` | 侧边栏选中行 |
| `--dsw-alias-focus-ring-color` | 焦点环 |

⚠️ 调用 `ctx.theme.overrideTokens()` 时，所有 token 必须给 `{ light, dark }` 两个值，只给字符串会被运行时拒绝。参考主题 `tokens.json` 的字符串由共享运行时转换，不能把该 JSON 直接传给服务。

### 3. 注入皮肤 CSS（稳定钩子）

优先用这些属性，不依赖 hash 类名：

| 钩子 | 命中 |
| --- | --- |
| `[data-slot="sidebar"]` | 侧边栏内容根 |
| `[data-slot="main"]` | 主区（注意：`display: contents`，宽高为 0） |
| `[data-slot="conversation.header"] > header` | 顶栏（可加虚线底边） |
| `[data-slot="conversation.composer"]` / `[data-composer-card]` | 输入区 |
| `[data-composer-input]` | 输入框本体（caret-color） |
| `[data-conversation-content]` | 消息滚动区 |
| `[data-phase="hero"]` | 空会话（欢迎页）——可用 `html:has([data-phase="hero"])` 区分 |
| `[data-platform="darwin"]` | macOS 桌面端 |

需要给「面板」本身加背景时，`[data-slot="main"]` 没用（0 尺寸），要向上找到第一个真正有盒子的祖先，用 JS 打标记。共享运行时在节点替换、尺寸变化后重新绑定；卸载时只移除自己添加的标记。

首页图用 `scripts/make-cover.py` 生成，亮度与 alpha 的对应关系见下面「首页图」一节。

### 4. 装进 profile

先确认用户指定的 profile 和允许访问的目录。只安装到本次授权的目标，备份原主题包和 `cordis.patch.yml`；已有安装授权时直接完成，无需重复确认。

1. 在源码目录构建，准备完整的 `package.json` 和 `lib/`。
2. 用 profile 内的暂存目录准备完整包，再替换目标包；保留原包备份，不使用无备份的 `rm -rf`。
3. 检查现有 YAML 加载项，按准确的 `id` 幂等更新；保留其他插件和用户配置，避免用宽泛的文本匹配重复追加。
4. 同一时刻只启用一套主题。刷新前先完成全部文件替换。

`~/.dsh` 常在当前 workspace 之外；是否能写入取决于当前会话的目录授权和权限设置。不要假定能扩大访问范围，也不要把主题源码优化自动扩展成修改用户正在使用的 profile。

生效：刷新窗口（⌘R）；不行就退出应用重开。关闭：删掉那 3 行加载项 + 删掉包目录。

### 5. 截图验收

需要截图时可用 WebKit（`scripts/shot.swift`）。构建成功、静态截图和真实客户端交互分别记录；未执行的检查不能标为通过。

```bash
THEME_ARTIFACT_DIR="$HOME/personal/.cache/dsh-theme-preview"
mkdir -p "$THEME_ARTIFACT_DIR/tmp" "$THEME_ARTIFACT_DIR/mcache"
TMPDIR="$THEME_ARTIFACT_DIR/tmp" swiftc -O \
  -module-cache-path "$THEME_ARTIFACT_DIR/mcache" \
  scripts/shot.swift -o "$THEME_ARTIFACT_DIR/shot"
"$THEME_ARTIFACT_DIR/shot" "<local-url-with-token>" \
  "$THEME_ARTIFACT_DIR/out.png" 1440 900 2.0
# 需要固定截图状态时，在末尾追加实际的 preScript.js 路径。
```

等待时间从主文档完成导航后开始计算。`preScript.js` 执行后再等待 1.5s 截图，用来把状态摆到想截的那一帧；`scripts/evaljs.swift` 用来读 DOM/计算样式（支持 `@file.js`）。导航失败、HTTP 错误、脚本读取/执行失败、PNG 写入失败均返回非零退出码；只有写入成功才输出 `saved`。

使用隔离的验证实例；只带入当前获准使用的最小 UI/主题配置，缓存与产物放在授权目录。示例：

```bash
DSH_HOME="$THEME_ARTIFACT_DIR/dsh-home" dsh web --no-open --port 57999
```

CLI 输出带 token 的本地 URL；验证时使用，记录结果时省略 token。两个 WebKit 工具使用独立的非持久数据存储。

### 开机动画与重播

- `theme/config.json` 的 `bootScale` 默认 `2`，保留原来的节奏；CSS 时长和 JS 时间表一起缩放。
- LCL 光幕从窗口底部上推到顶部，完整高度为窗口的 100%，不再停在 24vh；其余阶段的扫描光带也从底部向顶部移动。
- 每一幕等待当前 Web Animation 的 `finished` 后才自动进入下一幕；最后一道扫描完成后才退出开机层，不用固定的全局定时器抢先切换。数值和进度条使用同一道扫描的播放进度。
- 页面隐藏时暂停当前扫描，回到页面后继续，避免在看不到动画时跳过后面的画面。手动跳过和卸载会取消动画与后续推进。
- `bootOnce: true` 表示每套主题在当前文档内播放一次：刷新或重新打开客户端会重播，HMR 或明暗模式切换不重复播。只使用页面内存去重，不写 `sessionStorage`，避免桌面端恢复旧会话时跳过开机效果。
- 按键或点击可跳过。非 IME 组合输入中的 Enter / 空格 / Escape 跳过时会拦截该事件，避免同时触发底层输入动作；文字键和 IME 组合输入继续传给客户端。
- `prefers-reduced-motion: reduce` 时不挂开机层，包括手动重播。
- 对当前已启用的皮肤，可在客户端控制台主动重播：

```js
window.dispatchEvent(new CustomEvent("dsh-theme:replay", {
  detail: { id: "dsh-theme-unit00" } // 二号机改为 dsh-theme-unit02
}));
```

## 首页图（hero cover）

欢迎页那张图是这个主题最显眼的部分，三种来源按优先级：

| 来源 | 做法 | 注意 |
| --- | --- | --- |
| 用户给图 | `scripts/make-cover.py` 裁成 1180×604 | 竖版海报只裁上半幅，别把主体切掉 |
| 视频/截图里截 | 先做透视校正（PIL `Image.QUAD`）+ 中值去摩尔纹，再走同一个脚本 | 拍屏素材放大会软，别超过 1.5× |
| 没有素材 | 程序生成：渐变底 + 主光 + 网格/水印 | 只当氛围，别硬仿立绘 |

```bash
python3 scripts/make-cover.py poster.jpg cover.jpg --crop 150,90,1536,1090 --vignette 0.45
python3 scripts/make-cover.py keyart.png  cover.jpg --duotone cold   # 换色版
```

脚本输出的 **mean RGB** 可作为调背景透明度的经验指标；它是 RGB 算术均值，不是相对亮度或正文对比度测量：

- 70–110（正常亮度）→ `--dsw-alias-bg-base` 的 dark alpha 用 **0.74**；
- 40–70（冷色/暗稿）→ **0.55–0.62**，否则整张图会被压成黑；
- 110+ → **0.78–0.82**，否则正文对比度不够。

调完在隔离实例里量一下屏幕亮度（截图取中部均值），落在 **25–40** 之间最稳：
太低说明底图废了，太高说明正文要糊。

## 多套主题共存与切换

多套主题包可以**同时装在 profile 里**，靠 `cordis.patch.yml` 的那一行决定用哪套：

```yaml
- insert:
    - id: theme-<name>
      name: 'dsh-theme-<name>'      # 改这一行 = 换一套
```

- 同一时间**只能启用一套**：两套都开会互相覆盖 token，CSS 也会叠加；
- 切换后必须刷新窗口（⌘R），热切换会先闪一下；
- 每套的包名/id 必须不同（`dsh-theme-unit02` / `dsh-theme-unit00`），
  否则 Loader 认为是同一个插件。

## 坑（都踩过）

1. **`immediately: true` 时 shell 还没渲染**：`[data-slot="main"]` 是 `display: contents`，自身矩形为 0。使用 MutationObserver 等待节点，ResizeObserver / resize 处理布局变化；不能等到一次标记成功就永远停止，也不能无上限轮询。
2. **皮肤不写 `setTheme()`**：host 会持久保存偏好。参考运行时监听 `theme/change`，在原生深色模式下启用，浅色时撤销整套 token/CSS/HUD。
3. **应用会重写 `cordis.patch.yml`**（写 `ui-theme` 偏好等）。追加加载项时按 `id` 幂等判断，别重复插入。
4. **大图 base64 只出现一次**：写 `:root { --art: url("data:…") }`，其他地方 `var(--art)`，否则 bundle 体积翻倍。
5. **HMR 会闪**：改 profile 里的文件会触发客户端热重载，用户屏幕上会「挂载→卸载」。一次改完再让用户刷新，别边改边看。
6. **离屏 WebKit 可能冻结 CSS 动画**：截图只能验静态构图。需要指定画面时显式取消动画、设置目标状态；完整动效在可见客户端验证，不能凭一张离屏截图判断时序通过。
7. **透明度与可读性**：底图铺满时，用 `html:has([data-phase="hero"])` 只在欢迎页全强度显示，进对话自动压暗。

## 验收清单

- [ ] 欢迎页：底图/主色/标题可读
- [ ] 侧边栏：选中行、hover、图标对比度
- [ ] 输入区：描边、caret、发送键、禁用态
- [ ] 设置弹窗、菜单、tooltip（半透明 surface 是否串色）
- [ ] 会话里：正文、代码块、工具卡
- [ ] 刷新一次不闪、不白屏；关掉插件能干净回滚
- [ ] 桌面端与 Web 端表现一致（`data-platform` 差异）

## 参考实现

`reference/` 里放了两套完整可跑的主题，源码就是最终装到 profile 里的那一份：

| 目录 | 主题 | 用它学什么 |
| --- | --- | --- |
| `reference/unit02/` | 二号机 / 朱红 | 五段开机、HUD 仪表、暖灰/朱红色板，配置驱动身份与同步率 |
| `reference/unit00/` | 零号机 / 钴蓝 | 在 02 版基础上换肤的范例：色阶重写 + 暖色→冷色映射 + 用户海报做封面 + 按图亮度回调 `bg-base` alpha |

两套都是：

- `package.json` / `lib/index.js`：包骨架（`dsh.client` 声明 + 空的 host 半边）；
- `theme/`：可编辑的配置、深色色板、CSS 与封面；
- `lib/client.js`：由公共运行时和上述素材生成的独立包，包含 token 层、皮肤 CSS、开机序列、DOM 标记与 disposer。

改造路径：**拷一套 → 改包名/id → 改 `theme/tokens.json` 与 `skin.css` → 换 `cover.jpg` → 改 `config.json` 的文案/同步率 → 执行构建 → 隔离验收**。
行为修改集中在 `reference/shared/runtime.js`；开机结构修改集中在 `reference/shared/boot.html`。构建后仍只需安装选中的独立主题包。
