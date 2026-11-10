# 部署、备份与可回滚发布

## 目录与版本

运行数据固定放在 `/opt/kubepanel/data`、`/opt/kubepanel/clusters`；源码可在 `/opt/kubepanel/app`。正式发布保留不可变 `/opt/kubepanel/releases/<完整Git SHA>`。备份默认在 `/opt/kubepanel-backups/<UTC时间>-<随机后缀>`，不在源码、构建目录或运行数据目录内。

每个纯源码包含 `RELEASE`（完整 40 位 Git revision）和 `SHA256SUMS`（所有源文件的 SHA-256，排除这两个元数据文件）。`manifest.py verify` 同时拒绝文件变化、缺失、额外文件及路径穿越。服务器没有 `.git` 也可核验。不得手工 `docker exec` 修改代码。

运行镜像包含 OCI `org.opencontainers.image.revision`、`io.kubepanel.source-manifest-sha256` 标签；`/livez` 与 `/readyz` 返回相同 revision 与 `sourceManifestSha256`。公共探针不包含集群地址、账号或错误详情。

## 固定发布顺序

1. 本地完成代码评审、后端 check/test、前端 test/build、清单测试与脚本语法检查。提交本地 Git，得到最终 revision；之后不要修改该 revision 的源码。
2. 从该 commit 归档到一个**不存在的暂存目录**，由工具生成元数据，不复制工作区中的 `.env`、依赖或本地资料。把该目录或其 tar 包传到服务器全新暂存目录。
3. 服务器核验清单，从相同源码运行测试并构建候选镜像；备份后在 loopback 随机端口启动候选容器，候选使用生产数据快照的私有副本，绝不共享生产可写数据卷。
4. 候选通过探针、版本清单、人工登录和只读资源检查后，切生产，保留原容器与原镜像用于回滚。切换前暂停原写入者并做最终一致备份。发布过程有短暂停机。
5. 生产通过检查后，推送已验证的同一 commit 到 GitHub main，等待 CI。
6. 比对本地 HEAD、GitHub main、服务器 `RELEASE`、源码 `SHA256SUMS` 摘要、运行镜像标签以及探针。只有全部相等才算发布完成；任何后续代码修复都要产生新 revision 并重复该流程。

本地归档示例（Python 3.8+）：

```bash
revision=$(git rev-parse HEAD)
python3 deploy/manifest.py stage . "$revision" /secure-staging/kubepanel-"$revision"
python3 deploy/manifest.py verify /secure-staging/kubepanel-"$revision"
```

源文件应通过 Git archive 输出，避免 Windows 工作区 CRLF 与 Linux 产生不同摘要。`stage` 拒绝覆盖已有目录、符号链接和受保护目录。归档里不能含运行数据。`create` 仅供受控纯源码目录使用，日常发布使用 `stage`。

## 备份

```bash
sudo BASE_DIR=/opt/kubepanel CONTAINER=kubepanel bash deploy/backup.sh
```

脚本以 `umask 077` 创建私有目录，短暂停止正在运行的容器，归档 data、clusters、现有 `.env` 与 Compose 文件，并保存私有 container inspect 供恢复参考。显式设置 `ENV_FILE` 时，无论该文件是否位于 base 目录下，均额外私密复制为 `deployment.env` 并纳入校验和。退出时恢复原先运行的容器。只输出备份路径，不输出凭据或 inspect 内容。备份含密钥和集群权限，权限为目录 0700 / 文件 0600；自行纳入受控加密异地备份与保留策略。默认不会自动删除任何备份。

备份不属于源码清单。不要上传到 GitHub 或公开问题记录。

## 发布脚本

Linux 主机需要 root、Docker（含 BuildKit）、Bash、Python 3.8+、curl、flock；服务器能访问锁定依赖的 npm 仓库及基础镜像。环境文件推荐放在 `/opt/kubepanel/.env`，默认也兼容现有 `/opt/kubepanel/app/.env`，或通过 `ENV_FILE` 显式指定。首次部署显式设置强密码；数据卷属主为 10001。

```bash
sudo BASE_DIR=/opt/kubepanel ENV_FILE=/opt/kubepanel/.env \
  BIND_ADDRESS=0.0.0.0 HOST_PORT=9090 \
  bash /secure-staging/kubepanel-<revision>/deploy/release.sh /secure-staging/kubepanel-<revision>
```

这是独立 `docker run` 发布器；Compose 管理或特殊 Docker 网络 / 额外挂载的实例，先由维护者确认并保留所有原启动参数，再采用对应的切换方式。脚本不主动迁移外部部署编排。不要在同一实例上混用 Compose 自动重建与此发布器。

脚本使用发布锁；拒绝覆盖同 revision 的已有发布目录；运行镜像内测试；创建私有备份和候选快照；loopback 候选通过检查后保留旧容器名称为 `kubepanel-rollback-<UTC>`，按原数据卷启动新版本。生产检查失败时移除失败的新容器并恢复旧容器，保留诊断快照、旧镜像和全部备份。发布路径、candidate 路径、备份路径均在构建上下文之外。不会执行 `docker compose down -v`、volume prune 或删除运行目录。

默认自动检查只验证探针、revision 与清单，并明确输出仅完成基础检查。生产发布可额外设置 `CANDIDATE_CHECK=/secure/path/executable-check`：脚本在候选就绪后、生产切换前调用该可执行文件，仅传入候选 base URL 一个参数。钩子执行登录、权限和业务只读检查，凭据从私有文件获取，不放进源码包或命令参数；输出被抑制。钩子非零退出会取消发布，保留当前生产容器和运行数据。候选快照含生产凭据，检查时只执行只读资源请求。

## 核验与回滚

```bash
bash /opt/kubepanel/releases/<revision>/deploy/verify.sh /opt/kubepanel/releases/<revision> http://127.0.0.1:9090
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' kubepanel
```

清单摘要可用 `sha256sum SHA256SUMS` 比较本地、GitHub 同 commit 的独立归档和服务器。GitHub ref 由维护者通过 `git ls-remote origin refs/heads/main` 核对；不要只比较标签名或网页显示版本。`.git` 目录无须上传到服务器。

成功后如需人工回滚，先确认准确的旧容器名，停止新版本，把新容器改为一个尚未使用的故障保留名，再将旧容器改回 `kubepanel` 并启动。保留同样的 data/clusters 挂载和密钥。不要恢复备份覆盖正在写入的目录。旧镜像不理解新数据格式时，应先停止所有写入者，再由维护者把匹配备份恢复到**新的恢复目录**，验证后切换挂载；备份不能自动合并发布后的用户改动。

## Kubernetes 与访问

`deploy/deployment.yaml` 分别持久化 data/clusters，单副本 Recreate 避免 JSON 多写入者，使用 `/livez` 与 `/readyz`，并取消固定默认密码。先创建 `kubepanel-auth` Secret，设置真实强密码，再替换不可变镜像版本。PVC 的 StorageClass、访问控制与备份快照由集群维护者按实际环境配置。

当前保持 IP+9090 的 HTTP 访问；尚无域名，未配置受信任 HTTPS 入口。HTTP 登录、会话和业务流量仍可被链路上的监听者读取；本轮未消除此传输风险。后续增加 HTTPS 入口时按受信代理配置 `TRUST_PROXY`，并考虑把绑定地址改为 loopback。Harbor/Grafana TLS 校验与浏览器到面板的 HTTP 是两条独立链路。
