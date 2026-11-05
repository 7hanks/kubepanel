# KubePanel · 多集群 Kubernetes 可视化控制台

用浏览器点几下完成原来 `kubectl` 才能做的事。**两级信息架构**：登录先看到「集群列表」，点「进入控制台」才进入某个集群的资源导航（参考 KubePi 的做法）。单容器交付，前后端打进一个镜像。

---

## 1. 设计要点

- **两级 IA**：`/clusters`（平台级集群列表）→ `/c/:clusterId/...`（该集群的资源控制台）。侧边栏不再挤满资源类型，更不会把每个 CRD 都列成一条菜单。
- **多集群注册表**：每个集群持有独立 KubeConfig、API Server 地址与资源发现缓存；所有资源请求都带 `clusterId`，不会串集群。
- **通用 REST 代理**：不做资源类型的硬编码 CRUD。后端通过 **API Discovery** 动态拿到该集群的全部 GVK（含 CRD），前端一套通用表格 + 动态列渲染。
- **CRD 不再刷屏**：侧边栏「集群 → 自定义资源」只留一个入口，进去后以表格列出所有 CRD 类型，点「查看实例」才进入通用资源列表，能力完整但菜单干净。
- **认证分离**：JWT 决定「能不能进页面」，kubeconfig / ServiceAccount 决定「能操作什么」。

### 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 后端 | Node.js 22 ESM + Express 5 + 官方 `@kubernetes/client-node` | 复用其 KubeConfig 认证链（mTLS / Token / in-cluster） |
| 多集群 | `clusterService.js` 扫描目录 + 多 context + in-cluster + env 注入 | 每个集群独立客户端，界面可导入/移除 |
| K8s 通信 | 原生 HTTPS REST + `applyToHTTPSOptions` | 通用代理，一套代码覆盖全部 GVK |
| 前端 | Vue 3 + Element Plus + Vite + xterm.js | 构建产物由 Express 同源托管，无 Nginx |
| 实时通道 | SSE（日志流）+ WebSocket（exec 终端） | 无需轮询 |

### 界面设计语言（v1.2.0 起，v1.4.0 延续）

从深蓝侧栏 + 重边框表格，改成「浅色 / 低饱和 / 大留白」的现代控制台：

| 维度 | 决策 |
|---|---|
| 色彩 | 页面 `#F7F8FA`、卡片纯白、品牌蓝 `#2563EB`、细边框 `#E9EDF2`；语义色一律低饱和浅底标签 |
| 侧栏 | 浅色白底 + 细右边框，**可一键收起**为 62px 图标条，状态写入 localStorage |
| 顶栏 | 56px 白底：折叠 / 返回集群列表 / 集群切换 / 面包屑 / 命名空间 / **自动刷新** / 刷新 / 帮助 / 用户 |
| 排版 | Inter 优先，字号层级 11–26px，标题 650 字重，统一 6 / 10 / 14px 圆角 |
| 组件 | 表格去外框、细分隔线 + hover 高亮；按钮 / 标签 / 输入框 / 弹窗 / Tabs 通过 Element Plus CSS 变量统一主题 |
| 阴影 | 极轻（1px 2%），靠边框与留白建立层级，去掉「后台模板感」 |

交互补强：**扩缩容改为 −/+ 步进弹窗**（当前→目标副本、快捷档位 0/1/2/3/5/10）；**顶栏自动刷新**（关闭 / 15s / 30s / 60s）通过 `kp:refresh` 事件驱动列表与概览重新拉取，列表页自带的重复开关已移除。

### 目录

```
D:\dashboard\
├── Dockerfile                # 三阶段构建：前端 -> 后端依赖 -> 运行镜像
├── docker-compose.yml
├── .env.example               # 登录密码 / JWT 密钥
├── .dockerignore
├── server/
│   ├── index.js               # Express 启动、静态托管、健康检查、错误处理
│   └── src/
│       ├── config.js          # 环境变量
│       ├── clusterService.js  # 多集群注册表：扫描 / 导入 / 移除 / 连通性探测
│       ├── kube.js            # 按 clusterId 取客户端、通用 REST、API Discovery
│       ├── actions.js         # 概览统计、YAML Apply、扩缩容、重启、cordon
│       ├── auth.js            # 登录 / JWT / WS 认证
│       ├── routes.js          # 集群管理 + 全部资源路由（统一挂 clusterId）
│       ├── logs.js            # Pod 日志 SSE
│       └── terminal.js        # exec WebSocket 终端
├── frontend/
│   ├── src/views/             # 集群列表 / 自定义资源 / 概览 / 资源列表 / 详情 / YAML / 日志 / 终端
│   ├── src/utils/path.js      # 集群作用域路径 /c/:clusterId/...
│   ├── src/config/            # 导航元数据、动态列、YAML 模板
│   └── dist/                  # npm run build 产物（Docker 阶段生成）
└── deploy/
    ├── rbac.yaml              # 集群内运行时用 ServiceAccount
    ├── deployment.yaml        # Deployment + NodePort 30090
    └── smoke-test.sh          # 部署后一键冒烟
```

