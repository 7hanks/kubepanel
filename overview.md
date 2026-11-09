# KubePanel 交付概览（v1.4.0 · 多集群 + 镜像仓库 + 监控）

**一句话**：一个用浏览器点击替代日常 kubectl 的轻量 K8s Dashboard，按「集群列表 → 进入集群 → 资源导航」两级信息架构组织，已构建成镜像并部署在一台单节点集群上。

**访问**：`http://<服务器IP>:9090` — 账号 `admin`，密码在部署时通过 `.env` 的 `DASHBOARD_PASSWORD` 设置（不入库）

---

## 2026-11-09 运维修复：健康检查语义 + 镜像重建

| 项 | 内容 |
|---|---|
| 现象 | 容器 `Up 2 days (unhealthy)`，`FailingStreak 7136`；`/healthz` 返回 503 `partially-unreachable` |
| 根因（决定性证据） | 火山云集群 API Server `https://192.168.111.252:6443` 直连 4s 超时 `HTTP=000`；同机对照 dev `https://172.16.0.3:6443` 9.9ms `HTTP=200`。网络不可达，不是凭据错误、也不是服务故障 |
| 代码改动 | `server/index.js` 的 `/healthz` 改为 **liveness 语义**：HTTP 恒 200、`status: "ok"` 只表示进程存活；集群连通性另放 `kube` / `healthyClusters` / `totalClusters` / `clusters[]`。探测超时 3000ms → 2000ms，避免 HEALTHCHECK（5s）被拖垮 |
| 构建前核对 | 本地 `D:\dashboard` 与服务器 `/opt/kubepanel/app` 源码逐文件哈希一致；Multica 的 `ResourceActionButton.vue`、`ResourceList.vue`、`README.md` 改动本地已包含，因此全量同步不会覆盖他人改动 |
| 部署 | `docker build -t kubepanel:1.4.0 .` 成功（新镜像 `bd743b49c3e6`，旧 `a324bd9bc65b` 保留可回滚）；带全参数重建容器（9090:8080、`DATA_DIR`、`DASHBOARD_SECRET`、两个 bind 挂载） |
| 验证 | `/healthz` HTTP 200 → 容器 `healthy`；首页 200；登录接口错误密码正确返回 401；前端产物、`data/` 五个 JSON、`clusters/` 两个 kubeconfig 均完好 |
| 文档 | `README.md`「常见问题」补两条：healthz / `partially-unreachable` 排查（附可直接复制的批量连通性命令）、冒烟脚本需显式传当前密码 |
| 遗留 | 31 项冒烟需用户提供界面自定义后的当前密码；火山云集群需打通网络或在界面移除，否则 `kube` 会持续显示降级 |

---

## 本轮迭代（v1.4.0）

用户一次性提了 5 件事，全部落地并部署：

| # | 需求 | 实现 | 验证 |
|---|---|---|---|
| 1 | 点「YAML」不应直接进编辑 | 弹窗拆成 **view / edit** 两态：列表点 YAML 只读预览（右上角「只读预览」标签、无导入/保存），点右下角「编辑」或「更多 → 编辑 YAML」才可改；新建/详情页仍直接进编辑态 | 截图：只读态标题「查看 kubepanel-demo」+ 关闭/编辑；点编辑后出现「导入 .yaml」与「保存」 |
| 2 | 加镜像仓库，对接 k8s 里的 Harbor | 新页面 `/registries` + 后端 `registryService.js` 代理 Harbor API v2.0；支持「从集群发现」自动扫 NodePort、项目/仓库/标签三级浏览、复制 `docker pull` | 真实数据：发现 `harbor` → `https://172.16.0.3:30003`，项目 `library`（2 仓库）、标签 `latest` 25MB |
| 3 | 加监控，直接对接 Grafana | 新页面 `/monitor`：Grafana 地址 + 服务账号 Token + 仪表盘列表 + iframe 嵌入；另加「内置指标」（节点/Pod 用量，读 metrics-server） | Grafana 未配置/不可达时给出明确报错（`ECONNREFUSED`），内置指标读到 2698m / 9.14 GiB |
| 4 | Pod 状态分布要能看到具体 Pod | 概览每个状态行可展开：该状态的 Pod 紧凑列表（命名空间/节点/重启/时间）+ 进详情 + 看日志；「在列表中查看全部」跳转 | 展开 Running 命中 30 个真实 Pod，Succeeded 5 个 |
| 5 | 把启动/部署/更新方式写进 README | README 3.6 重写为运维手册：首次部署、启动/停止/重启、三种更新场景、回滚/卸载，附参数缺失后果对照表 | — |

### 关键决策

