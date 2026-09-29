# 硅基计划 个人项目介绍 墨衡OJ 全栈+AI能力集成

> 基于SpringCloud Alibaba在线判题平台，覆盖刷题、竞赛与出题管理，并配置Docker容器池判题沙箱并接入Qwen大模型

***

![moheng](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260924155155790.png)

***

> tags: [SpringBoot, SpringCloud Alibaba, Nacos, OpenFeign, MyBatis-Plus, Redis, RabbitMQ, Elasticsearch, XXL-JOB, Sentinel, Zipkin, Docker, Spring AI Alibaba, Vue3, Element Plus, Monaco, ECharts, 前端]

## 项目总览

### 项目简介

**墨衡 OJ** 是一套微服务架构的在线判题平台：学员在学员端刷题、参加竞赛，用 AI 辅导解题、赛后复盘；管理员在管理端管理题目、竞赛、用户与申诉，用 AI 辅助出题、帮建竞赛、分析难题。

判题由独立的 `oj_judge` 服务完成，基于自研的 **Docker 常驻容器池沙箱**；提交走 **RabbitMQ 异步判题**，示例运行走 Feign 同步调用。`oj_ai` 服务经 Spring AI Alibaba 接入通义大模型，提供 B 端 AI 辅助出题与 AI 帮建竞赛、C 端 AI 做题辅导、题目语义检索与相似题推荐、用户资料内容审核。

项目分前后端两个仓库：后端 `online_oj`（网关、C 端、B 端、判题、定时任务、AI 六个服务），前端 `online_oj_vue`（管理端 `oj_fe_b` 与学员端 `oj_fe_c` 两个工程）。

### 系统架构

整张图拆成两半看：第一张是请求怎么在服务之间流转，第二张是各服务落在哪些存储上、向谁注册。

**服务调用**

```mermaid
flowchart TD
    subgraph Client ["客户端"]
        WebUser["C 端学员前台 oj_fe_c（Vue 3）"]
        WebAdmin["B 端管理后台 oj_fe_b（Vue 3）"]
    end

    Gateway["oj-gateway :19090<br/>路由 / JWT 鉴权 / 拦截 internal 路径"]

    subgraph Services ["业务服务"]
        Friend["oj-friend :9202<br/>题库 / 提交 / 竞赛 / 排名 / 消息 / 用户"]
        System["oj-system :9201<br/>题目与用例 / 竞赛编排 / 用户管控"]
        Judge["oj-judge :9204<br/>编译与沙箱执行"]
        Job["oj-job :9203<br/>XXL-JOB 执行器"]
        Ai["oj-ai :9205<br/>模型调用（只计算不写库）"]
    end

    MQ["RabbitMQ 3.13"]
    XXL["XXL-JOB Admin 2.4.0"]
    Pool["Docker 常驻容器池<br/>(oj_worker_*)"]
    Bailian["通义百炼"]

    WebUser --> Gateway
    WebAdmin --> Gateway
    Gateway -->|/friend/**| Friend
    Gateway -->|/system/**| System

    Friend -->|Feign 同步运行示例| Judge
    Friend -->|提交任务| MQ
    MQ -->|判题任务| Judge
    Judge -->|判题结果| MQ
    MQ -->|结果回写| Friend
    Judge --> Pool

    System -->|Feign 刷新缓存 / 索引| Friend
    System -->|Feign AI 出题| Ai
    System -->|Feign 运行标程| Judge
    Friend -->|WebClient 流式辅导| Ai
    Friend -->|Feign 向量 / 审核| Ai
    Ai --> Bailian
    XXL -->|调度| Job
    Job -->|Feign 竞赛结算 / 缓存刷新| Friend
```

**存储与注册中心**

```mermaid
flowchart LR
    subgraph Services ["服务"]
        Gateway["oj-gateway"]
        Friend["oj-friend"]
        System["oj-system"]
        Job["oj-job"]
        Judge["oj-judge"]
        Ai["oj-ai"]
    end

    subgraph Storage ["存储"]
        MySQL[("MySQL 8.4")]
        Redis[("Redis")]
        ES["Elasticsearch 8.18.8 + IK"]
    end

    Nacos["Nacos 3.2.4<br/>服务注册 / 配置中心"]

    Friend --> MySQL
    Friend --> Redis
    Friend --> ES
    System --> MySQL
    System --> Redis
    Job --> MySQL
    Gateway --> Redis

    Gateway -.-> Nacos
    Friend -.-> Nacos
    System -.-> Nacos
    Judge -.-> Nacos
    Job -.-> Nacos
    Ai -.-> Nacos
```

- 前端只经网关访问 friend 与 system；judge、job、ai 不对外暴露，AI 能力由 friend / system 转发并负责权限与次数。
- 服务间调用走"provider 契约 + 调用方本地 Feign 客户端"：契约放 `oj_api`，调用方在自己的 `client` 包中实现 Feign 与降级；内部接口统一为 `/{domain}/internal/**`，网关拒绝外部访问。
- 题目 ES 索引、竞赛缓存等只由 friend 维护；system、job 修改数据后通过内部接口通知 friend 刷新。

### 工程结构

后端仓库 `online_oj`：

