#!/usr/bin/env bash
# KubePanel 部署后冒烟测试（多集群版）
# 用法：bash /opt/kubepanel/smoke-test.sh
# 覆盖：健康检查、登录、集群注册表、导入/移除集群、只读接口、CRUD 全链路、日志 SSE、事件
# 说明：会在 default 命名空间创建并删除一个临时 ConfigMap；导入测试会临时写一个 kubeconfig 文件后清理。
set -uo pipefail

BASE="http://127.0.0.1:9090"
API="$BASE/api/v1"
USER_NAME="admin"
# 界面上改过密码后，用 DASHBOARD_PASSWORD 环境变量传入新密码即可：
#   DASHBOARD_PASSWORD='新密码' bash /opt/kubepanel/smoke-test.sh
PASSWORD="${DASHBOARD_PASSWORD:-Kp@2026ChangeMe}"
PASS=0
FAIL=0

ok()   { echo "  [OK]   $1"; PASS=$((PASS+1)); }
bad()  { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "=== 1. 健康检查 ==="
HZ=$(curl -s -m 8 "$BASE/healthz")
echo "$HZ" | grep -q '"status":"ok"' && ok "healthz = ok" || bad "healthz 异常: $HZ"

echo "=== 2. 登录 ==="
TOKEN=$(curl -s -m 8 -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER_NAME\",\"password\":\"$PASSWORD\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
[ -n "$TOKEN" ] && ok "登录成功 (token ${#TOKEN} 字符)" || { echo "  无法获取 token，后续测试跳过"; exit 1; }
AUTH="Authorization: Bearer $TOKEN"

echo "=== 3. 集群注册表（多集群） ==="
CL=$(curl -s -m 30 -H "$AUTH" "$API/clusters")
CNT=$(echo "$CL" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))' 2>/dev/null)
CID=$(echo "$CL" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if d else "")' 2>/dev/null)
[ "${CNT:-0}" -ge 1 ] && ok "已纳管 ${CNT} 个集群" || { echo "  没有可用集群，后续测试跳过"; exit 1; }
echo "$CL" | python3 -c 'import sys,json;[print("  - %s | %s | %s | %s"%(c["name"],c["version"],"正常" if c["healthy"] else "异常",c["server"])) for c in json.load(sys.stdin)]' 2>/dev/null
Q="clusterId=$CID"
echo "  使用集群: $CID"

TESTR=$(curl -s -m 10 -X POST -H "$AUTH" "$API/clusters/$CID/test")
echo "$TESTR" | grep -q '"ok":true' && ok "集群连通性测试" || bad "集群连通性测试 -> ${TESTR:0:150}"

echo "=== 4. 导入 / 移除集群（验证挂载目录可写） ==="
KCFILE=$(ls /opt/kubepanel/clusters/*.yaml 2>/dev/null | head -1)
if [ -n "$KCFILE" ]; then
  PAYLOAD=$(python3 -c 'import json,sys;print(json.dumps({"name":"kubepanel-selftest-cluster","kubeconfig":open(sys.argv[1]).read()}))' "$KCFILE")
  ADD=$(curl -s -m 20 -X POST -H "$AUTH" -H 'Content-Type: application/json' "$API/clusters" -d "$PAYLOAD")
  NEWID=$(echo "$ADD" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["ids"][0] if d.get("ids") else "")' 2>/dev/null)
  if [ -n "$NEWID" ]; then
    ok "导入集群成功 ($NEWID)"
    DEL=$(curl -s -m 10 -X DELETE -H "$AUTH" "$API/clusters/$NEWID")
    echo "$DEL" | grep -q 'removed' && ok "移除集群成功（凭据文件已清理）" || bad "移除集群失败 -> ${DEL:0:150}"
  else
    bad "导入集群失败 -> ${ADD:0:200}"
  fi
else
  echo "  [SKIP] 未找到集群目录中的 kubeconfig 文件，跳过导入测试"
fi

echo "=== 5. 只读接口（带 clusterId） ==="
CLUSTER=$(curl -s -m 20 -H "$AUTH" "$API/cluster?$Q")
echo "$CLUSTER" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("  k8s=%s  namespaces=%d  resources=%d"%(d["version"],len(d["namespaces"]),d["resourceTypes"]))' 2>/dev/null \
  && ok "cluster 信息" || bad "cluster 信息 -> ${CLUSTER:0:150}"

OVERVIEW=$(curl -s -m 20 -H "$AUTH" "$API/overview?$Q")
echo "$OVERVIEW" | python3 -c 'import sys,json;d=json.load(sys.stdin);s=d["stat"];print("  nodes=%d pods=%d deployments=%d services=%d unhealthy=%d metrics=%s"%(s["nodes"],s["pods"],s["deployments"],s["services"],s["unhealthyPods"],d["metricsAvailable"]))' 2>/dev/null \
  && ok "overview 统计" || bad "overview 统计 -> ${OVERVIEW:0:150}"

DISC=$(curl -s -m 30 -H "$AUTH" "$API/resources?$Q")
DCOUNT=$(echo "$DISC" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))' 2>/dev/null)
[ "${DCOUNT:-0}" -gt 50 ] && ok "API 发现 $DCOUNT 种资源（含 CRD）" || bad "API 发现仅 ${DCOUNT:-0} 种"

for EP in "_core/v1/nodes" "_core/v1/namespaces" "_core/v1/pods" "_core/v1/services" "apps/v1/deployments" "_core/v1/configmaps"; do
  OUT=$(curl -s -m 20 -H "$AUTH" "$API/resources/$EP?$Q")
  echo "$OUT" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert "items" in d' >/dev/null 2>&1 \
    && ok "list $EP" || bad "list $EP -> ${OUT:0:120}"
done

echo "=== 6. CRUD 全链路（临时 ConfigMap） ==="
CM="$API/resources/_core/v1/configmaps/default/kubepanel-selftest?$Q"
curl -s -m 10 -X DELETE -H "$AUTH" "$CM" >/dev/null 2>&1

APPLY=$(curl -s -m 15 -X POST -H "$AUTH" -H 'Content-Type: application/json' "$API/apply?$Q" \
  -d '{"yaml":"apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: kubepanel-selftest\n  namespace: default\ndata:\n  phase: created\n"}')
echo "$APPLY" | grep -q '"ok":true' && ok "apply 创建" || bad "apply 创建 -> ${APPLY:0:200}"

GET=$(curl -s -m 10 -H "$AUTH" "$CM")
echo "$GET" | grep -q 'kubepanel-selftest' && ok "get 读取" || bad "get 读取 -> ${GET:0:150}"

PATCH=$(curl -s -m 10 -X PATCH -H "$AUTH" -H 'Content-Type: application/json' "$CM" -d '{"data":{"phase":"patched"}}')
echo "$PATCH" | grep -q '"phase": "patched"\|"phase":"patched"' && ok "patch 更新" || bad "patch 更新 -> ${PATCH:0:150}"

# PUT 前必须重新 GET 最新对象，否则 PATCH 之后的旧 resourceVersion 会触发 409 乐观锁冲突
LATEST=$(curl -s -m 10 -H "$AUTH" "$CM")
PUT=$(curl -s -m 10 -X PUT -H "$AUTH" -H 'Content-Type: application/json' "$CM" \
  -d "$(echo "$LATEST" | python3 -c 'import sys,json;d=json.load(sys.stdin);d["data"]={"phase":"replaced"};print(json.dumps(d))')")
echo "$PUT" | grep -q 'replaced' && ok "put 整体替换" || bad "put 整体替换 -> ${PUT:0:150}"

DEL=$(curl -s -m 10 -X DELETE -H "$AUTH" "$CM")
echo "$DEL" | grep -q 'Success\|"kind":"Status"\|"kind":"ConfigMap"' && ok "delete 删除" || bad "delete 删除 -> ${DEL:0:150}"
CODE=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H "$AUTH" "$CM")
[ "$CODE" = "404" ] && ok "删除后 get 返回 404" || bad "删除后 get 返回 $CODE"

echo "=== 7. Pod 日志流 / 事件 ==="
POD=$(curl -s -m 15 -H "$AUTH" "$API/resources/_core/v1/pods?$Q" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);p=next((x for x in d["items"] if x.get("status",{}).get("phase")=="Running"),None);print("%s %s %s"%(p["metadata"]["namespace"],p["metadata"]["name"],p["spec"]["containers"][0]["name"]) if p else "")' 2>/dev/null)
if [ -n "$POD" ]; then
  set -- $POD
  LOG=$(curl -s -m 15 -H "$AUTH" "$API/pods/$1/$2/logs?container=$3&tailLines=3&follow=0&$Q")
  echo "$LOG" | grep -q '^data:' && ok "日志 SSE ($1/$2/$3)" || bad "日志 SSE -> ${LOG:0:150}"
  EV=$(curl -s -m 15 -H "$AUTH" "$API/pods/$1/$2/events?$Q")
  echo "$EV" | grep -q '"kind":"EventList"' && ok "Pod 事件" || bad "Pod 事件 -> ${EV:0:150}"
  # dryRun 只做预检，不会真的删除任何 Pod
  DRY=$(curl -s -m 15 -X POST -H "$AUTH" "$API/pods/$1/$2/restart?dryRun=1&$Q")
  echo "$DRY" | grep -q '"wouldRestart":true' && ok "重启 Pod 预检（dryRun，不删除）" || bad "重启 Pod 预检 -> ${DRY:0:180}"
else
  echo "  [SKIP] 集群中没有 Running Pod"
fi

echo "=== 8. 账号（修改密码接口，不做真实变更） ==="
PROF=$(curl -s -m 10 -H "$AUTH" "$API/auth/profile")
echo "$PROF" | grep -q '"username"' && ok "profile 读取（来源 $(echo "$PROF" | grep -o '"passwordSource":"[a-z]*"' | cut -d'"' -f4)）" || bad "profile -> ${PROF:0:150}"
CODE=$(curl -s -m 10 -o /tmp/kp_pwd1.json -w '%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"currentPassword":"__definitely_wrong__","newPassword":"Whatever!123"}' "$API/auth/password")
[ "$CODE" = "400" ] && ok "当前密码错误被拒绝（400）" || bad "错误当前密码返回 $CODE -> $(head -c 120 /tmp/kp_pwd1.json)"
CODE=$(curl -s -m 10 -o /tmp/kp_pwd2.json -w '%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"currentPassword\":\"${PASSWORD}\",\"newPassword\":\"123\"}" "$API/auth/password")
[ "$CODE" = "400" ] && ok "弱密码被拒绝（400）" || bad "弱密码校验返回 $CODE -> $(head -c 120 /tmp/kp_pwd2.json)"

echo "=== 9. 镜像仓库 / 监控 / Pod 指标 ==="
REG=$(curl -s -m 20 -H "$AUTH" "$API/registries")
echo "$REG" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("  registries=%d %s"%(len(d),d[0]["name"] if d else ""))' 2>/dev/null \
  && ok "镜像仓库列表" || bad "镜像仓库列表 -> ${REG:0:150}"
RID=$(echo "$REG" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if d else "")' 2>/dev/null)
if [ -n "$RID" ]; then
  PROJ=$(curl -s -m 25 -H "$AUTH" "$API/registries/$RID/projects")
  echo "$PROJ" | grep -q '"name"' && ok "Harbor 项目列表" || bad "Harbor 项目列表 -> ${PROJ:0:150}"
else
  echo "  [SKIP] 尚未添加镜像仓库"
fi
MON=$(curl -s -m 10 -H "$AUTH" "$API/monitor")
echo "$MON" | grep -q '"url"' && ok "监控配置读取" || bad "监控配置 -> ${MON:0:150}"
PM=$(curl -s -m 25 -H "$AUTH" "$API/metrics/pods?$Q")
echo "$PM" | grep -q '"available"' && ok "Pod 指标接口" || bad "Pod 指标 -> ${PM:0:150}"

echo
echo "=== 汇总：通过 $PASS，失败 $FAIL ==="
[ "$FAIL" -eq 0 ] || exit 1