1. **YAML 默认只读**：生产环境「看一眼 YAML」和「改 YAML」是两种风险等级，默认只读能挡住误编辑；编辑入口保留两处，不牺牲效率。
2. **镜像仓库走后端代理**：直接浏览器直连 Harbor 会遇到 CORS、自签证书、凭据暴露三个问题；后端代理后，凭据只存 `/app/data/registries.json`（600），前端只拿到打码信息。
3. **Harbor 凭据可选**：实测该 Harbor 的 `/api/v2.0/projects` 匿名可读，所以默认支持匿名；私有项目再填账号密码。
4. **监控双轨**：Grafana 只是「配置托管 + 嵌入」，不做全量代理（避免大响应体穿过后端）；没 Grafana 时用 metrics-server 兜底，页面不至于空着。
5. **Pod 下钻用紧凑列表而非表格**：右栏只有约 320px 宽，表格会横向溢出；改成两行式列表后一行信息不丢、还能直点进详情。

---

## 上一轮迭代（v1.3.0）：用户菜单加「修改密码」

用户在集群列表页圈出右上角用户下拉菜单，要求「增加一个修改密码的功能」。

| 层 | 实现 |
|---|---|
| 凭据存储 | 新增 `server/src/userStore.js`：密码以 **scrypt + 随机盐**哈希写入 `DATA_DIR/auth.json`（容器内 600、属主 10001），原子写（临时文件 + rename），不存明文 |
| 认证逻辑 | `auth.js` 改为「有落盘凭据用哈希比对，否则回退 `DASHBOARD_PASSWORD`」；改过密码后环境变量立即失效，启动日志明确提示 |
| 接口 | `POST /api/v1/auth/password` 校验当前密码 → 长度 ≥ 8、四类字符至少两类、不得与旧密码相同 → 落盘；`GET /api/v1/auth/profile` 供弹窗显示密码来源与更新时间 |
| 界面 | 新增 `ChangePasswordDialog.vue`：账号与密码来源、当前/新/确认三输入、实时强度条（弱/一般/较强/很强）、保存后强制退回登录页；集群列表页与控制台顶栏两处用户菜单都加了入口 |
| 持久化 | 新增可写数据卷 `/opt/kubepanel/data:/app/data`；不挂这个卷，重建容器会退回初始密码 |

**验证（真实生产环境往返）**：API 与界面两条路径都改成临时密码 → 旧密码 401、新密码 200 → `docker restart` 后新密码仍有效（证明落盘生效）→ 再改回原密码。冒烟新增 3 项（profile、错误当前密码 400、弱密码 400），当时共 27/27（v1.4.0 起为 31/31）。

> 副作用提醒：密码改过以后 `DASHBOARD_PASSWORD` 不再生效；冒烟脚本硬编码了初始密码，改密码后要用 `DASHBOARD_PASSWORD='新密码' bash /opt/kubepanel/smoke-test.sh`。

---

## 上一轮迭代（参考 KubePi 后的改造）

用户反馈：侧边栏「自定义资源」把几十个 CRD 全部铺开太乱，且希望像 KubePi 那样**先管理多个集群、点进去才是资源**。

实地登录 KubePi (`<服务器IP>:81`) 后确认其 IA：左侧只有「集群列表 / 用户管理 / 镜像仓库 / 日志审计 / 监控」等平台级菜单，主区是集群表格（状态、名称、节点、版本、存活时间），每行一个「控制台」按钮，点进去才出现资源菜单。前端包里也明确写着 *import multiple Kubernetes clusters*。

据此改造：

| 改动 | 结果 |
|---|---|
| 多集群注册表 | 新增 `server/src/clusterService.js`：扫描目录里的多个 kubeconfig + 单文件多 context + in-cluster + env 注入；每集群独立客户端与发现缓存 |
| 全链路 `clusterId` | 所有资源接口按 `clusterId` 选集群；axios 拦截器统一注入，SSE/WS 走 query；无效 id 返回 404 与中文提示 |
| 集群列表页 | 新增 `ClusterList.vue`：卡片显示状态/版本/节点数/命名空间数/认证方式/来源，支持「进入控制台」「测试连接」「导入集群」「移除集群」 |
| 两级路由 | `/clusters` → `/c/:clusterId/...`；顶部集群切换器 + 返回集群列表；路由守卫在子组件挂载前同步 clusterId |
| 去掉 CRD 刷屏 | 侧边栏彻底移除「自定义资源」长分组，改为「集群 → 自定义资源」**一个入口**，进去是 CRD 类型汇总表格，点「查看实例」才进入通用资源列表（能力不丢） |
| 凭据目录可写 | 挂载从单文件 `:ro` 改为目录 `/opt/kubepanel/clusters`（属主 10001、700），界面导入的 kubeconfig 落盘 600、重启不丢 |

### 关键决策