```text
online_oj/
├── deploy/                          # 本地编排与初始化脚本
│   ├── docker-compose.yml           # MySQL、Redis、Nacos、RabbitMQ、ES、Kibana、XXL-JOB Admin、Zipkin
│   ├── .env.example                 # compose 所需密钥模板（复制为 .env，不入库）
│   ├── db_sql/oj_init.sql           # 业务库表结构 + 演示数据 + XXL-JOB 库（MySQL 首次启动自动执行，可重复执行）
│   ├── nacos/nacos_v3_init.sql      # Nacos 3.x 配置库表结构（在业务库脚本之后自动执行）
│   ├── nacos/config/                # 各服务的 Nacos 配置模板（密钥引用 OJ_ 环境变量，不含真实值）
│   ├── docs/                        # 模型价格等参考资料
│   └── dev/                         # ES（IK 插件与自定义词典）、Kibana 配置
├── oj_api/                          # 跨服务契约：内部接口、DTO / VO、MQ 常量、契约枚举
├── oj_common/                       # 技术公共库（不含业务归属）
│   ├── oj_common_core/              # 统一响应、异常、工具类、ThreadLocal 上下文
│   ├── oj_common_security/          # JWT、TokenService、令牌拦截器
│   ├── oj_common_redis/             # RedisService 封装
│   ├── oj_common_mybatis/           # MyBatis-Plus 配置与自动填充
│   ├── oj_common_elastic/           # ES 客户端配置与题目文档
│   ├── oj_common_sentinel/          # Sentinel 依赖、调用保护工具与 YAML 规则转换器
│   ├── oj_common_message/           # 阿里云短信
│   ├── oj_common_swagger/           # springdoc-openapi
│   └── oj_gateway/                  # Spring Cloud Gateway（端口 19090）
└── oj_modules/                      # 业务服务
    ├── oj_friend/                   # C 端服务
    ├── oj_system/                   # B 端服务
    ├── oj_judge/                    # 判题服务
    ├── oj_job/                      # 定时任务执行器
    └── oj_ai/                       # AI 服务（Spring AI Alibaba，只做模型计算）
```

前端仓库 `online_oj_vue`：

```mermaid
graph TD
    Repo["online_oj_vue"] --> B["oj_fe_b 管理端 :5173"]
    Repo --> C["oj_fe_c 学员端 :5174"]
    B --> BM["数据概览 · 难题分析 / 用户 / 题目与标签 / 竞赛 / 申诉"]
    C --> CM["题库 / 做题工作台 · AI 辅导 / 竞赛 · 赛后复盘 / 消息 / 个人中心"]
    B -- "Vite 代理 /dev-api" --> GW["网关 127.0.0.1:19090"]
    C -- "Vite 代理 /friend" --> GW
```

```text
online_oj_vue
├── oj_fe_b                 管理端
│   └── src
│       ├── api             按业务拆分的接口（overview、question、exam、appeal …）
│       ├── components      通用组件（OjDialog、CodeEditor、MarkdownEditor、AiGlowBorder …）
│       ├── constants       与后端枚举对齐的业务常量
│       ├── styles          全局样式与变量
│       └── views           页面（overview、user、question、exam、appeal）
└── oj_fe_c                 学员端
    └── src
        ├── api
        ├── components      AppNavbar、AiTutorPanel、AppealDialog …
        ├── constants
        ├── store           登录态
        ├── utils           request、sse、题面解析 …
        └── views           页面（question、exam、message、user）
```

## 功能一览

### 管理端（oj_fe_b）

| 模块 | 功能 |
|---|---|
| 数据概览 | 今日与近 7 天的提交数、活跃用户；提交趋势（近 7 天 / 14 天 / 一个月按天，近半年按周，近一年按半月）；最近竞赛的报名与参赛统计；难题榜 |
| 难题分析 | 对提交满 5 条的题做整体分析：出题质量提醒（失败集中在单个用例或申诉成立的题）、按标签的通过率最低 / 最高饼图、主要错误类型；数字由 SQL 统计，文字结论由 AI 归纳，结果缓存，手动重新分析 |
| 用户管理 | 学员列表检索、资料查看、拉黑与解禁 |
| 题目管理 | 题目增删改查、标签管理、题目预览（与学员端题面一致）；Markdown 题面、Monaco 代码模板、结构化用例、官方题解；AI 出题、AI 生成用例（标程在判题沙箱实跑得到输出）、AI 解法示例、AI 生成题解；修改用例后可按题重判 |
| 竞赛管理 | 竞赛创建、选题、发布与撤销；AI 帮建（按描述、难度倾向与题量挑题） |
| 申诉管理 | 查看学员申诉（申诉理由、AI 初审分析、代码与逐用例输入 / 预期 / 实际输出），裁定为存疑、通过（改判为通过并通知学员）或不通过 |

### 学员端（oj_fe_c）

| 模块 | 功能 |
|---|---|
| 登录 | 手机号验证码登录，未注册自动建号 |
| 题库 | 难度、标签、关键词筛选；关键词无结果时给出语义推荐，长句检索融合关键词与语义结果；做题统计 |
| 做题工作台 | 题面与官方题解、Monaco 编辑器、运行示例、提交判题、逐用例结果、提交记录与载回代码、跨设备代码草稿；对判错有异议时可提交申诉（先经 AI 初审） |
| AI 辅导 | 指点迷津、优化思路、分析最近一次提交、解释编译错误、点评代码与自由提问，SSE 流式输出，只给思路不给完整代码 |
| 竞赛 | 竞赛列表、报名、赛中答题（倒计时、计入排名）、赛后练习、排名榜 |
| 赛后复盘 | 「我的竞赛」中已结束且有提交的竞赛，封面右上角打开复盘：成绩概览、AI 总结、逐题回顾与点评；每场可重新生成 3 次 |
| 消息中心 | 系统通知、竞赛通知（战报）、审核通知（申诉结果），已读未读 |
| 个人中心 | 资料编辑、头像、做题统计与能力雷达 |

## 技术亮点

### Docker 常驻容器池判题沙箱

- 启动时预热一组常驻容器（默认 3 个），判题时借出、用完归还，省掉每次 `docker run` 的冷启动。
- 每次评测用 `docker cp` 把代码拷进容器私有目录，不挂载宿主机目录，容器之间不共享文件。
- 全部用例经标准输入一次性喂入，只编译一次、只启动一次 JVM，输出逐行比对；程序中途异常时，从首行起连续匹配的行视为通过，据此定位首个失败用例。
- 容器断网（`--network none`）、进程数上限 64、内存 256 MB（swap 同值）、1 个 CPU；输出由独立线程读取并设上限，超出判为输出超限。
- 超时或清理失败的容器直接淘汰并补位；服务重启时清理上次残留的容器。

### RabbitMQ 异步判题

- 提交时先写入"评测中"的提交记录，再把任务投递到判题队列，前端轮询结果。
- judge 消费任务并在沙箱中执行，结果经结果队列回传，friend 监听后回写提交记录。
- "运行示例"不落库，friend 通过 Feign 同步调用 `/judge/internal/run`。

### 竞赛排名与只执行一次的结算

