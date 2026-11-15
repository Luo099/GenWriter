# GenWriter 前端改版报告

> 目标：用 `0x38C48/GenWriter` 推进软工课设，先在本机跑通，再针对前端做一轮可用性与视觉打磨。
> 结论：**已跑通**（Postgres + Redis + Spring Boot + Vite 全部起来，CRUD 与页面渲染正常）；**前端完成一轮系统化改版**（8 个文件改动 + 新增 1 个样式层）；**建议拆成 3 个 commit 走 PR**，理由见第六节。

---

## 一、跑通情况

### 1.1 环境组成

| 组件 | 本机选型 | 说明 |
| --- | --- | --- |
| 数据库 | Docker `pgvector/pgvector:pg16` | 建表脚本 `src/main/resources/db/schema.sql` 自动执行，实际建成 9 张表 |
| 缓存 | Docker `redis:7-alpine` | 会话记忆 / checkpoint |
| 后端 | Temurin **JDK 17** + Maven 3.9.9 | 仓库要求 Java 17；本机默认 JDK 25 编译 Lombok 会崩 |
| 前端 | Node 24 + Vite 8 | `npm run dev` → 3000，代理 `/api` 到 8080 |

### 1.2 启动命令（本机可直接复用）

```bash
# 0) 先准备 .env（compose 会强校验 API Key 变量存在）
cd F:/软工课设/GenWriter && cp .env.example .env   # 填任意占位值即可启动

# 1) 依赖服务
docker compose up -d postgres redis

# 2) 后端（注意用 JDK 17，不要用本机默认的 25）
export JAVA_HOME="F:/tools/jdk-17.0.21+9"
/f/tools/apache-maven-3.9.9/bin/mvn.cmd -B -DskipTests package
"F:/tools/jdk-17.0.21+9/bin/java" -jar target/GenWriter-0.0.1-SNAPSHOT.jar

# 3) 前端
cd frontend && npm install && npm run dev
```

### 1.3 验证到的点

- 后端 13.1s 启动成功，`GET /api/projects`、`/api/sessions`、`/api/messages`、`/api/documents` 均返回正常。
- 用 API 造了一条真实会话（4 条消息 + 1 份文稿 V1），前端能完整加载：Markdown 表格/引用/有序列表渲染、执行轨迹、版本工作台回填都正常。
- 前端 `vite build` 通过（2242 modules，552ms）；`eslint` 报错数 **15 → 14**（没有新增，反而少了一条）。

### 1.4 踩过的坑（值得写进课设的"环境说明"）

1. **JDK 25 编译失败**：`Fatal error compiling: com.sun.tools.javac.code.TypeTag :: UNKNOWN` —— Lombok 与新版 javac 不兼容，换 JDK 17 即解。
2. **`mvnw` 拉不下来**：wrapper 里 `wget` 走 `/tmp`，在 Windows + MSYS 下失败；改为下载 Maven 3.9.9 到 `F:/tools` 后直接调 `mvn.cmd`（且必须用 `mvn.cmd`，bash 的 `mvn` 脚本路径解析会报 `ClassNotFoundException`）。
3. **`docker compose up` 报缺变量**：compose 对 `DASHSCOPE_API_KEY / DEEPSEEK_API_KEY` 用了 `:?` 强校验，没有 `.env` 直接拒绝启动。
4. **Windows 防火墙弹窗**：Docker Desktop Backend 的"专用网络"授权被本机组策略锁住（"允许"置灰）。**不影响本项目** —— 只用到 `localhost:5432/6379`，点取消即可。
5. **Docker Desktop 重启会让容器退出**：容器不是 `restart: unless-stopped`，重启后需 `docker start genwriter-db genwriter-redis`，否则后端会卡在 `code=000`（Tomcat 在监听但请求阻塞）。

---

## 二、改版清单

改版分三层：**设计令牌 → 结构/信息架构 → 空状态与文案**，另外顺手修了两个真实 bug。

### 2.1 新增：统一设计层 `frontend/src/styles/redesign.css`

不改动原 5000 多行 `components.css`，新增一层在它之后加载的覆盖样式（1842 行，按区块注释组织）。好处是**可整体回滚**、PR 里一眼能看出是"一层皮肤"而不是把老样式删改得面目全非。