1. **Node 全栈而非 Go**：本机无 Go/Docker，Node 可完整本地构建验证；官方 client-node 覆盖 REST/exec/log。
2. **通用 REST 代理**：API Discovery 动态取全部 GVK，一套代码覆盖内置资源与 CRD，新装 Operator 无需改代码。
3. **文件即集群注册表**：不引入数据库，运维可直接 scp kubeconfig 纳管；界面导入只是往同一目录写文件，模型简单、可审计、易备份。
4. **认证分离**：JWT 管页面登录，kubeconfig/SA 管 K8s 权限；容器固定 UID 10001 非 root。
5. **端口 9090**：目标机 80/8080 被 traefik 占用、8000 被 blueops 占用。

---

## 交付物

| 文件 | 说明 |
|---|---|
| `Dockerfile` / `docker-compose.yml` / `.env.example` / `.dockerignore` | 三阶段构建 + 容器编排 |
| `server/src/clusterService.js` | 多集群注册表、导入/移除、连通性探测 |
| `server/src/userStore.js` | 登录密码的 scrypt 哈希存储（`auth.json`，原子写 + 600） |
| `server/src/registryService.js` | Harbor API v2.0 代理、配置落盘、从集群发现 NodePort |
| `server/src/monitorService.js` | Grafana 配置/连通性/仪表盘列表 + metrics-server Pod 指标 |
| `frontend/src/views/Registries.vue` / `Monitor.vue` | 镜像仓库、监控两个平台级页面 |
| `frontend/src/layout/PlatformHeader.vue` | 平台页共用顶栏（集群 / 镜像仓库 / 监控 + 用户菜单） |
| `frontend/src/components/ChangePasswordDialog.vue` | 修改密码弹窗（强度条 + 校验 + 强制重登） |
| `server/src/kube.js` | 按 clusterId 取客户端、通用 REST、按集群隔离的 Discovery 缓存 |
| `server/src/{routes,actions,logs,terminal,index}.js` | 集群管理接口 + 全部资源接口透传 clusterId |
| `frontend/src/views/ClusterList.vue` / `CustomResources.vue` | 集群列表页 / CRD 汇总页 |
| `frontend/src/utils/path.js` | 集群作用域路径生成 |
| `deploy/smoke-test.sh` | 一键复验（31 项） |
| `deploy/rbac.yaml` / `deployment.yaml` | 集群内部署（ServiceAccount + NodePort 30090，可选） |
| `README.md` | 完整部署、配置、对照表、dev/prod、11 条常见坑 |

---

## 界面重设计（v1.3.0）

用户反馈「整体界面不够美观，要简约、好看，美化细节」，并给了三张参考图（扩缩容 +/-、侧栏收起、KubePi 顶栏）。本轮不改业务逻辑，只重做视觉与这两个交互：

- **设计系统**：`styles.css` 全量重写，建立色彩 / 文本 / 边框 / 圆角 / 阴影 token，并覆盖 Element Plus CSS 变量，让表格、按钮、标签、弹窗、Tabs 自动跟随；浅色侧栏取代深蓝，低饱和语义色、细线表格、极轻阴影。
- **侧栏折叠**：顶栏与侧栏底部双入口，收起为 62px 图标条，`kp_side_collapsed` 持久化；分组标题折叠时变为细分隔线，菜单图标带原生 tooltip。
- **顶栏重排**（参考 KubePi）：折叠 / 返回集群列表 / 集群切换 / 面包屑 / 版本 / 命名空间 / 自动刷新 / 刷新 / 帮助 / 用户。自动刷新（关闭 / 15s / 30s / 60s）派发 `kp:refresh`，资源列表与概览监听并重新拉取；移除列表页里重复的 15s 开关。
- **扩缩容步进器**：新增 `ScaleDialog.vue`，当前→目标副本、大号 −/+ 按钮、快捷档位 0/1/2/3/5/10、说明提示；列表与详情页统一使用，替换原来的输入框 prompt。
- 登录页、集群列表页、详情页、YAML 弹窗、日志/终端深色区一并适配新语言。

**视觉走查**：浏览器逐页截图确认（登录 / 集群列表 / 概览 / Deployments 列表 / 侧栏收起 / 扩缩容弹窗），浅色侧栏、细线表格、低饱和标签、留白与对齐一致，无错位或溢出。冒烟 24/24 通过。

---

## 本轮迭代：重启 Pod + YAML 文件编辑 + 修掉一个死按钮

**重启 Pod**（用户图 3）：K8s 没有 Pod restart 子资源，实现为「删除 → 由控制器重建」。