- 排名规则：总分降序 → 通过题数降序 → 最后提交时间升序 → 用户 ID 升序；每题取选手最高分。
- 排名缓存分两档：进行中 3 分钟、已结束 24 小时；查看排名只读不写库。
- XXL-JOB 调度 job 服务调用 friend 的结算接口：先用条件更新抢占"已结算"标记，任务重叠或重试也只结算一次；每场独立事务，战报的未读计数在事务提交后才写入 Redis。

### 题目搜索与降级

- 题目搜索走 ES，标题与描述使用 IK 分词（含自定义算法词典）；检索词达到 10 个字（`oj.ai.search.long-query-length`）时按长句处理，关键词与 kNN 语义两路结果按排名倒数融合后分页，避免常用词把不相干的题排到前面；短关键词无结果时，首页用题目向量做 kNN 语义推荐（按相似度阈值过滤无关结果），同一份向量也用于相似题推荐。
- 题目向量随索引同步生成，文本未变化的题目复用已有向量；friend 启动后会在后台同步一次。
- 索引为空时自动从数据库全量同步；后台改题后同步并清掉已删除的题目；ES 不可用时直接查 MySQL，搜索不中断。

### AI 能力（oj_ai，只计算不写库）

- B 端：AI 出题（题面草稿）、AI 生成用例（模型只出输入，预期输出由解法在判题沙箱实跑得到）、AI 解法示例；AI 帮建竞赛：模型理解描述 → friend 向量 + 关键词混合检索候选 → 模型按难度配比挑题 → system 校验、补齐并由易到难回填表单。
- C 端：做题辅导对话（SSE 流式、每日次数、竞赛中禁用、只给思路不给完整代码）、语义检索与相似题推荐、昵称 / 个人介绍 / 头像同步审核（审核服务不可用时放行）。
- 模型调用失败时 oj_ai 返回非 2xx，调用方在本地 client 转换为明确的业务错误码，不伪造结果。

### 链路追踪

- Micrometer Tracing + Brave 上报 Zipkin：网关、各服务的 HTTP 入口、Feign 调用、friend 调 oj_ai 的流式 WebClient、RabbitMQ 发送与监听都自动传播追踪头，一次提交在 Zipkin 中是一条完整链路：网关 → friend → MQ → judge → MQ → friend。
- 日志带 `traceId` / `spanId`，拿 Zipkin 里的 traceId 可以直接在各服务日志中检索同一次请求。
- 采样率与 Zipkin 地址放在所有服务共用的 Nacos 配置 `oj-common-local.yaml`，本地全量采样。

### 熔断限流（Sentinel）

- 只加在调用方 `client` 包的跨服务同步调用上，不统计全部 Web 接口、不做网关限流、不部署控制台（已去掉 8719 端口上无鉴权的规则读写接口）；规则以 YAML 写在 Nacos，由 `oj_common_sentinel` 的转换器解析，改规则不用重启。
- 被限流或熔断时沿用各调用边界原有的失败语义，不伪造成功：

| 资源 | 调用 | 规则（初始值，按链路追踪实测耗时调整） | 被拦截时 |
| :--- | :--- | :--- | :--- |
| `friend-judge-run` | friend 运行示例 → judge | 并发 10；慢调用（> 5s）过半熔断 10s | 返回系统错误结果"判题服务繁忙" |
| `friend-ai-tutor` | friend AI 辅导流 → oj_ai | 并发流 20；异常过半熔断 30s（AI 返回的错误事件也计入） | 推送错误事件"AI 服务繁忙"并归还次数 |
| `friend-ai-embedding` | friend 向量计算 → oj_ai | 慢调用（> 3s）过半熔断 30s | 按没有向量处理，只走关键词检索 |
| `friend-ai-moderation` | friend 资料审核 → oj_ai | 慢调用（> 5s）过半熔断 30s | 放行并记录告警（与审核服务不可用一致） |
| `system-ai` | system AI 出题 / 帮建 → oj_ai | 并发 5；异常过半熔断 60s | 返回 3401"AI 服务繁忙" |
| `system-judge-run` | system 运行标程 → judge | 并发 5；慢调用（> 10s）过半熔断 30s | 返回"判题服务暂不可用" |

- 熔断需在统计窗口内至少 5 次调用（system 为 3 次）才会判断；并发数按同时在途的调用计，同一瞬间涌入的请求可能一起通过，这是 Sentinel 先检查后计数的特性。

### 身份透传与用户状态拦截

- 网关校验令牌后，先移除外部传入的身份头，再写入 `userId` / `userKey` 传给下游，防止伪造身份。
- 下游经拦截器放入 `ThreadLocal`，业务只从上下文取身份，不信任前端传入的用户 ID。
- 提交代码、报名竞赛等受保护操作标注 `@CheckUserStatus`，由切面统一拦截被拉黑用户。
- 会话存于 Redis 并滑动续期；C 端支持主动退出登录使会话失效。

## 技术栈

### 后端

| 类别 | 技术 | 版本 |
| :--- | :--- | :--- |
| 语言 | Java | 17 |
| 框架 | Spring Boot | 3.5.16 |
| 微服务 | Spring Cloud / Spring Cloud Alibaba | 2025.0.3 / 2025.0.0.0 |
| 注册与配置 | Nacos（客户端 3.0.3） | 3.2.4 |
| 网关 | Spring Cloud Gateway（WebFlux） | 4.3.5 |
| 服务调用 | OpenFeign + LoadBalancer | 随 Spring Cloud |
| 持久层 | MyBatis-Plus / PageHelper | 3.5.17 / 2.1.1 |
| 数据库 | MySQL | 8.4 |
| 缓存 | Redis | latest |
| 消息队列 | RabbitMQ | 3.13 |
| 搜索 | Elasticsearch + IK 分词 / Kibana | 8.18.8 |
| 定时调度 | XXL-JOB | 2.4.0 |
| 链路追踪 | Micrometer Tracing + Brave / Zipkin | 1.5.12 / 3 |
| 熔断限流 | Sentinel（Nacos 规则数据源） | 1.8.9 |
| 判题沙箱 | Docker（CLI 调用，常驻容器池） | — |
| 认证 | JJWT + Redis 会话 | 0.9.1 |
| 接口文档 | springdoc-openapi | 2.8.17 |
| 工具 | Hutool / Fastjson2 / Lombok | 5.8.22 / 2.0.43 / 随 Boot |
| AI | Spring AI Alibaba（通义百炼：qwen3.7-max / qwen3.7-flash / text-embedding-v4） | 1.1.2.3 |

