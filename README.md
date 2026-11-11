# KubePanel

轻量级 Kubernetes 多集群管理控制台，通过浏览器查看集群状态、排查工作负载问题、编辑资源和执行常用运维操作。

前端采用 Vue 3 / Element Plus，后端采用 Express，打包为单个非 root Docker 镜像。使用 `docker run` 部署，启动时直接指定登录密码，无需环境变量配置文件或 Docker Compose。

![KubePanel 集群概览](deploy/screenshots/console-overview.png)

上图使用测试数据，展示异常概览、Pod 资源用量和节点诊断。

## 主要功能

- **多集群管理**：导入 kubeconfig、切换集群、检查连通性、提示客户端证书到期情况。
- **资源管理**：浏览工作负载、网络、配置、存储、RBAC 和自定义资源，支持筛选、分页、完整/精简 YAML 查看及编辑。
- **日常运维**：Pod 日志与终端、扩缩容、滚动重启、发布历史与回滚、CronJob 手动运行及暂停。
- **节点维护**：维护预检、驱逐与排空，检查控制器、存储风险及 PodDisruptionBudget 阻塞。
- **变更检查**：新建资源、Apply、服务端 dry-run、修改前后对照和逐项执行结果。
- **权限与审计**：账号、角色、集群/命名空间/资源范围授权，以及敏感操作独立授权和操作记录。
- **外部集成**：Harbor 项目/仓库/镜像浏览与分页、Grafana 接入和 Kubernetes 指标展示。

指标展示需要集群提供对应 Metrics API；Harbor 和 Grafana 需要配置真实服务地址与凭据。

YAML 详情页与编辑弹窗支持切换「完整 YAML / 精简 YAML」。精简版隐藏运行信息、Pod 自动挂载的标准 API Token 卷、CNI 运行注解及常见默认值，保留自定义配置，支持复制与下载；编辑仍使用完整草稿。若资源保存了有效的 `last-applied-configuration`，会参考它保留显式声明的默认字段，但内容仍取当前对象。没有原始记录时采用规则精简，不能保证还原最初文件或注释；重新部署前应核对导出内容。

## 快速部署

以下命令用于**全新 Linux 部署**，以 root 执行。宿主机需安装 Git 和 Docker，能够访问基础镜像及 npm 仓库。已有实例请先阅读[升级与回滚](docs/deployment.md)。

### 1. 获取源码并构建镜像

```bash
git clone https://github.com/7hanks/kubepanel.git
cd kubepanel

REVISION=$(git rev-parse HEAD)
docker build \
  --build-arg BUILD_REVISION="$REVISION" \
  -t "kubepanel:$REVISION" .
```

该方式在本机构建镜像，不依赖预先发布的 Docker Hub 镜像。后续命令继续使用 `REVISION`，请在同一个 Bash 会话执行。

### 2. 创建持久化目录

```bash
install -d -m 700 -o 10001 -g 10001 \
  /opt/kubepanel/data \
  /opt/kubepanel/clusters
```

容器使用 UID/GID `10001:10001` 运行，这两个目录需要允许该用户读写。

### 3. 启动容器并指定密码

将 `REPLACE_WITH_YOUR_STRONG_PASSWORD` 替换为自己的强密码：

```bash
docker run -d \
  --name kubepanel \
  --restart unless-stopped \
  -p 9090:8080 \
  -e DASHBOARD_USERNAME=admin \
  -e DASHBOARD_PASSWORD='REPLACE_WITH_YOUR_STRONG_PASSWORD' \
  -v /opt/kubepanel/data:/app/data \
  -v /opt/kubepanel/clusters:/app/kube/clusters \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --log-opt max-size=20m \
  --log-opt max-file=3 \
  "kubepanel:$REVISION"
```

浏览器打开 `http://服务器IP:9090`。账号为 `admin`，密码为启动时指定的值。默认时区为 `Asia/Shanghai`。

`DASHBOARD_PASSWORD` 设置内置管理员的**初始密码**。在界面修改密码后，以数据目录保存的密码哈希为准，重新传入这个变量不会覆盖已修改的密码。升级时保持管理员用户名与原实例一致。

若不想把密码写入 Shell 历史，可这样读取密码，并将启动命令中的密码参数改为 `-e DASHBOARD_PASSWORD`：

```bash
read -rsp '请输入初始密码: ' DASHBOARD_PASSWORD
printf '\n'
export DASHBOARD_PASSWORD
# 执行上面的 docker run，使用 -e DASHBOARD_PASSWORD 传入密码
unset DASHBOARD_PASSWORD
```

Docker 管理员仍可查看容器环境变量；不要公开含密码的启动命令或 `docker inspect` 输出。

### 4. 登录并添加集群

在集群管理页添加集群并导入 kubeconfig。面板登录账号与集群凭据相互独立，实际操作还受 kubeconfig 对应的 Kubernetes RBAC 权限限制。

配置应包含可从容器访问的 API Server 地址，并使用内联证书/密钥或 Token。可在已有 `kubectl` 配置的可信机器上导出当前 context：

```bash
umask 077
kubectl config view --raw --flatten --minify > cluster.yaml
```