---

## 2. 本次部署环境（已实测）

| 项 | 值 |
|---|---|
| 目标机 | `root@117.72.115.79` |
| Docker | 29.0.0 |
| 集群 | k8s v1.33.7，单节点 `dev`，context `kubernetes-admin@kubernetes` |
| 凭据目录 | `/opt/kubepanel/clusters/`（属主 10001、700；`dev.yaml` 600） |
| 数据目录 | `/opt/kubepanel/data/`（属主 10001、700；`auth.json` 600，存界面改过的密码哈希） |
| 镜像仓库 | Harbor `harbor` 命名空间，NodePort `https://172.16.0.3:30003`（API v2.0 匿名可读） |
| 监控 | 集群内暂无 Grafana；页面已支持配置对接，未配置时用「内置指标」（metrics-server 已装） |
| 端口 | **9090**（该机 80 / 8080 已被 traefik 占用，8000 被 blueops 占用） |
| 访问地址 | `http://117.72.115.79:9090` → 登录后进入 `/clusters` |
| 部署状态 | 容器 `kubepanel` 运行中，镜像 `kubepanel:1.4.0` |
| 当前账号 | `admin` / `Kp@2026ChangeMe`（示例值，**上线请立即修改**） |

---

## 3. 快速开始：docker run（命令可直接复制）

### 3.1 准备集群凭据目录

容器以固定 UID `10001` 非 root 运行。目录必须**可写**且属主 10001，界面才能导入新集群：

```bash
mkdir -p /opt/kubepanel/clusters
install -o 10001 -g 10001 -m 600 /root/.kube/config /opt/kubepanel/clusters/dev.yaml
chown 10001:10001 /opt/kubepanel/clusters
chmod 700 /opt/kubepanel/clusters
ls -la /opt/kubepanel/clusters
```

> 多个集群：直接把其他 kubeconfig 复制成 `prod.yaml`、`test.yaml` 放进同一个目录，刷新页面即可出现；一个 kubeconfig 里有多个 context 时，每个 context 会各注册为一个集群。
> 相对路径证书先展平：`kubectl config view --raw --flatten > /opt/kubepanel/clusters/prod.yaml`

### 3.2 构建镜像

```bash
cd /opt/kubepanel/app
docker build -t kubepanel:1.4.0 .
```

### 3.3 启动

```bash
docker run -d --name kubepanel --restart unless-stopped \
  -p 9090:8080 \
  -e DASHBOARD_USERNAME=admin \
  -e DASHBOARD_PASSWORD='Kp@2026ChangeMe' \
  -e DASHBOARD_SECRET='6f2a9c4e8b1d7053a9e4c8f2b6d0a1735e9c4b8f2a6d0e1735c9b4a8f2d6' \
  -e DATA_DIR=/app/data \
  -v /opt/kubepanel/clusters:/app/kube/clusters \
  -v /opt/kubepanel/data:/app/data \
  kubepanel:1.4.0
```

**注意 `-v` 不要加 `:ro`**，否则界面无法导入/移除集群。上线前务必改掉密码与 `DASHBOARD_SECRET`（后者用 `openssl rand -hex 32` 生成）。

第二个挂载 `/opt/kubepanel/data` 存放界面改过的登录密码（`auth.json`）；不挂它，重建容器会退回 `DASHBOARD_PASSWORD`。宿主机目录需 `chown 10001:10001`、`chmod 700`。

### 3.4 验证

```bash
curl -s http://127.0.0.1:9090/healthz
bash /opt/kubepanel/smoke-test.sh
docker logs --tail 30 kubepanel
```

浏览器打开 `http://117.72.115.79:9090`，登录后先看到集群列表，点「进入控制台」再操作资源。

### 3.5 docker compose（替代方案）

```bash
cd /opt/kubepanel/app
cp .env.example .env
vi .env
docker compose up -d --build
docker compose logs -f
```

### 3.6 部署 / 启动 / 停止 / 更新（运维手册，命令可直接复制）

> 一条铁律：`docker run` 的那串参数就是唯一「事实来源」。重建容器时必须原样带上 **2 个 `-v` + 3 个 `-e`**，少一个就会丢集群或丢密码。

#### ① 首次部署（在一台新机器上从零开始）