覆盖范围：

- 纸感中性色 + 深墨主按钮（`#241d18` 底 + 米白字），替代原来"浅棕底白字"的低对比主按钮；
- 统一内容宽度：消息区 / 欢迎页 / 输入框都收敛到 820px 中轴；
- 侧栏、消息气泡、工作台、子页面（知识库 / 记忆 / 技能 / 设置）的一致性规则；
- 焦点环、滚动条、`prefers-reduced-motion`、`@container` 窄工作台适配。

### 2.2 `theme.css`：设计令牌重写

| 变化 | 原来 | 现在 |
| --- | --- | --- |
| 主色 | `#c2854a`（描边色当主色用） | 主按钮用深墨 `#241d18`，强调色 `#b06a35` 只做描边/图标/链接 |
| 正文/次要/弱文字 | `#1a1a1a / #666 / #999` | `#1a1613 / #6d635a / #857b6f`（弱文字提一档对比度） |
| 字体 | `--font-sans` 里混进 Georgia/思源宋体，界面正文其实是衬线 | 界面走系统无衬线，另立 `--font-serif` 只给标题/欢迎语/文稿标题 |
| 圆角/阴影 | 3 档圆角、2 档阴影 | 5 档圆角 + 药丸、3 档阴影 + inset 高光 |
| 间距/动效 | 只有 spacing，无过渡曲线 | 补 `--ease` / `--dur`，所有按钮统一过渡 |

### 2.3 侧栏：把导航从"下拉菜单"提到一级

**原状**：知识库、长期记忆、风格学习、技能管理、设置五个入口全藏在左下角"用户"头像的展开菜单里，首屏看不见，评审老师第一眼只会觉得"这个项目只有聊天"。

**现在**：品牌区 → 一级导航（对话 / 知识库 / 长期记忆 / 风格学习 / 技能 / 系统设置）→ 新对话主按钮 → 项目 → 会话 → 用户区。

另外补了：项目空的引导文案、会话空的虚线卡片（带"新建一个对话"）、会话前面板状态的圆点、批量删除按钮悬停才出现。

### 2.4 欢迎页：从"一句招呼"到任务入口

原来只有 logo + 一句话 + 大片留白（评审最容易被吐槽的点）。现在给 4 张任务卡：**从零起草 / 接着写下去 / 润色一段 / 查资料再写**，点一下就把预设 prompt 发出去；下方一行能力标签（知识库检索 · 长期记忆 · 版本化文稿 · 多模型切换），让"这个系统有什么"在首屏就能说清。

### 2.5 输入区：合成一个 composer

原来输入框、附件按钮、发送按钮、5 个模式胶囊、联网开关、提示文字是**六层散装元素**，底部很挤且主次不清。改成：一个圆角卡片（textarea + 底部工具条），工具条左侧模式胶囊、右侧附件/联网/发送；发送按钮是唯一的深色主操作，禁用态明确置灰。

### 2.6 版本工作台：补空状态、收按钮、改口径

- **新增空状态**：没会话/没文稿时不再显示"标题框 + 5 个禁用按钮 + 空编辑器 + 迭代区"这套自相矛盾的界面，改成图标 + 说明 + "新建空白文稿" CTA + 三条能力说明。
- **保存/另存**从工具栏收到头部（图标 + tooltip），工具栏只留选区 AI 三连，`@container` 窄宽度下自动隐藏右侧提示、胶囊可横向滚动，不再换行。
- **版本条**：`V1 draft` → `V1 草稿`，`sourceLabel` 做中英映射；版本 chip 收敛成药丸。
- **迭代区**：标题改"整篇迭代"与上方"选区 AI"区分语义；提交按钮文案随模式变化（提交续写/润色/重写）；输入框禁用 resize。

### 2.7 顺手修的两个真实 bug

1. **工作台宽度永远是最小值**（`ChatArea.jsx`）
   `Number(localStorage.getItem(...))` 在没有存值时得到 `0`，`Number.isFinite(0)` 为真 → 永远 clamp 到 `MIN_WORKBENCH_WIDTH`。表现是右侧面板死活只有 320px，怎么拖都回不到默认 460。改为先判断 `raw === null`。