### 前端

| 类别 | 技术 | 版本 |
| :--- | :--- | :--- |
| 框架 | Vue 3 | 3.5 |
| 路由 | Vue Router | 管理端 5.2 / 学员端 4.5 |
| 组件库 | Element Plus | 2.14 |
| 代码编辑器 | Monaco Editor（`@guolao/vue-monaco-editor` 封装） | 0.56 |
| 图表 | ECharts（管理端数据概览与难题分析） | 6.1 |
| 构建 | Vite | 8.1 |

## 管理端（B 端 oj_fe_b）

### 界面展示

**登录**

![image-20260927231124354](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231124597.png)

**数据概览**

![image-20260927231207113](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231241823.png)

**难题分析**

![image-20260927231307548](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231307604.png)

**用户管理**

![image-20260927231324730](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231324792.png)

**题目管理**

![image-20260927231337067](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231337120.png)

**题目编辑与 AI 出题**

![image-20260927231353110](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231353183.png)

**竞赛管理与 AI 帮建**

![image-20260927231451814](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231451883.png)

**申诉管理**

![image-20260927231524164](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231524228.png)

![image-20260927231534530](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231534607.png)

### 路由与页面

```mermaid
flowchart TD
    Router["Vue Router"] --> Guard{"Token 路由守卫"}
    Guard --"未登录"--> Login["/login 登录"]
    Guard --"已登录"--> Layout["/system 工作台（顶栏 + 侧边栏）"]

    Layout --> Overview["/overview 数据概览"]
    Overview --> Trend["TrendPanel 提交趋势"]
    Overview --> ExamPanel["ExamPanel 最近竞赛"]
    Overview --> Hard["难题榜 → HardAnalysisDialog 难题分析"]

    Layout --> User["/user 用户管理 → UserEditDialog"]

    Layout --> Question["/question 题目管理"]
    Question --> Tag["TagManageDialog 标签管理"]
    Question --> Preview["QuestionPreview 题目预览"]
    Question --> Drawer["QuestionDrawer 题目抽屉"]
    Drawer --> AiDraft["QuestionAiDraftDialog AI 出题"]
    Drawer --> AiCase["QuestionAiCaseDialog AI 生成用例"]

    Layout --> Exam["/exam 竞赛管理 → ExamDrawer"]
    Exam --> ExamQ["ExamQuestionDialog 选题"]
    Exam --> AiPlan["ExamAiPlanDialog AI 帮建"]

    Layout --> Appeal["/appeal 申诉管理 → AppealDetailDialog"]
```

### AI 辅助出题

题目抽屉里的「AI 出题」「AI 生成用例」「AI 解法示例」「AI 生成题解」只回填表单，保存仍走原有流程；生成中弹窗或区域边框播放流光。

```mermaid
flowchart LR
    Desc["一句话描述"] --> Draft["AI 生成题面草稿"]
    Draft --> Fill["回填标题、难度、限制、描述、代码模板与 main 函数"]
    Fill --> Gen["AI 给出解法与用例输入"]
    Gen --> Run["解法在判题沙箱实跑得到预期输出"]
    Run --> Pick["预览并勾选，加入用例列表"]
    Pick --> Save["保存题目；改过用例时提示按题重判"]
```

### AI 帮建竞赛

```mermaid
flowchart LR
    Input["描述 + 难度倾向 + 题目数量"] --> Intent["AI 理解需求：名称、主题、题数"]
    Intent --> Recall["按难度配比混合检索候选（向量 + 关键词）"]
    Recall --> Pick["AI 挑题，后端校验并补齐"]
    Pick --> Fill["回填名称与题目，设置周期后保存"]
```

### 申诉处理

```mermaid
sequenceDiagram
    autonumber
    actor S as 学员
    participant C as 学员端
    participant AI as AI 初审
    actor A as 管理员
    participant B as 申诉管理

    S->>C: 对未通过的提交发起申诉
    C->>AI: 核对题面、用例与代码
    AI-->>C: 认为可能判错才放行
    S->>C: 填写理由，提交申诉
    A->>B: 查看理由、AI 分析、逐用例输入 / 预期 / 实际输出
    A->>B: 裁定：存疑 / 通过 / 不通过（可改判）
    B-->>S: 审核通知；通过时该提交改判为通过
```

### 难题分析

```mermaid
flowchart LR
    Open["难题榜「AI 分析」"] --> Cache{"有上次结果？"}
    Cache --"有"--> Show["直接显示，底部可重新分析"]
    Cache --"没有"--> Stat["统计提交满 5 条的题：单题、按标签、按判题结论"]
    Stat --> Suspect["挑出可疑题并抽查失败代码"]
    Suspect --> AI["AI 归纳薄弱点、错误类型并判断可疑题"]
    AI --> Save["缓存结果并显示"]
```

## 学员端（C 端 oj_fe_c）

### 界面展示

**登录**

![image-20260927231600624](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231600674.png)

**题库**

![image-20260927231629603](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231629693.png)

**做题工作台与 AI 辅导**

![image-20260927231708043](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231708093.png)

**提交申诉**

![image-20260927231731801](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231731867.png)

**竞赛与排名**

![image-20260927231749970](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231750032.png)

![image-20260927231759641](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231759716.png)

**赛后复盘**

![image-20260927231846525](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231846581.png)

**个人中心**