```bash
# 1) 集群凭据目录（容器以 UID 10001 非 root 运行，必须可写）
mkdir -p /opt/kubepanel/clusters /opt/kubepanel/data
install -o 10001 -g 10001 -m 600 /root/.kube/config /opt/kubepanel/clusters/dev.yaml
chown 10001:10001 /opt/kubepanel/clusters && chmod 700 /opt/kubepanel/clusters
chown 10001:10001 /opt/kubepanel/data && chmod 700 /opt/kubepanel/data

# 2) 源码 + 构建
mkdir -p /opt/kubepanel/app
tar -xzf kubepanel-src.tar.gz -C /opt/kubepanel/app     # 或用下面的「本机同步」方式
cd /opt/kubepanel/app && docker build -t kubepanel:1.4.0 .

# 3) 启动
docker run -d --name kubepanel --restart unless-stopped \
  -p 9090:8080 \
  -e DASHBOARD_USERNAME=admin -e DASHBOARD_PASSWORD='Kp@2026ChangeMe' \
  -e DASHBOARD_SECRET='6f2a9c4e8b1d7053a9e4c8f2b6d0a1735e9c4b8f2a6d0e1735c9b4a8f2d6' \
  -e DATA_DIR=/app/data \
  -v /opt/kubepanel/clusters:/app/kube/clusters \
  -v /opt/kubepanel/data:/app/data \
  kubepanel:1.4.0

# 4) 验证
curl -s http://127.0.0.1:9090/healthz
bash /opt/kubepanel/smoke-test.sh
```

| 参数 | 作用 | 少了会怎样 |
|---|---|---|
| `-p 9090:8080` | 宿主机 9090 → 容器 8080 | 打不开页面 |
| `-e DASHBOARD_SECRET` | JWT 签名密钥 | 每次重启所有人被踢下线 |
| `-v .../clusters` | 集群凭据（可写，界面导入写这里） | 页面无集群 |
| `-v .../data` | 账号数据（密码哈希、镜像仓库配置、Grafana 配置） | 改过的密码/新加的仓库全丢 |

#### ② 启动 / 停止 / 重启

```bash
docker ps --filter name=kubepanel            # 看状态：要出现 (healthy)
docker logs --tail 100 -f kubepanel          # 实时日志
curl -s http://127.0.0.1:9090/healthz        # 健康检查（含每个集群连通性）

docker stop kubepanel      # 停止（容器保留，数据不动）
docker start kubepanel     # 启动已存在的容器
docker restart kubepanel   # 重启（改了挂载的 kubeconfig、或忘了密码时）
```

> 设置了 `--restart unless-stopped`，服务器重启后容器会自动拉起，不用手工 `start`。

#### ③ 更新（三种场景）

```bash
# 场景 A：本机改完同步（推荐，源码在 D:\dashboard）
cd /d/dashboard
tar --exclude='./frontend/node_modules' --exclude='./server/node_modules' \
    --exclude='./frontend/dist' --exclude='./.git' --exclude='./server/data' \
    -czf - . | ssh root@117.72.115.79 'tar -xzf - -C /opt/kubepanel/app'
ssh root@117.72.115.79 'cd /opt/kubepanel/app && docker build -t kubepanel:1.4.0 .'
# 然后执行下面的「重建容器」
```

```bash
# 场景 B：直接在服务器上改
ssh root@117.72.115.79
cd /opt/kubepanel/app && vi server/src/xxx.js
docker build -t kubepanel:1.4.0 .        # 有层缓存，通常 20~60 秒
```

```bash
# 重建容器（A / B 之后都要做这一步，否则还是跑旧镜像）
docker rm -f kubepanel && docker run -d --name kubepanel --restart unless-stopped \
  -p 9090:8080 \
  -e DASHBOARD_USERNAME=admin -e DASHBOARD_PASSWORD='Kp@2026ChangeMe' \
  -e DASHBOARD_SECRET='6f2a9c4e8b1d7053a9e4c8f2b6d0a1735e9c4b8f2a6d0e1735c9b4a8f2d6' \
  -e DATA_DIR=/app/data \
  -v /opt/kubepanel/clusters:/app/kube/clusters -v /opt/kubepanel/data:/app/data \
  kubepanel:1.4.0
bash /opt/kubepanel/smoke-test.sh        # 更新后必跑（31 项）
```

```bash
# 场景 C：只改了配置/凭据，不用重建镜像
install -o 10001 -g 10001 -m 600 ~/prod.kubeconfig /opt/kubepanel/clusters/prod.yaml
docker restart kubepanel                 # 或直接在页面点刷新
```

- **前端改动同样要重建镜像**：`frontend` 在 Dockerfile 第一阶段编译进 `/app/public`，改完源码不构建等于没改。
- **别用 `docker exec` 进容器改代码**：容器层一重建就丢，改 `/opt/kubepanel/app` 再 build。

#### ④ 回滚 / 卸载

```bash
docker images kubepanel                          # 看还留着哪些版本
docker rm -f kubepanel && docker run -d --name kubepanel ... kubepanel:1.4.0   # 换回旧 tag 即可回滚

docker rm -f kubepanel                           # 停止并删除容器
rm -rf /opt/kubepanel/app                        # 删源码与构建上下文
# 保留 /opt/kubepanel/clusters 与 /opt/kubepanel/data 就还有集群与账号配置
```

### 3.7 修改 / 重置登录密码