2. **打开文稿就显示"未保存"**（`WritingWorkbench.jsx`）
   编辑器回填内容时富文本 → Markdown 的序列化会产生格式微差，触发 `onChange` 把 `dirty` 置真。改为按归一化文本比较（行尾空白、连续空行、首尾回车统一后再比对），状态标签现在准确显示"已同步/未保存"。

### 2.8 知识库空状态

原来是一个撑满 1200px 的虚线大框 + 两行字，看起来像"没加载完"。改成 720px 居中卡片：图标 + 标题 + 说明 + "新建第一个知识库" CTA。


### 2.10 初步测试额外发现的两个后端缺陷（已修）

跑冒烟测试时撞出来的，跟本次前端改版无关，但会直接影响演示：

1. **附件上传在 Windows 上必然失败**（`FileStorageServiceImpl`、`RAGPipelineController`）
   `app.upload.path` 默认是相对路径 `.uploads`，`MultipartFile.transferTo()` 会把它解析到 Tomcat 的 work 目录下：
   `C:\Users\...\Temp\tomcat.8080.xxx\work\Tomcat\localhost\ROOT\.uploads\...` → `FileNotFoundException`，前端只看到"文件保存失败"。
   改为把上传根目录 `toAbsolutePath().normalize()`，并改用 `Files.copy(inputStream, ...)` 落盘（不依赖 `transferTo` 的路径解析）。
2. **访问不存在的接口返回 500**（`GlobalExceptionHandler`）
   Spring 6 的 `NoResourceFoundException` 没被单独处理，落到兜底分支变成"系统内部错误: No static resource api/xxx"。补了一条 404 处理，`GET /api/definitely-not-a-real-endpoint` 现在返回 404。

### 2.9 改动量

```
frontend/src/components/ChatArea.jsx            |   7 +-
frontend/src/components/InputBox.jsx            | 132 ++++++-----
frontend/src/components/KnowledgeBasePanel.jsx  |  11 +-
frontend/src/components/Sidebar.jsx             | 123 +++++----
frontend/src/components/WelcomeScreen.jsx       |  97 ++++++--
frontend/src/components/WritingWorkbench.jsx    | 211 ++++++++++++---
frontend/src/styles/global.css                  |   1 +
frontend/src/styles/theme.css                   | 116 +++++----
frontend/src/styles/redesign.css（新增）        | 1842 行
```

---

## 三、对照课设要求的说法

课程说明里的九阶段（需求 → 系统设计 → 程序设计 → 实现 → 单测/集成/系统测试 → 提交 → 维护），这一轮改动主要落在**系统设计（界面设计与顶层设计）**，同时能反哺另外两处：

- **SRS 的可用性需求**：改版前"导航不可见""空状态与控件矛盾""主按钮像禁用态"，都可以写成非功能需求条目（可见性、状态一致性、就近操作、对比度 ≥ 4.5:1），改版即为其实现与验证。
- **详细设计（模块功能与数据描述）**：`theme.css` 的令牌表 + `redesign.css` 的分区，正好是"界面模块的样式契约"，可以做成文档里的表格。
- **系统测试**：截图对比 + lint/build 结果 + 已测页面清单，是现成的验收证据。

建议在课设文档里把这次改版写成"一次界面评审 + 缺陷修复"，而不是"我觉得这样更好看"——前者有需求、有缺陷编号、有验证。

---

## 四、验证

### 4.1 冒烟测试（37 个用例，37 通过）

脚本：`docs/ui-redesign/smoke_test.py`，原始结果：`docs/ui-redesign/smoke_result.json`。

覆盖：项目/会话/消息/文稿的 CRUD 与版本、附件上传与读取、知识库 CRUD、RAG 文本切分与检索、长期记忆、技能、模板、提示词、输出设置、LLM 供应商、未知路径 404、资源清理。

```
[PASS] 附件上传              POST /attachments/upload        200  129ms   ← 修复前是 400 文件保存失败
[PASS] 未知路径返回404        GET  /xxx                       404   19ms   ← 修复前是 500
== 合计 37/37 通过 ==
```

未通过/未验证的部分（受环境限制，不是代码问题）：