- 后端 `POST /api/v1/pods/:ns/:name/restart`：先 GET Pod 检查 `ownerReferences`，**裸 Pod 直接拒绝**（删了不会自动回来）；受控 Pod 才执行 DELETE，并返回「由 DaemonSet/xxx 自动重建」。
- 支持 `?dryRun=1` 只做预检、不删除任何 Pod，便于脚本验证与用户确认。
- 前端：Pod 列表「更多 → 重启 Pod」、详情页顶部橙色「重启 Pod」按钮，均带二次确认；详情页重启成功后自动退回列表（避免停留在已删除资源上）。
- 实测 dryRun：`{"ok":true,"wouldRestart":true,"message":"预检通过：fluent-bit-mwbsq 由 DaemonSet/fluent-bit 管理，删除后会自动重建（未执行删除）"}` —— 全程没有真删任何 Pod。

**YAML 文件编辑**（用户图 1）：`YamlDialog` 新增「导入 .yaml 文件」「下载 .yaml」「全屏编辑」三个按钮；导入只填编辑器、必须点保存才提交，下载把当前内容存为本地文件。

**顺带修掉一个真 bug**：详情页顶部「编辑 YAML」按钮模板绑定了 `editYaml`，但 script 里**根本没有这个函数**，点了毫无反应（v1.0 就存在）。现在详情页也复用带文件按钮的编辑弹窗，保存走 kubectl replace 语义；浏览器实测弹窗正常打开、三个按钮齐全。

---

## 本轮修复（用户实测反馈的两个问题）

**1. 节点详情页没有任何数据、状态误显示 NotReady**

- 决定性证据：`GET /api/v1/resources/_core/v1/nodes/-/dev` → **404**，换成 `_all/dev` → **200 完整 Node 对象**。
- 根因：集群级资源在列表里 `namespace` 显示为 `-`，详情链接原样拼进 URL，后端把它当真实命名空间，请求变成 `/api/v1/namespaces/-/nodes/dev`；前端又把异常吞掉只留空对象，于是名称/UID 全空、状态按空对象推断成 NotReady。
- 修复：新增 `nsPath()` 统一把 `-` / `all` 归一为 `_all`；后端 `nsOf()` 同步做防御；详情页加载失败改为显式错误提示 + 重试/返回，并隐藏空的 Tabs。
- 实测：节点详情页现在显示 `Ready`、UID `d7d4dce8…`、创建时间 `2025/12/23 14:54:11 (316d)`、`v1 / Node`、资源版本、8 个标签、6 条注解、5 条 Conditions。

**2. 集群列表页不能查看集群详细信息**

- 新增 `GET /api/v1/clusters/:id/detail`（平台级，不改变当前选中集群），聚合基本信息、版本、命名空间、统计、节点状态、近期事件、API 组分布。
- 集群列表页：卡片名称可点击 + 新增「详情」按钮，打开右侧抽屉展示 6 个统计卡、基本信息表、11 个命名空间标签、节点状态表、38 个 API 组分布、近期事件，底部可进入控制台 / 刷新 / 测试连接。
- 实测抽屉数据：1 节点 / 11 命名空间 / 35 Pod / 14 Deployment / 29 Service / 0 异常，153 种资源类型。

---

## 验证结果（真实集群 v1.33.7）

- 冒烟 **24/24 全部通过**（新增「重启 Pod 预检 dryRun」）：健康检查、登录、集群注册表、连通性测试、**导入/移除集群**、6 类资源列表、ConfigMap 的 apply/get/patch/put/delete 全链路、日志 SSE、Pod 事件、重启 Pod 预检；临时 ConfigMap 与临时 kubeconfig 均已清理。
- `healthz` → `ok`，集群 `c-20171e16` (dev) 连通；API 发现 **153 种资源**。
- 浏览器实测：登录后落在集群列表页；点「进入控制台」后侧边栏只有 7 个内置分组，「集群」下仅一个「自定义资源」入口；顶部显示 `dev / v1.33.7`，概览数字与集群一致。
- 本轮修复后：`nodes/-/dev`、`namespaces/-/default` 均返回 200；`/clusters/:id/detail` 返回 200 且字段齐全；节点详情页与集群详情抽屉均经浏览器截图确认。
- Web 终端（v1.0 已验证）：WebSocket exec 回显与窗口 resize 正常。

---

## 风险与后续

- **最大风险**：登录账号 + admin kubeconfig 意味着能打开页面的人就拥有该集群 admin 权限（含 Web 终端）；纳管多个集群后风险面按集群数放大。9090 已在公网可达，请**立即改密码**、限制来源 IP 或加 HTTPS 反代，并按最小权限发放 kubeconfig。
- 当前无用户级 RBAC / SSO / 操作审计（KubePi 有），如需多人分权需补。
- 凭据目录必须可写且属主 10001，加 `:ro` 会导致导入/移除失败（冒烟脚本会检出）。
- 升级流程：改代码 → `bash /opt/kubepanel/smoke-test.sh` → `docker build -t kubepanel:1.4.0 .` → 删容器重新 `docker run`（完整命令见 README 3.3）。