**界面上改**：右上角用户菜单 → 修改密码 → 输入当前密码 + 新密码（至少 8 位，且含大写/小写/数字/符号中至少两类）→ 保存后自动退回登录页。

- 密码以 **scrypt + 随机盐**存在 `/opt/kubepanel/data/auth.json`（权限 600），不存明文。
- 一旦改过，`DASHBOARD_PASSWORD` 就**不再生效**；启动日志会打印「已在界面上自定义」。
- 想恢复成环境变量里的密码：删掉该文件再重启。

```bash
# 忘记密码：清掉自定义密码，回落到 -e DASHBOARD_PASSWORD
rm -f /opt/kubepanel/data/auth.json && docker restart kubepanel

# 换用户名 / 换初始密码：先删 auth.json，再用新的 -e 重建容器
rm -f /opt/kubepanel/data/auth.json
docker rm -f kubepanel && docker run -d ... -e DASHBOARD_USERNAME=admin -e DASHBOARD_PASSWORD='新密码' ...
```

> 冒烟脚本硬编码了 `Kp@2026ChangeMe`；改过密码后这样跑：`DASHBOARD_PASSWORD='新密码' bash /opt/kubepanel/smoke-test.sh`

---

## 4. 管理多个集群

| 方式 | 操作 | 适用 |
|---|---|---|
| 放文件（推荐给运维） | 把 kubeconfig 复制进 `/opt/kubepanel/clusters/*.yaml`，页面点刷新 | 批量纳管、配置管理/自动化 |
| 界面导入 | 集群列表 →「导入集群」→ 填名称 + 粘贴 kubeconfig → 校验并导入 | 临时添加、不想登服务器 |
| 环境变量注入 | `-e KUBE_CONFIG_B64=<base64>` 或 `-e KUBECONFIG=/path` | CI / 单集群快速体验 |
| 集群内部署 | ServiceAccount 自动注册为「当前集群 (in-cluster)」 | 见 `deploy/rbac.yaml` |

- 界面导入的凭据会写入 `/app/kube/clusters/<id>.yaml`（权限 600），**重启容器不丢失**。
- 集群列表显示：状态、K8s 版本、节点数 / 命名空间数、认证方式、Context、来源；支持「测试连接」与「移除」。
- 环境变量 / ServiceAccount / 只读挂载来源的集群不能在界面移除（会给出提示）。
- 每个集群的资源发现缓存相互隔离；顶部下拉可直接切换集群，命名空间选择也会随之刷新。
- **集群详情**：点卡片名称或「详情」按钮打开右侧抽屉，展示统计卡（节点 / 命名空间 / Pod / Deployment / Service / 异常 Pod）、基本信息（集群 ID、API Server、版本、平台、Context、认证方式、凭据来源、资源类型数、metrics-server 状态）、全部命名空间列表、节点状态表、API 组分布（按组统计资源类型数）与近期事件；底部可直接进入控制台 / 刷新详情 / 测试连接。该接口是平台级的，不会改变当前选中的集群。

---

## 5. 界面能做什么（kubectl → 点击 对照）

| 你想做的事 | 原来的命令 | 在 KubePanel 里 |
|---|---|---|
| 切换集群 | `kubectl config use-context` | 集群列表点「进入控制台」，或顶部下拉直接切换 |
| 改登录密码 | — | 右上角用户菜单 → 修改密码（校验当前密码；改完需重新登录，哈希存数据目录） |
| 查看集群详情 | `kubectl cluster-info` + `get nodes` | 集群列表点卡片名称 /「详情」，抽屉里看容量统计、命名空间、节点、API 组分布、近期事件 |
| 看集群状态 | `kubectl get nodes -o wide` | 集群概览：统计卡 + 节点状态 + 近期事件 + Pod 状态分布 |
| 列资源 | `kubectl get pods -A` | 左侧菜单选 Pod，顶部切命名空间 / 标签筛选 / 名称搜索 |
| 看详情 | `kubectl describe pod xxx` | 点名称进入详情：概览、标签注解、容器状态、Conditions、事件、关联 Pod |
| 编辑资源 | `kubectl edit deploy xxx` | 列表点「YAML」是**只读查看**，要改点弹窗右下角「编辑」，或操作列「更多 → 编辑 YAML」 |
| 新建资源 | `kubectl apply -f x.yaml` | 「新建」按模板填 YAML，或「YAML 工作台」批量粘贴多文档 |
| 找某个状态的 Pod | `kubectl get pods --field-selector status.phase=Pending` | 概览「Pod 状态分布」点某一行展开该状态的 Pod 列表，可直接进详情/日志 |
| 看镜像仓库 | 开 Harbor 页面 / `docker pull` | 左侧「镜像仓库」：浏览 Harbor 项目、仓库、标签，一键复制 `docker pull` 地址 |
| 看监控 | 开 Grafana | 左侧「监控」：对接 Grafana 嵌入仪表盘；未接入时用「内置指标」看节点/Pod 用量 |
| 扩缩容 | `kubectl scale deploy xxx --replicas=3` | 更多 → 扩缩容，弹窗输入副本数 |
| 滚动重启 | `kubectl rollout restart deploy xxx` | 更多 → 重启工作负载（写 `restartedAt` 注解） |
| 重启单个 Pod | `kubectl delete pod xxx`（由控制器重建） | Pod 列表「更多 → 重启 Pod」或详情页「重启 Pod」橙色按钮，二次确认；裸 Pod 会被后端拒绝 |
| 看日志 | `kubectl logs -f pod -c c` | 日志页：容器切换、最后 N 行、时间戳、上一容器、实时跟随、过滤、下载 |
| 进容器 | `kubectl exec -it pod -- sh` | Web 终端：xterm.js + WebSocket，支持窗口 resize |
| 节点维护 | `kubectl cordon / uncordon node` | Node 列表 → 更多 → 封锁 / 解除封锁 |
| 删除 | `kubectl delete xxx` | 删除按钮 + 二次确认，支持批量 |
| 自定义资源 | `kubectl get <crd>` | 「集群 → 自定义资源」汇总表格 → 查看实例，进入通用资源列表后支持全部操作 |
| 事件 | `kubectl get events` | 概览页近期事件 / 详情页事件标签 |

