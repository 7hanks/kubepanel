# KubePanel 架构与发布约定

## 目标

轻量多集群 Kubernetes 运维控制台。采用 Vue 3 / Element Plus 前端、Express 后端和单 Docker 镜像。保持单副本可维护性，以明确的模块、授权边界、自动化测试与不可变发布提高可靠性。

本轮按用户已批准的评审修复安全/正确性/交互问题，并补诊断、发布回滚、节点维护、网络与任务的常用操作。保留现有账号、角色和集群凭据。SSO 的身份源、受信 HTTPS 域名与组织策略需要真实部署配置，不虚构外部集成。

## 边界

- `server/src/access.js`：平台与资源权限、cluster/namespace/GVR/verb 范围。
- `server/src/auth.js` / `sessionService.js`：登录、限速、可撤销会话、密码变更及长连接复核。
- `server/src/auditService.js`：脱敏、分页操作审计；不记录请求体或 Secret 内容。
- `server/src/kube.js` / `clusterService.js`：受信 kubeconfig、客户端与 API discovery。
- `server/src/actions.js` / `operations.js`：受授权的资源变更、预检与可追踪结果。
- `server/src/routes.js`：协议适配、授权与参数验证，不隐藏 API 错误。
- `frontend/src/utils/`：可单测的状态、selector、筛选、结果与路由元数据。
- `deploy/`：备份、可回滚发布、版本/源文件清单验证和部署示例。

## 授权模型

角色保留对象/动作矩阵并增加敏感操作权限。新增 `cluster:import`、`cluster:remove`、`pod:exec`、`pod:logs`、`secret:read`、`rbac:write`、`node:maintain`、`audit:list`。普通资源创建不能纳管集群或打开 shell。角色 `scope` 使用 `{ clusters: ['*'], namespaces: ['*'], resources: ['*'] }`，resources 为 `group/plural`（core 组使用 `_core`）。缺省 scope 与旧角色兼容为全部范围；空数组代表无授权。权限增加采取显式授予，旧只读角色不自动拥有 Secret 读取权。

范围必须在后端执行。受限 namespace 的账号不能读取集群级资源；跨 namespace 的列表仅可返回已授权范围；Secret 未授权时服务端不返回敏感值。RBAC 写入与终端权限单独判定。超级管理员保留全权限。

## 变更语义

资源新建使用 POST，已存在报冲突；更新使用 PUT/PATCH 并保留乐观锁。Apply 需要同时拥有创建与更新能力，默认不强制接管字段；支持 dry-run 与逐项结果。重要操作显示目标集群、namespace、对象和影响。Pod 重建通过有效 controller 与 Eviction/PDB 保护。节点 drain 保留预算与异常解释，不强制绕过阻塞。

## 数据与部署

当前 JSON 数据卷维持单副本；原子写入、错误关闭、安全权限与备份。没有扩多副本前不引入数据库集群。若需要多实例，迁移到事务数据库和共享会话，不能简单共享可写 JSON 文件。

运行数据位于 `/opt/kubepanel/data`，集群凭据位于 `/opt/kubepanel/clusters`，不进 Git、源码包或构建上下文。应用源码位于 `/opt/kubepanel/app`。

每次发布使用同一 Git commit 的归档和源文件 SHA-256 清单，镜像嵌入 revision 标签；备份运行数据、保留旧镜像；通过存活/就绪/登录及只读资源验证后发布 GitHub main，并核对本地 HEAD、GitHub ref、服务器 RELEASE 与文件清单。部署失败回滚旧镜像。后续更新重复此流程，避免手工 docker exec 修改源码。