`cluster.yaml` 含集群凭据，导入后妥善保管，不要提交到 Git。外部凭据插件（`exec`、`auth-provider`）、本地证书/密钥文件路径和 `tokenFile` 不受支持；这类集群需另行准备适合服务端使用的最小权限身份。

## 启动参数

可在 `docker run` 中增加 `-e 变量名=值`：

- `DASHBOARD_USERNAME`：内置管理员用户名，默认 `admin`。
- `DASHBOARD_PASSWORD`：内置管理员初始密码，新安装时显式指定。
- `DASHBOARD_TOKEN_TTL`：会话有效期，默认 `12h`。
- `DASHBOARD_SECRET`：可选签名与加密密钥；未指定时自动生成并保存在 `/app/data/.jwt-secret`。已有实例若显式设置过此变量，升级必须继续使用原值。
- `TZ`：容器时区，默认 `Asia/Shanghai`。
- `KUBE_REQUEST_TIMEOUT`：Kubernetes 请求超时，单位毫秒，默认 `30000`。
- `TERMINAL_IDLE_MS` / `TERMINAL_MAX_MS`：终端空闲/最长连接时长，默认分别为 15/60 分钟。
- `TRUST_PROXY`：可信反向代理配置，默认不信任代理头；仅在实际部署可信代理后设置。
- `DASHBOARD_COOKIE_SECURE`：设为 `true` 时仅通过 HTTPS 发送会话 Cookie；直接使用 HTTP 时保持默认。

修改宿主机端口：将 `-p 9090:8080` 改为 `-p 你的端口:8080`。使用本机 HTTPS 反向代理时，可改为 `-p 127.0.0.1:9090:8080`。

## 数据与备份

必须保留两个挂载目录：

- `/opt/kubepanel/data`：账号、角色、密码哈希、会话、审计、集成配置和持久化密钥。
- `/opt/kubepanel/clusters`：已导入的 kubeconfig。

重建或升级容器时复用原目录。不要删除数据目录来重置密码，也不要只备份账号文件而遗漏密钥。Harbor/Grafana 凭据写入时加密，恢复密文时需要配套的原密钥。

从源码目录执行备份：

```bash
bash deploy/backup.sh
```

默认备份到 `/opt/kubepanel-backups/`。脚本短暂停止面板容器以取得一致快照，完成后恢复其原有运行状态。备份含敏感凭据，应私密保存。

当前采用持久化 JSON 存储，按单实例运行。多个容器不能同时写入同一份数据目录。

## 检查与排障

```bash
docker ps --filter name=kubepanel
docker logs --tail 100 kubepanel
curl --fail http://127.0.0.1:9090/livez
curl --fail http://127.0.0.1:9090/readyz
```

- **无法登录**：核对用户名；已有数据且曾修改密码时，使用界面修改后的密码。登录失败过多会触发临时限速。
- **数据目录无法写入**：检查挂载路径与 `10001:10001` 的读写权限，保留原数据后再修复权限。
- **集群连接失败**：检查 API Server 的网络可达性、CA、凭据有效期及 Kubernetes RBAC。容器中的 `127.0.0.1` 指向容器自身。
- **没有 CPU/内存指标**：检查集群 Metrics API 是否可用；资源查询与指标采集独立。
- **Harbor/Grafana 证书错误**：配置正确 CA；界面支持显式配置 TLS 校验选项。

`/livez` 检查进程存活，`/readyz` 检查应用就绪，`/healthz` 是兼容入口。探针成功不代表每个集群都连通，集群状态需登录查看。

直接使用 IP+端口时为 HTTP，登录与业务流量没有传输加密。公网使用应限制访问来源，或配置 HTTPS 入口。

## 升级与源码同步

[部署文档](docs/deployment.md)提供固定 Git 提交构建、私有备份、独立候选容器、自动回滚和源码清单核验流程。发布器使用 `docker run`，支持直接传入密码。

需要保持本地、GitHub 和服务器一致时，按同一提交归档并发布：服务器 `/opt/kubepanel/app` 指向当前已验证的源码版本，镜像标签及探针记录对应提交与清单摘要。不要进入容器手改代码。

## 本地开发

需要 Node.js 22+。在源码目录执行：

```bash
npm --prefix server ci
npm --prefix frontend ci

# 在终端一启动后端（默认开发数据目录为 server/data）
DASHBOARD_PASSWORD='REPLACE_WITH_A_DEV_PASSWORD' npm --prefix server start

# 在终端二启动前端，访问命令输出的地址
npm --prefix frontend run dev
```

验证代码：

```bash
npm --prefix server run check
npm --prefix server test
npm --prefix frontend test
npm --prefix frontend run build
python3 deploy/test_manifest.py
python3 deploy/test_release.py
```

发布脚本行为测试在 Linux 上执行。`deploy/verify.sh` 仅核对版本与源码；`deploy/smoke-test.sh` 会创建/删除测试资源，不要直接用于生产只读验收。

更多说明：[架构](docs/architecture.md) · [部署与回滚](docs/deployment.md) · [Kubernetes 部署模板](deploy/deployment.yaml) · [Kubernetes RBAC 模板](deploy/rbac.yaml)。