内置资源覆盖：Pod、Deployment、StatefulSet、DaemonSet、ReplicaSet、Job、CronJob、HPA、Service、Ingress、NetworkPolicy、Endpoints、ConfigMap、Secret、ServiceAccount、Role/RoleBinding/ClusterRole/ClusterRoleBinding、ResourceQuota、LimitRange、PVC/PV/StorageClass、Node、Namespace、Event、CRD；其余 CRD 实例通过「自定义资源」页进入（本次部署发现 153 种资源类型）。

**YAML 查看 vs 编辑（v1.4.0 起区分）**：列表里点「YAML」默认是**只读预览**（右上角标「只读预览」，没有导入/保存按钮），要改必须点弹窗右下角「编辑」，或走操作列「更多 → 编辑 YAML」；列表「新建」与详情页「编辑 YAML」直接进编辑态。编辑态支持**导入本地 .yaml / 下载 / 复制 / 全屏**，保存等价 `kubectl replace`，导入文件后必须点「保存」才提交到集群。

**镜像仓库（Harbor）**：左侧「镜像仓库」页面，后端代理 Harbor API v2.0，浏览器不直连仓库、也不落任何凭据到前端。

- 添加方式：① 「从集群发现」——扫描集群里带 NodePort 的 Service，用「节点 IP + nodePort」拼地址（本机实测自动认出 `harbor` → `https://172.16.0.3:30003`）；② 手动填地址；③ 私有项目填用户名/密码（只保存在服务端的 `/app/data/registries.json`，600 权限）。
- 浏览：选项目 → 仓库列表（制品数 / 拉取次数 / 更新时间）→ 展开看标签与大小 → 「复制」得到 `docker pull <host>/<project>/<repo>:<tag>`。
- 自签证书：用 IP + NodePort 访问 Harbor 时证书一般对不上，保持「跳过 TLS 证书校验」开启即可。

**监控（Grafana）**：左侧「监控」页面，两个标签页。

- **Grafana 仪表盘**：填地址（如 `http://192.168.56.101:30020`）+ 服务账号 Token（Grafana → Administration → Service accounts，Viewer 权限即可）→ 保存 → 左侧列出仪表盘，选中即在右侧 iframe 嵌入（`?kiosk&theme=light`）。需要在 Grafana 侧允许嵌入：`[security] allow_embedding = true`。
- **内置指标**：不依赖 Grafana，直接读 metrics-server。节点用量按「已用 / 可分配容量」画条形图，Pod 按 CPU 排序取 Top 20。
- 配置存 `/app/data/monitor.json`（600），Token 不会回传给浏览器（前端只知道「有没有配」）。

**Pod 状态分布下钻**：概览页每个状态（Running / Pending / Succeeded / Failed / Unknown）都可点开，展开该状态的 Pod 列表（命名空间、节点、重启次数、运行时间），点行进详情、点「日志」看日志；展开状态会跟随自动刷新一起更新。

**重启 Pod 的安全边界**：K8s 没有 Pod restart 子资源，实现方式是「删除 → 控制器重建」。后端会先检查 `ownerReferences`：**裸 Pod（无控制器）直接拒绝**，因为删了不会自己回来；受控 Pod 删除后返回「由 DaemonSet/xxx 自动重建」的提示。`?dryRun=1` 只做预检、不删除任何 Pod。

---