![image-20260927231926061](https://zlhimage.oss-cn-guangzhou.aliyuncs.com/20260927231926142.png)

### 路由与页面

```mermaid
flowchart TD
    Router["Vue Router"] --> Guard{"Token 路由守卫"}
    Router --> Title["afterEach：标签页标题「页面名 · 墨衡 OJ」"]

    subgraph Public["免登录可访问"]
        QList["/question 题库"]
        QDo["/question/do 做题工作台"]
        EList["/exam 竞赛"]
    end

    subgraph Private["登录后可访问"]
        MyExam["/my-exam 我的竞赛"]
        Msg["/message 消息中心"]
        Profile["/user/profile 个人中心"]
    end

    Guard --> Public
    Guard --> Private
    Guard --"未登录访问受保护页"--> Login["/login 登录"]

    QList --> QDo
    EList --"开始答题 / 竞赛练习"--> QDo
    MyExam --"开始答题 / 竞赛练习"--> QDo
    EList --> Rank["ExamRankDialog 排名"]
    MyExam --> Rank
    MyExam --"已结束且有提交"--> Review["ExamReviewDialog 赛后复盘"]
    QDo --> Tutor["AiTutorPanel AI 辅导"]
    QDo --> AppealDlg["AppealDialog 提交申诉"]
```

### 工程分层

```mermaid
flowchart LR
    subgraph View["views（.vue / .js / .scss 三文件分离）"]
        Pages["页面组件"]
    end
    subgraph Comp["components"]
        Navbar["AppNavbar 全局导航"]
        Editor["CodeEditor Monaco 封装"]
        Dialog["OjDialog 统一弹窗"]
        Glow["AiGlowBorder AI 流光边框"]
    end
    subgraph Data["数据层"]
        Store["store/user 登录态与用户信息"]
        Api["api/* 按业务拆分的接口"]
        Request["utils/request 令牌注入 · 统一错误提示 · 响应脱壳"]
        Sse["utils/sse AI 辅导流式读取"]
    end
    Pages --> Comp
    Pages --"Actions"--> Store
    Pages --> Api --> Request
    Pages --> Sse
    Request --"Vite 代理"--> Gateway["网关 :19090"]
```

### 运行与提交

```mermaid
sequenceDiagram
    autonumber
    actor U as 学员
    participant Do as 做题工作台
    participant API as 网关 /friend

    U->>Do: 运行 / 提交
    alt 运行（只跑公开示例，不计分）
        Do->>API: POST /question/{questionId}/run
        API-->>Do: 结论 + 逐用例输入 / 输出 / 预期
    else 提交（全部用例）
        Do->>API: POST /question/{questionId}/submissions
        API-->>Do: submitId（评测中）
        loop 轮询直到出结论
            Do->>API: GET /question/submissions/{submitId}
        end
        API-->>Do: 结论 · 通过数 · 得分 · 逐用例状态 · 首个未通过用例
    end
```

### 竞赛与赛后复盘

```mermaid
flowchart TD
    List["竞赛 / 我的竞赛"] --> Phase{"竞赛阶段"}
    Phase --"未开赛"--> Enroll["报名（未登录先引导登录）"]
    Phase --"进行中且已报名"--> Contest["赛中答题：倒计时，提交计入排名"]
    Phase --"已结束"--> Practice["竞赛练习：提交不影响排名"]
    Phase --"已结束"--> Rank["排名榜"]
    Phase --"已结束、已结算且本人有提交"--> Review["赛后复盘"]
    Review --> First{"已有复盘且提交结果没变？"}
    First --"是"--> Show["直接显示"]
    First --"否"--> Gen["统计成绩与逐题情况，AI 写点评与总结"]
    Show --> Regen["不满意可重新生成（每场 3 次）"]
```

## API 路由总览

通过统一网关（`http://127.0.0.1:19090`）访问各微服务，主要功能路由如下。

### C 端用户与竞赛接口（`/friend/**`）

* `POST /friend/user/send-code`、`POST /friend/user/login`、`DELETE /friend/user/logout`：短信验证码登录（新用户自动注册）与退出登录
* `GET|PUT /friend/user/profile`、`POST /friend/user/avatar`：个人资料与头像（昵称、个人介绍、头像变更前做内容审核，审核服务不可用时放行）
* `GET  /friend/user/profile/overview`、`GET /friend/user/profile/calendar`：做题统计、能力雷达与解题日历
* `GET  /friend/question`：题库分页检索，只出刷题题（关键字、难度、标签分类 `tagCategory`、标签 `tagId`、做题状态 `userStatus`；只选分类时返回该分类下任一标签的题目，做题状态只对登录用户生效）
* `GET  /friend/question/tags`：全部题目标签（题库筛选用）
* `GET  /friend/question/{questionId}/editorial`：官方题解（免登录；竞赛题在所在竞赛全部结束前不提供，没有题解时 data 为空）
* `GET  /friend/question/{questionId}`：单题详情与公开示例（竞赛题只能从竞赛进入：需带已开赛且包含该题的 `examId`）
* `GET  /friend/question/{questionId}/neighbors`：上一题、下一题导航（可带 `examId`）
* `GET  /friend/question/{questionId}/similar`：相似题推荐（需登录，排除当前题与已通过的题）
* `GET|PUT /friend/question/{questionId}/draft`：本人在本题的代码草稿（跨设备保存，AI「帮我优化代码思路」读取已保存的代码）
* `GET  /friend/question/first`、`GET /friend/question/stats`：首题与题库统计
* `POST /friend/question/{questionId}/run`：同步运行公开示例（不落库）
* `POST /friend/question/{questionId}/submissions`：提交代码并异步判题
* `GET  /friend/question/{questionId}/submissions`：本人本题提交记录分页
* `GET  /friend/question/submissions/{submitId}`：查询单次提交的判题结果
* `GET  /friend/exam`：竞赛列表（`type` 为 0 未完赛、1 历史竞赛）
* `GET  /friend/exam/{examId}`：竞赛详情
* `POST /friend/exam/{examId}/enrollment`：报名竞赛
* `GET  /friend/exam/mine`：我报名的竞赛
* `GET  /friend/exam/stats?mine=`：竞赛状态统计（全部或已报名，不受列表筛选影响）
* `GET  /friend/exam/{examId}/rank`：竞赛排名（竞赛结束后公布）
* `GET|POST /friend/exam/{examId}/review`、`POST /friend/exam/{examId}/review/regeneration`：赛后复盘（竞赛已结束且已结算、本人有提交；第一次打开时生成，本人提交结果变化后自动重新生成；学员每场可手动重新生成 3 次；成绩与逐题统计由 SQL 得出，AI 只写点评与总结，不给代码、不透露隐藏用例）
* `GET  /friend/message`、`GET /friend/message/unread-count`：站内消息（支持 type 类型、keyword 关键词筛选）与未读数
* `PUT  /friend/message/{messageId}/read`、`PUT /friend/message/read/all`：标记已读
* `GET  /friend/ai/tutor/{questionId}`：AI 辅导会话（历史消息、今日剩余次数、快捷操作所需的提交状态）
* `POST /friend/ai/tutor/{questionId}/chat`：AI 辅导提问，SSE 流式返回（`delta` / `done` / `error`）；每人每天 50 次（剩余不超过 5 次时前端才显示），在进行中的竞赛里答题（携带 examId）时拒绝
* `GET  /friend/appeal/quota`、`POST /friend/appeal/review/{submitId}`、`POST /friend/appeal`：提交申诉（先由 AI 初审，每天 10 次；初审认为可能判错才能正式申诉，每天 5 次，须填理由；练习提交与已结束竞赛的提交可申诉，每条提交只能申诉一次）

### B 端管理系统接口（`/system/**`）

* `POST /system/sysUser/login`、`DELETE /system/sysUser/logout`、`GET /system/sysUser/me`：管理员登录、退出与当前信息
* `POST /system/sysUser`、`DELETE /system/sysUser/{userId}`：新增、删除管理员
* `GET|POST /system/question`、`GET|PUT|DELETE /system/question/{questionId}`：题目管理（列表可按用途、标签分类或标签筛选；保存时带用途、标签与官方题解，用途只能由竞赛改为刷题且所在竞赛都已结束；详情也用于管理端题目预览）
* `GET|POST /system/tag`、`PUT|DELETE /system/tag/{tagId}`：题目标签管理（删除为逻辑删除，并移除题目上的该标签）
* `POST /system/question/ai/draft`、`POST /system/question/ai/cases`、`POST /system/question/ai/solution`、`POST /system/question/ai/editorial`：AI 出题（同时从现有标签中建议 1~3 个）、AI 生成用例、AI 解法示例、AI 题解草稿（用例的预期输出由解法在沙箱实跑得到；未传标程时先由 AI 生成解法；均不落库）
* `POST /system/exam/ai/plan`：AI 帮建竞赛（按描述、难度倾向与题目数量生成竞赛名称和题目，不落库）
* `GET|POST /system/exam`、`GET|PUT|DELETE /system/exam/{examId}`：竞赛管理
* `PUT|DELETE /system/exam/{examId}/publish`：发布、撤销发布竞赛
* `GET|POST /system/exam/{examId}/questions`、`DELETE /system/exam/{examId}/questions/{questionId}`：竞赛题目编排（只能添加竞赛题，已在结束的竞赛中公开过的题不能再用）
* `GET  /system/user`、`PUT /system/user/{userId}`、`PUT /system/user/{userId}/status`：C 端用户列表、资料编辑（手机号唯一）与拉黑解禁
* `GET  /system/appeal`、`GET /system/appeal/{appealId}`、`PUT /system/appeal/{appealId}/handle`：申诉管理（按用户 ID、题目名称、最近天数筛选，按申诉时间倒序；详情含申诉理由、AI 初审分析、代码与逐用例输入/预期/实际输出；裁定为存疑、通过（改判为通过并通知学员）或不通过（驳回并通知））
* `GET  /system/overview`、`GET /system/overview/trend?range=`、`GET /system/overview/exam?days=&pageNum=&pageSize=`：数据概览（今日与近 7 天的提交数、活跃用户与难题榜；提交趋势（range 为 WEEK / TWO_WEEKS / MONTH 按天，HALF_YEAR 按周，YEAR 按半月）；近 N 天（1 ~ 30）内进行过的竞赛的去重报名、参赛人数与分页列表；通过率分母为已出结论的提交，人数按用户去重）
* `GET|POST /system/overview/hard-analysis`：难题分析（对已出结论的提交满 5 条的题统计出题质量提醒（失败集中在单个隐藏用例、或有成立的申诉；卡在公开示例上不算）、按标签的通过率最低与最高、判题结论分布，由 AI 归纳结论并判断可疑题；少于 3 道题时不调用 AI；结果存 Redis 不过期，POST 重新分析时覆盖）
* `GET|POST /system/submit/rejudge/{questionId}`：按题重判的影响范围预览与执行（入口在题目抽屉：修改用例保存后提示）（重判练习提交和未结算竞赛的提交，已结算竞赛与评测中的跳过）

### 服务间内部接口（`/{domain}/internal/**`，网关屏蔽）

* `POST /judge/internal/run`：friend 同步运行示例、system 运行标程得到用例输出
* `POST /ai/internal/question/draft`、`POST /ai/internal/question/case-inputs`、`POST /ai/internal/question/solution`、`POST /ai/internal/question/editorial`：system 调用 AI 生成题面草稿、用例输入、解法与题解草稿
* `POST /ai/internal/appeal/review`：friend 发起申诉 AI 初审（只判断判题或用例是否可能有误，分析只给管理员看）
* `POST /ai/internal/review/exam`：friend 生成赛后复盘的逐题点评与整体总结
* `POST /ai/internal/analysis/hard-questions`：system 难题分析时归纳薄弱点、错误类型并判断可疑题
* `POST /ai/internal/tutor/chat`：friend 以 WebClient 流式调用 AI 辅导（Feign 不支持流式，路径常量在 `AiInternalPaths`）
* `POST /ai/internal/exam/intent`、`POST /ai/internal/exam/select`：system AI 帮建竞赛时理解需求、从候选中挑题
* `POST /ai/internal/embedding`：friend 计算题目与查询词向量
* `POST /ai/internal/moderation/text`、`POST /ai/internal/moderation/image`：friend 审核用户资料文本与头像
* `POST /friend/internal/user/{userId}/cache/evict`：system 修改用户状态后清除缓存
* `POST /friend/internal/question/refresh`：system 题目变更后刷新题目缓存与 ES
* `POST /friend/internal/question/candidates`：system AI 帮建竞赛时混合检索候选题目（向量 + 关键词）
* `POST /friend/internal/exam/cache/refresh`：system 竞赛变更后、job 定时刷新竞赛缓存
* `POST /friend/internal/exam/rank/settle`：job 定时结算已结束竞赛（竞赛里还有 10 分钟内投递、尚未回写的提交时推迟到下一轮）
* `GET  /friend/internal/stats/hard-analysis`、`GET /friend/internal/stats/failed-samples`：system 难题分析取统计数字与失败代码样本
* `POST /friend/internal/appeal/list`、`GET /friend/internal/appeal/{appealId}`、`POST /friend/internal/appeal/{appealId}/handle`、`POST /friend/internal/appeal/upheld-stats`：system 申诉管理（申诉与提交归 friend，裁定为通过时由 friend 改判并发消息；统计用于题目列表的「申诉成立、待修题」标记）
* `GET /friend/internal/stats/overview`、`GET /friend/internal/stats/trend`、`POST /friend/internal/stats/exam`：system 数据概览的统计汇总、每日趋势、指定竞赛的报名与参赛人数（提交与报名数据归 friend；竞赛按时间段筛选与分页在 system，system 补题目与竞赛信息）
* `GET /friend/internal/submit/rejudge/preview`、`POST /friend/internal/submit/rejudge`：system 按题重判（逐条改回评测中再投递判题队列，重复点击不会重复投递）
* `POST /system/internal/question/publish`：job 定时公开已结束竞赛的题目（所在竞赛全部结束的竞赛题改为刷题，进入 C 端题库）

## 本地运行

### 环境准备

JDK 17、Maven 3.8+、Docker Desktop、Node.js 18+。

### 启动中间件

```powershell
cd deploy
copy .env.example .env   # 首次部署：填写 OJ_NACOS_AUTH_* 等密钥
docker compose up -d
```

首次启动须知：

- MySQL 数据卷首次创建时自动执行 `db_sql/oj_init.sql`（业务库 `bitoj_dev`、演示数据、调度库 `xxl_job`）和 `nacos/nacos_v3_init.sql`（Nacos 配置库 `bitoj_nacos_v3`）；已有数据卷不会重复执行，需要时手动执行，脚本可重复执行且不覆盖已有数据。
- 演示数据：30 道题（刷题 20、竞赛题 10；简单 12 / 中等 13 / 困难 5，含标签与 15 篇题解；用例的预期输出由参考解经判题服务实跑得到）、6 场竞赛（时间以初始化时刻为基准：2 场已结算、1 场刚结束待结算、进行中、未开始、未发布各一场）、20 个学员、近一年约 780 条提交（判题字段来自对参考解与各类错误代码的实跑结果）、7 条申诉与站内消息。管理端账号 `admin / 123456`，学员端手机号 `13800000001` ~ `13800000020`（`13800000008` 为拉黑账号），XXL-JOB 调度中心 `admin / 123456`。
- IK 分词插件需与 ES 同版本（8.18.8），放在 `deploy/dev/elasticSearch/es-plugins/ik`；jar 包不入库，从 INFINI Labs 发布页下载后解压到该目录，保留其中的 `config/` 词典。
- compose 与各服务读取的环境变量都带 `OJ_` 前缀，避免与本机其他项目的 `NACOS_*` 变量冲突。

### 本地端口

| 组件 | 地址 | 说明 |
| :--- | :--- | :--- |
| MySQL | `127.0.0.1:3308` | 业务库 `bitoj_dev`，Nacos 配置库 `bitoj_nacos_v3` |
| Redis | `127.0.0.1:6379` | |
| Nacos | `127.0.0.1:8848` / `9848` | 控制台 `http://127.0.0.1:18848`，首次打开设置管理员密码；命名空间 `8f599ee1-85ee-45b3-8435-1522e90fb2e0` |
| RabbitMQ | `127.0.0.1:5672` | 控制台 `http://127.0.0.1:15672` |
| Elasticsearch | `127.0.0.1:9200` | Kibana `http://127.0.0.1:15601` |
| Zipkin | `http://127.0.0.1:9411` | 调用链查询（内存存储，重启后清空） |
| XXL-JOB Admin | `http://127.0.0.1:18080/xxl-job-admin` | 初始化脚本已登记执行器 `oj-job-executor` 与两个任务（刷新竞赛列表、结算排名） |
| 管理端前端 | `http://localhost:5173` | Vite 开发服务器 |
| 学员端前端 | `http://localhost:5174` | Vite 开发服务器 |

各组件账号密码见 `docker-compose.yml` 与 `deploy/.env`。

### 配置说明

- 各服务的 `application.yml` 只保留启动必需项：应用名、profile、Nacos 地址与命名空间（`OJ_NACOS_SERVER_ADDR`、`OJ_NACOS_NAMESPACE`，未设置时用本地默认值）以及 `spring.config.import`。
- 其余配置（数据库、Redis、MQ、ES、JWT 密钥、OSS、短信、网关路由与白名单、判题参数等）都在 Nacos，模板在 `deploy/nacos/config/`：在 Nacos 控制台新建 ID 为 `8f599ee1-85ee-45b3-8435-1522e90fb2e0` 的命名空间（或自建后设置 `OJ_NACOS_NAMESPACE`），按文件名创建同名 Data ID（Group `DEFAULT_GROUP`，格式 YAML）并粘贴内容：

| Data ID | 使用方 |
| :--- | :--- |
| `oj-common-local.yaml` | 所有服务最先导入的公共配置（链路追踪、Sentinel 规则数据源），可被各服务自己的 Data ID 覆盖 |
| `oj-friend-sentinel-flow.yaml`、`oj-friend-sentinel-degrade.yaml` | friend 的限流、熔断规则（YAML 列表，模板内有字段说明） |
| `oj-system-sentinel-flow.yaml`、`oj-system-sentinel-degrade.yaml` | system 的限流、熔断规则（YAML 列表，模板内有字段说明） |
| `oj-gateway-local.yaml` | 网关 |
| `oj-system-local.yaml` | system |
| `oj-friend-local.yaml`、`oj-message-local.yaml` | friend |
| `oj-judge-local.yaml` | judge |
| `oj-ai-local.yaml` | ai（百炼 API Key、模型名、超时；Key 本地可引用环境变量 `OJ_DASHSCOPE_API_KEY`） |
| `oj-job-local.yaml` | job |

- 模板中的密钥都引用环境变量，服务启动前在系统或 IDEA 运行配置里设置（数据库、Redis、RabbitMQ 未设置时使用 compose 中的本地默认值）：

| 环境变量 | 用途 | 是否必填 |
| :--- | :--- | :--- |
| `OJ_JWT_SECRET` | JWT 签名密钥（所有服务一致） | 必填 |
| `OJ_DASHSCOPE_API_KEY` | 通义百炼 API Key（未设置时读 `DASHSCOPE_API_KEY`） | 使用 AI 功能时必填 |
| `OJ_MYSQL_USERNAME` / `OJ_MYSQL_PASSWORD` | 业务库账号 | 默认 `root` / `123456789` |
| `OJ_REDIS_PASSWORD` | Redis 密码 | 默认 `123456` |
| `OJ_RABBITMQ_USERNAME` / `OJ_RABBITMQ_PASSWORD` | RabbitMQ 账号 | 默认 `admin` / `123456` |
| `OJ_XXL_JOB_ACCESS_TOKEN` | 与调度中心一致的 accessToken | 默认 `default_token` |
| `OJ_OSS_ACCESS_KEY_ID` / `OJ_OSS_ACCESS_KEY_SECRET` / `OJ_OSS_BUCKET_NAME` / `OJ_OSS_URL_PREFIX` | 头像上传（阿里云 OSS） | 上传头像时必填 |
| `OJ_SMS_ACCESS_KEY_ID` / `OJ_SMS_ACCESS_KEY_SECRET` | 真实发送短信 | 关闭模拟发码时必填 |
| `OJ_TRACING_SAMPLING` / `OJ_ZIPKIN_ENDPOINT` | 链路追踪采样率与 Zipkin 上报地址 | 默认 `1.0` / 本机 9411 |

- 本地短信为模拟发码（`oj-message-local.yaml` 中 `sms.is-confirm: false`）：不发短信，friend 日志输出 `[模拟发码] ... 验证码: xxxxxx`，真实发码模式不输出验证码。
- Nacos 连不上时服务启动失败；Data ID 不存在时只告警，表现为缺配置启动失败，排查时先看 Nacos 服务端 `config-client-request.log` 里的命名空间。

### 编译与启动后端

```powershell
mvn clean install -DskipTests
```

在 IDEA 中依次启动：

| 服务 | 主类 | 端口 |
| :--- | :--- | :--- |
| oj_gateway | `cn.nuonuoya.gateway.GatewayApplication` | 19090 |
| oj_system | `cn.nuonuoya.system.SystemApplication` | 9201 |
| oj_friend | `cn.nuonuoya.friend.FriendApplication` | 9202 |
| oj_judge | `cn.nuonuoya.judge.JudgeApplication` | 9204 |
| oj_job | `cn.nuonuoya.job.JobApplication` | 9203 |
| oj_ai | `cn.nuonuoya.ai.AiApplication` | 9205 |

judge 需要本机 Docker 可用，启动时会预热判题容器池。

### 启动前端

```bash
# 管理端（http://localhost:5173）
cd oj_fe_b
npm install
npm run dev

# 学员端（http://localhost:5174）
cd oj_fe_c
npm install
npm run dev

# 生产环境打包（两端相同，产物在各自的 dist/）
npm run build
```

- 两端都经 Vite 代理访问网关 `127.0.0.1:19090`，所以要先把后端的网关和 friend / system 起来。
- 测试账号就是上面初始化脚本里的那批；学员端本地为模拟发码，验证码输出在 oj-friend 控制台。
- `src/assets` 为图片素材，随仓库提供。

## 代码规范与工程约束

后端：

* **分层边界**：调用链严格遵从 `Controller → Service → Mapper`，禁止跨层或在 Controller 注入 Mapper。
* **参数与返回值**：Controller 统一使用 DTO 接参、返回统一 VO，禁止直接向前端暴露持久层 Entity。
* **MyBatis-Plus 约束**：持久层一律采用 Lambda API（如 `LambdaQueryWrapper` / `LambdaUpdateWrapper`），禁止硬编码数据库列名字段。
* **对象转换**：Entity 到 VO 的映射转换统一在 `converter` 包手写静态转换方法，避免动态反射开销。
* **注释风格**：类、接口、枚举声明统一采用 `// 中文单行` 注释；Controller 接口方法统一采用 `/** 中文一句话 */` 单行 Javadoc 说明，不编写冗余的 `@param` / `@return`；核心关键业务算法上方编写简洁的单行步骤注解。
* **事务控制**：所有涉及数据修改的写操作统一标注 `@Transactional(rollbackFor = Exception.class)`。

前端：

* **三文件分离**：组件统一拆成 `.vue` / `.js` / `.scss` 三个文件。
* **数据流**：页面通过 `src/api/` 发请求，不直接调用 Axios；经 Actions 改 Store；令牌注入、统一错误提示与响应脱壳都收在 `utils/request`。
* **常量对齐**：与后端枚举对应的业务常量统一放在 `constants`。

## 演进历程

| 阶段 | 内容 |
| :--- | :--- |
| 代码优化 | 按规范逐模块排查与重构：分层边界、内部契约、缓存归属、判题沙箱隔离、竞赛结算幂等 |
| 框架升级 | Boot 3.0 → 3.5.16、Spring Cloud 2025、Nacos 3.2.4、ES 8.18.8 |
| AI 模块 | 新增 `oj_ai`：AI 辅助出题、AI 帮建竞赛、做题辅导、语义检索与相似题推荐、资料审核 |
| 链路追踪 | Micrometer Tracing + Brave + Zipkin，链路穿过 Feign、WebClient 与 RabbitMQ |
| 熔断限流 | Sentinel，只加在判题与 AI 调用边界（含 AI 辅导流式调用），规则以 YAML 放在 Nacos |

## 开源许可证

前后端两个仓库均基于 MIT License 开源。