- `/rag/process/text`、`/rag/search` 分别返回 400 / 500 —— 依赖 embedding 模型（DashScope），没有真实 key；
- `/messages/{id}/chat` 返回 **200**，真正的失败发生在异步 SSE 流里（日志里是 DeepSeek `401 invalid api key`）。也就是说：**没有可用 key 时 HTTP 层面看不出问题**，前端要靠 SSE 的错误事件兜底。这一条建议后续在接口上返回可区分的状态（例如 202 + 任务态），否则监控和测试都抓不到。

### 4.2 后端单测

`mvn test` 跑了 132 个用例：**114 通过，18 errors**，全部落在两类环境依赖上，与本次改动无关：

- `GenWriterApplicationTests.contextLoads`、`AgentChatFlowTest`、`AgentIntegrationTest`（共 17 个）需要 `application-real.yaml` profile 与真实 API key，且跑的时候 Docker/Postgres 正好被我重启过 → `Failed to load ApplicationContext`；
- `FixedSizeChunkStrategyTest.testChunkMarkdownFile` 硬编码了作者机器上的路径 `e:\JavaProjects\GenWriter\temp\...`。

纯单元测试（service / chunking / profile / react / streaming）全部通过。

对比图：`docs/ui-redesign/before_after.png`（左：改版前，右：改版后；上：欢迎页，下：对话页）

- 已逐页走过并截图：欢迎页、对话页（含消息 / 表格 / 引用）、版本工作台空态、知识库空态、长期记忆、系统设置。
- `npx vite build`：通过，`dist/` 产物正常（CSS 108.63 kB / gzip 18.30 kB）。
- `npx eslint src`：14 errors（改版前 15），未新增；剩余项为既有代码的 `react-hooks/set-state-in-effect` 与未使用变量，非本次引入。
- 分栏尺寸：1440×900 下侧栏 268 / 中栏 704 / 工作台 460，工作台可拖拽 340–680，收起后为 44px 竖排 rail。

---

## 五、没做 / 风险

1. **没有真实 API Key，AI 生成链路没端到端验证**。目前验证到的是"页面 + 会话/消息/文稿 CRUD + Markdown 渲染"，`deepseek/dashscope` 调用需要你填真实 key 才能跑通；报错态 UI 也还没实测。
2. **信息架构改动较大**（导航从下拉菜单提到一级）。如果你打算给上游提 PR，这一条最可能被 review 挑战，建议单独一个 commit 并说明理由（或者先只提设计层 + bug 修复）。
3. **深色模式、移动端未做**。窄屏只做了收缩与换行处理，没做真正的响应式布局。
4. **没有动后端、没加新功能**。你上一条消息说的是"着重优化前端"，功能层面（例如导出、协作、模型对比）这次没碰。

---

## 六、提交 / PR 建议

我的建议：**先拆后提，别一次性推一个大 diff**。

| 顺序 | commit | 内容 | 风险 |
| --- | --- | --- | --- |
| 1 | `fix(ui): 修复工作台宽度与"未保存"误判` | `ChatArea.jsx`、`WritingWorkbench.jsx` 里两处逻辑修复 | 极低，纯 bug，最容易被接受 |
| 2 | `feat(ui): 引入设计令牌与 redesign 样式层` | `theme.css` + `redesign.css` + `global.css` | 低，纯样式，可整体回滚 |
| 3 | `feat(ui): 重构欢迎页/输入区/工作台/侧栏导航` | 5 个组件文件 | 中，含 IA 变化，需要 reviewer 认可 |

课程提交那边：把 `docs/ui-redesign/` 整个目录（报告 + 前后截图）作为"系统设计/界面设计"章节的附件，比只交源码更符合大纲里"文档为主、源码为辅"的要求。

---

## 附：文件位置

- 仓库：`F:\软工课设\GenWriter`（改版后）、`F:\软工课设\GenWriter-before`（git worktree，改版前，用于对比截图）
- 截图与报告：`F:\软工课设\GenWriter\docs\ui-redesign\`
- 运行中的服务：前端 3000（改版后）/ 3001（改版前 worktree）/ 后端 8080 / Postgres 5432 / Redis 6379