## 6. 配置项

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | 容器内监听端口，用 `-p 9090:8080` 映射 |
| `DASHBOARD_USERNAME` | `admin` | 登录用户名 |
| `DASHBOARD_PASSWORD` | 随机生成 | **未设置时自动生成并打印在 `docker logs` 里** |
| `DASHBOARD_SECRET` | 随机生成 | JWT 密钥；不固定则重启后已登录会话失效 |
| `DASHBOARD_TOKEN_TTL` | `12h` | 登录有效期 |
| `DASHBOARD_AUTH_ENABLED` | `true` | 设为 `false` 关闭登录（仅限本地调试） |
| `KUBE_CLUSTERS_DIR` | `/app/kube/clusters` | **可写**集群凭据目录 |
| `DATA_DIR` | `/app/data` | **可写**数据目录，存界面改过的登录密码哈希（`auth.json`） |
| `KUBECONFIG` | 空 | 额外 kubeconfig 文件路径（兼容旧的单文件挂载） |
| `KUBE_CONFIG_B64` | 空 | 直接注入 kubeconfig 的 base64 内容 |
| `PUBLIC_DIR` | `/app/public` | 前端静态资源目录 |
| `KUBE_REQUEST_TIMEOUT` | `30000` | 单请求超时（ms） |

集群加载顺序：目录扫描 → `KUBECONFIG` → `KUBE_CONFIG_B64` → in-cluster ServiceAccount → 都没有时回退本机默认 kubeconfig（方便本地开发）。

---

## 7. 生产 / 测试环境建议

| 项 | dev / 内网试用 | prod / 长期可用 |
|---|---|---|
| 密码 | 可用示例值 | 必须改，≥12 位，配合固定 `DASHBOARD_SECRET` |
| 传输 | HTTP 内网 | 前置 Nginx / traefik 做 HTTPS + 访问白名单，**不要把 9090 直接暴露公网** |
| 集群凭据目录 | 700 / 属主 10001 | 同左，宿主机磁盘加密更好；定期清理不再使用的 kubeconfig |
| K8s 权限 | admin kubeconfig 可接受 | 建专用 ServiceAccount，按最小权限收敛 `deploy/rbac.yaml` |
| 多用户 | 单账号 | 接 OAuth / SSO；当前无用户级 RBAC（KubePi 有，本版没有） |
| 审计 | 无 | 如需「谁在哪个集群删了什么」，需补操作审计 |
| 高可用 | 单副本 | 多副本 + 共享可写凭据目录 + 固定 Secret |

> **最大风险**：登录账号 + admin kubeconfig 意味着任何能打开页面的人都拥有该集群 admin 权限，包括 Web 终端；纳管多个集群后风险面按集群数放大。务必限制来源 IP、改密码、按最小权限发放 kubeconfig。

---

## 8. 常见坑

1. **凭据目录只读**：`-v ...:ro` 或目录属主不是 10001 时，导入集群会报「集群目录只读/不可写」。按 3.1 设属主并去掉 `:ro`。
2. **kubeconfig 权限**：容器内非 root (UID 10001) 读不了 `/root/.kube/config`（600 root 所有）。必须复制进目录并改属主。
3. **exec 凭据插件**：`exec:`（aws/gcp/oidc）或 `auth-provider` 在容器内没有对应 CLI，认证会失败。用内嵌证书 / Token 型 kubeconfig，或部署到集群内用 ServiceAccount。
4. **相对路径证书**：`certificate-authority: ./ca.crt` 在容器里找不到，用 `kubectl config view --raw --flatten` 展平。
5. **切换集群后数据没变**：所有请求必须带 `clusterId`；前端由 axios 拦截器自动注入，直接调 API 时别忘了（不带会回落到默认集群，指定不存在的 id 会 404）。
6. **`insecure-skip-tls-verify: true`**：内网可用，生产建议改成 CA 校验。
7. **metrics-server 未安装**：概览 CPU / 内存显示容量配额而非实时用量，不是故障。
8. **日志流不实时**：前置 Nginx 需 `proxy_buffering off;`（后端已发 `X-Accel-Buffering: no`）。
9. **Web 终端连不上**：需要 `pods/exec` 的 `create` 权限，且反代允许 WebSocket 升级。
10. **端口冲突**：该机 80/8080 被 traefik 占用、8000 被 blueops 占用，固定用 9090；换机器前先 `ss -ltnp | grep 9090`。
11. **JWT 在 URL 里**：SSE / WebSocket 无法自定义请求头，token 走 query，会进反代 access log，避免日志外泄。
12. **集群级资源详情**：Node / PV / StorageClass / Namespace / ClusterRole 等没有命名空间，列表显示为 `-`。前后端已统一把 `-` / `all` 归一为 `_all`（后端会去掉 `/namespaces/...` 段）；若自行拼 API 时把 `-` 当真实命名空间，会得到 404。详情页加载失败现在会明确报错，不再静默显示空白。
13. **重启 Pod ≠ 原地重启**：它是删除后由控制器重建，会有短暂中断；裸 Pod 会被拒绝。生产环境对关键业务 Pod 操作前先确认控制器存在，必要时用 `?dryRun=1` 预检。
14. **Harbor 用 IP + NodePort 访问必然证书不匹配**：保持「跳过 TLS 校验」开启，否则 `testRegistry` 报 `DEPTH_ZERO_SELF_SIGNED_CERT`。若 Harbor 开了匿名访问限制，项目列表会 401，此时在仓库编辑里填有权限的账号。
15. **Grafana 仪表盘嵌入空白**：Grafana 默认禁止被 iframe 嵌入，需要在 `grafana.ini` 设 `[security] allow_embedding = true` 并重启 Grafana；另外浏览器会拦住 `http` 页面里的 `https` 混合内容，注意协议一致。
16. **「YAML」点了不能改**：这是 v1.4.0 起的设计——列表「YAML」是只读预览，改要点弹窗右下角「编辑」或「更多 → 编辑 YAML」。只读态刻意没有导入/保存，避免手滑改错生产对象。

---

## 9. 自测 / 验证清单

```bash
# 健康检查（返回每个集群的状态）
curl -s http://127.0.0.1:9090/healthz

# 登录
curl -s -X POST http://127.0.0.1:9090/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Kp@2026ChangeMe"}'

# 集群列表（把 <TOKEN> 换成上一步的 token）
curl -s -H "Authorization: Bearer <TOKEN>" http://127.0.0.1:9090/api/v1/clusters

# 指定集群的资源（clusterId 取自上一步返回的 id）
curl -s -H "Authorization: Bearer <TOKEN>" "http://127.0.0.1:9090/api/v1/resources/_core/v1/pods?clusterId=c-xxxxxxxx"

# 集群详情（平台级，不改变当前集群）
curl -s -H "Authorization: Bearer <TOKEN>" "http://127.0.0.1:9090/api/v1/clusters/c-xxxxxxxx/detail"
```

```bash
# 重启 Pod 预检（只检查控制器，不删除任何 Pod）
curl -s -X POST -H "Authorization: Bearer <TOKEN>" \
  "http://127.0.0.1:9090/api/v1/pods/default/fluent-bit-mwbsq/restart?dryRun=1&clusterId=c-xxxxxxxx"
```

一键复验（31 项：健康检查、登录、集群注册表、导入/移除集群、6 类资源列表、ConfigMap CRUD 全链路、日志 SSE、事件、重启 Pod 预检、修改密码接口、镜像仓库列表与 Harbor 项目、监控配置、Pod 指标；临时资源自动清理）：

```bash
bash /opt/kubepanel/smoke-test.sh
```

界面自测顺序：登录 → 集群列表状态正常 → 进入控制台 → 概览数字对得上 → 切命名空间 → Pod 列表 → 详情 → 日志实时跟随 → Web 终端 `ls` → 新建小 Deployment → 扩缩容 → 重启 → 删除 → 顶部切换/返回集群列表 → 自定义资源页查看 CRD 实例。

---

## 10. 二次开发

```bash
cd frontend && npm install && npm run dev      # vite 已把 /api 代理到 8080
cd server && npm install && DASHBOARD_PASSWORD=dev123 node index.js
cd server && npm run check                     # 语法检查
cd frontend && npm run build                   # 构建验证
```

- 加内置资源菜单：改 `frontend/src/config/resources.js` 的 `navGroups`。
- 改表格列：改 `frontend/src/config/columns.js` 的 `KIND_COLS` 与 `normalizeRow`。
- 加新操作：后端 `server/src/routes.js` 加路由，前端 `src/api/index.js` 加方法。
- 所有集群内跳转必须走 `frontend/src/utils/path.js` 的 `cpath()`，否则 URL 会丢 `clusterId`。

---

## 11. 回滚与运维

```bash
docker logs --tail 100 kubepanel        # 排障
docker restart kubepanel
docker stop kubepanel && docker rm kubepanel
# 回滚：用 kubepanel:1.0.0 重新 docker run（旧版用单文件 KUBECONFIG 挂载）
```

`/healthz` 不需要认证，返回每个集群的连通状态，可接 Prometheus 黑盒探测或 K8s probe。集群异常时列表页标红并显示错误原因，控制台顶部显示错误横幅与「返回集群列表」。

---

## 12. 监控栈：Helm 部署 Prometheus + Grafana（已实测）

KubePanel 的「监控」页不自带存储与时序库，它的定位是**对接已有的 Grafana**。本集群用 `kube-prometheus-stack` 部署了一套，KubePanel 已自动接好。

### 12.1 实际部署信息

| 项 | 值 |
|---|---|
| Chart | `kube-prometheus-stack` **92.18.0**（Prometheus Operator v0.94.2） |
| Release / 命名空间 | `kps` / `monitoring` |
| 目录 | chart 与 values 在 `/opt/kube-prom/`（`values.yaml`、`kube-prometheus-stack-92.18.0.tgz`） |
| Grafana | `http://117.72.115.79:30300`（NodePort），管理密码在 `/opt/kube-prom/grafana-admin.txt`（600） |
| Prometheus | `http://117.72.115.79:30090`（NodePort，无认证） |
| 存储 | Prometheus 6Gi / Grafana 1Gi，storageClass `local-path`，均 Bound |
| 抓取 | 16 个 target 全 up（API Server / etcd / controller-manager / scheduler / kube-proxy / coredns / kubelet / node-exporter / kube-state-metrics / operator 等） |
| 仪表盘 | 28 个（Kubernetes 系列 + CoreDNS / etcd / Grafana Overview），由 sidecar 自动导入 |

### 12.2 从零重装（可复制）

```bash
# 1) 取 chart（该机 github.io 被墙，走 ghproxy 下载 release 包）
mkdir -p /opt/kube-prom && cd /opt/kube-prom
curl -sSL -o kube-prometheus-stack-92.18.0.tgz \
  "https://ghproxy.net/https://github.com/prometheus-community/helm-charts/releases/download/kube-prometheus-stack-92.18.0/kube-prometheus-stack-92.18.0.tgz"
tar -xzf kube-prometheus-stack-92.18.0.tgz

# 2) 先手动升级 CRD（chart 92 的 CRD 在 charts/crds/crds/，不在 crds/）
kubectl apply --server-side --force-conflicts -f kube-prometheus-stack/charts/crds/crds/

# 3) 预拉镜像（docker.io 走 daemon 加速后导入 containerd，其余 ctr 直连）
docker pull grafana/grafana:13.3.0-distroless && docker save grafana/grafana:13.3.0-distroless | ctr -n k8s.io images import -
for i in quay.io/prometheus-operator/prometheus-operator:v0.94.2 \
         quay.io/prometheus/prometheus:v3.15.1-distroless \
         quay.io/prometheus/node-exporter:v1.12.1-distroless; do
  ctr -n k8s.io images pull --hosts-dir /etc/containerd/certs.d "$i"
done

# 4) 安装
helm upgrade --install kps ./kube-prometheus-stack -n monitoring --create-namespace \
  -f values.yaml --skip-crds --set kube-state-metrics.image.tag=v2.15.0
```

> `--set kube-state-metrics.image.tag=v2.15.0` 是这台机器的特例：v2.20.0 在 `registry.k8s.io`（跳转 europe-west3-docker.pkg.dev）与各镜像站都拉不到，本机已有 v2.15.0 可直接用。换机器若网络正常可去掉。

### 12.3 values 关键取舍（单节点 4C/16G 已用 60%）

```yaml
crds.enabled: false                 # CRD 已手动 apply，避免 helm 冲突
alertmanager.enabled: false         # 省资源；需要告警时再打开
prometheusOperator.admissionWebhooks.enabled: false   # 少一个挂钩 Job，降低失败面
prometheus.prometheusSpec:
  retention: 7d / retentionSize: 4GB
  scrapeInterval: 30s               # 默认 30s，够用且省 CPU
grafana.grafana.ini:
  security.allow_embedding: true    # 允许被 KubePanel iframe 嵌入
  auth.anonymous: {enabled: true, org_role: Viewer}   # 嵌入时免登录，只读
```

### 12.4 接入 KubePanel

「监控」页填地址 + 服务账号 Token 即可；本次已自动写入（`/app/data/monitor.json`）：

```bash
# 在 Grafana 建一个 Viewer 服务账号并签发 Token
curl -u admin:<密码> -X POST -H 'Content-Type: application/json' \
  -d '{"name":"kubepanel","role":"Viewer"}' http://172.16.0.3:30300/api/serviceaccounts
curl -u admin:<密码> -X POST -H 'Content-Type: application/json' \
  -d '{"name":"kubepanel"}' http://172.16.0.3:30300/api/serviceaccounts/<id>/tokens | grep -o '"key":"[^"]*"'
```

### 12.5 安全提示（务必看）

- **Grafana 开了匿名 Viewer**：为了 iframe 免登录，任何人只要知道 `:30300` 就能看所有看板（节点名、Pod 名、镜像、请求量）。想关掉：把 `auth.anonymous.enabled` 改 `false` 后 `helm upgrade`，副作用是 KubePanel 嵌入页会显示登录框。
- **Prometheus `:30090` 完全没有认证**：暴露的是全量指标。生产环境请用安全组限制来源 IP，或改成 ClusterIP 只在内网 port-forward 访问。
- 想要更彻底：把 Grafana 改成 ClusterIP，由 KubePanel 反代 `/grafana` 同源访问（需要改后端加代理，目前未做）。

### 12.6 常用运维

```bash
helm -n monitoring list
helm -n monitoring get values kps | head -40
kubectl -n monitoring get pods,pvc
helm -n monitoring upgrade kps /opt/kube-prom/kube-prometheus-stack -f /opt/kube-prom/values.yaml --skip-crds
helm -n monitoring uninstall kps && kubectl delete ns monitoring     # 卸载（PVC 会随 ns 删除）
```
