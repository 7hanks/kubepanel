<template>
  <component :is="embedded ? 'div' : PlatformLayout" active="registries">
    <template v-if="!embedded" #actions>
      <el-button size="small" :loading="loading" circle @click="load"><el-icon><Refresh /></el-icon></el-button>
    </template>

    <main class="plat-main" :class="{ 'platform-embedded-main': embedded }">
      <div class="page-head">
        <div>
          <h1>镜像仓库</h1>
          <p class="kp-muted">
            对接 Harbor 的 API v2.0：浏览项目 / 仓库 / 标签，复制 <code>docker pull</code> 地址。
            凭据只保存在服务端，浏览器不直连仓库。
          </p>
        </div>
        <div style="display:flex;gap:8px">
          <el-button v-if="embedded" :loading="loading" :icon="Refresh" @click="load">刷新</el-button>
          <el-button v-if="canCreateReg" :icon="MagicStick" @click="openDiscover">从集群发现</el-button>
          <el-button v-if="canCreateReg" type="primary" :icon="Plus" @click="openAdd">添加仓库</el-button>
        </div>
      </div>

      <div class="kp-stat-grid" style="margin-bottom:16px">
        <div class="kp-stat"><div class="label">仓库数</div><div class="value">{{ registries.length }}</div>
          <el-icon class="icon"><Box /></el-icon></div>
        <div class="kp-stat"><div class="label">连接正常</div>
          <div class="value" :class="okCount ? 'kp-ok' : ''">{{ okCount }}</div>
          <el-icon class="icon"><CircleCheck /></el-icon></div>
        <div class="kp-stat"><div class="label">连接异常</div>
          <div class="value" :class="badCount ? 'kp-danger' : ''">{{ badCount }}</div>
          <el-icon class="icon"><Warning /></el-icon></div>
      </div>

      <div class="kp-card" style="padding:0">
        <el-table :data="registries" v-loading="loading" size="small" style="width:100%">
          <el-table-column label="名称" min-width="150">
            <template #default="{ row }">
              <div style="display:flex;align-items:center;gap:8px">
                <span class="dot" :class="row.health ? (row.health.ok ? 'ok' : 'bad') : 'unknown'" />
                <strong style="font-weight:600">{{ row.name }}</strong>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="100">
            <template #default="{ row }"><el-tag disable-transitions size="small" effect="plain">{{ row.type === 'harbor' ? 'Harbor' : row.type }}</el-tag></template>
          </el-table-column>
          <el-table-column label="地址" min-width="220">
            <template #default="{ row }"><span class="kp-mono kp-muted">{{ row.url }}</span></template>
          </el-table-column>
          <el-table-column label="镜像地址前缀" min-width="200">
            <template #default="{ row }">
              <span class="kp-mono">{{ row.host }}</span>
              <el-button link type="primary" size="small" style="margin-left:6px" @click="copy(row.host)">复制</el-button>
            </template>
          </el-table-column>
          <el-table-column label="认证" width="110">
            <template #default="{ row }">
              <span class="kp-muted" style="font-size:12px">{{ row.username ? row.username : '匿名' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="120">
            <template #default="{ row }">
              <el-tag disable-transitions v-if="row.health" :type="row.health.ok ? 'success' : 'danger'" size="small" effect="light">
                {{ row.health.ok ? '正常' : '异常' }}
              </el-tag>
              <span v-else class="kp-muted" style="font-size:12px">未测试</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="220" fixed="right" align="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="browse(row)">浏览</el-button>
              <el-button link type="primary" size="small" :loading="testing === row.id" @click="test(row)">测试</el-button>
              <el-button link type="primary" size="small" :disabled="!canUpdateReg" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" size="small" :disabled="!canDeleteReg" @click="remove(row)">移除</el-button>
            </template>
          </el-table-column>
          <template #empty>
            <div class="kp-empty">
              还没有添加镜像仓库。点右上角「添加仓库」，或先「从集群发现」自动填入 Harbor 的 NodePort 地址。
            </div>
          </template>
        </el-table>
      </div>

      <!-- 添加 / 编辑 -->
      <el-dialog v-model="formVisible" :title="editingId ? '编辑镜像仓库' : '添加镜像仓库'" width="560px" top="10vh">
        <el-form label-position="top">
          <el-form-item label="名称">
            <el-input v-model="form.name" placeholder="例如 harbor（留空则用地址）" />
          </el-form-item>
          <el-form-item label="地址">
            <el-input v-model="form.url" placeholder="https://172.16.0.3:30003" />
            <div class="kp-muted" style="font-size:12px;margin-top:4px">
              Harbor 的 Web 地址（含协议与 NodePort）。用 IP + NodePort 访问时证书通常不匹配，保持下方「跳过证书校验」开启即可。
            </div>
          </el-form-item>
          <el-form-item label="用户名 / 密码（可选，公开项目可留空）">
            <div style="display:flex;gap:8px;width:100%">
              <el-input v-model="form.username" placeholder="用户名" style="flex:1" />
              <el-input v-model="form.password" type="password" show-password :placeholder="editingId ? '留空表示不修改' : '密码 / CLI secret'" style="flex:1" />
            </div>
          </el-form-item>
          <el-form-item label="信任 CA（PEM，可选）"><el-input v-model="form.ca" type="textarea" :rows="4" placeholder="自签证书请提供 CA；编辑时留空保留已保存 CA" /></el-form-item>
          <el-form-item>
            <el-checkbox v-model="form.insecure">跳过 TLS 证书校验（仅在明确了解风险时开启）</el-checkbox>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="formVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="submitForm">{{ editingId ? '保存' : '添加' }}</el-button>
        </template>
      </el-dialog>

      <!-- 从集群发现 -->
      <el-dialog v-model="discoverVisible" title="从集群发现镜像仓库" width="620px" top="10vh">
        <el-alert type="info" :closable="false" style="margin-bottom:12px">
          扫描集群里带 NodePort 的 Service，用「节点 IP + nodePort」拼出地址。默认优先 <code>harbor</code> 命名空间。
        </el-alert>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <el-input v-model="discoverNs" size="small" placeholder="命名空间（留空=全集群）" style="width:200px" />
          <el-button size="small" :loading="discovering" @click="runDiscover">开始扫描</el-button>
        </div>
        <el-table :data="candidates" size="small" max-height="320" v-loading="discovering">
          <el-table-column prop="name" label="Service" min-width="150" show-overflow-tooltip />
          <el-table-column prop="url" label="候选地址" min-width="200">
            <template #default="{ row }"><span class="kp-mono" style="font-size:12px">{{ row.url }}</span></template>
          </el-table-column>
          <el-table-column label="" width="80" align="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="useCandidate(row)">使用</el-button>
            </template>
          </el-table-column>
          <template #empty><div class="kp-empty">没有扫描到带 NodePort 的 Service</div></template>
        </el-table>
        <template #footer><el-button @click="discoverVisible = false">关闭</el-button></template>
      </el-dialog>

      <!-- 浏览项目 / 仓库 / 标签 -->
      <el-drawer v-model="browseVisible" :title="`浏览 · ${browseRegistry?.name || ''}`" size="820px" destroy-on-close>
        <div v-loading="browseLoading">
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
            <span class="kp-muted" style="font-size:12.5px">项目</span>
            <el-select v-model="project" size="small" style="width:220px" @change="changeProject">
              <el-option v-for="p in projects" :key="p.name" :label="`${p.name}（${p.repoCount} 仓库）`" :value="p.name" />
            </el-select>
            <el-tag disable-transitions v-if="currentProject?.public" size="small" type="success" effect="plain">公开</el-tag>
            <span style="flex:1" />
            <el-input v-model="repoFilter" size="small" placeholder="过滤仓库名" clearable style="width:180px" />
          </div>

          <el-pagination v-model:current-page="projectPage.page" :page-size="projectPage.pageSize" :total="projectPage.total" layout="total, prev, pager, next" size="small" aria-label="项目分页" @current-change="loadProjects" style="margin-bottom:12px" />
          <el-alert v-if="browseError" type="error" :title="browseError" :closable="false" style="margin-bottom:12px"><el-button @click="loadProjects">重试</el-button></el-alert>
          <p class="kp-muted" v-if="repoFilter">仓库名筛选只覆盖当前页。</p>
          <el-table :data="filteredRepos" @expand-change="expandRepository" size="small" row-key="name">
            <el-table-column type="expand">
              <template #default="{ row }">
                <div style="padding:6px 10px 12px 42px" v-loading="!!artifactsLoading[row.name]">
                  <div v-if="!artifacts[row.name]" class="kp-muted" style="font-size:12px">展开即加载标签…</div>
                  <el-alert v-if="artifactErrors[row.name]" type="error" :title="artifactErrors[row.name]" :closable="false"><el-button @click="loadArtifacts(row, artifactPages[row.name]?.page || 1)">重试</el-button></el-alert>
                  <el-table v-if="artifacts[row.name]" :data="artifacts[row.name]" size="small" border>
                    <el-table-column label="标签" min-width="140">
                      <template #default="{ row: a }">
                        <el-tag disable-transitions v-for="t in a.tags" :key="t" size="small" effect="plain" style="margin-right:4px">{{ t }}</el-tag>
                        <span v-if="!a.tags.length" class="kp-mono kp-muted" style="font-size:12px">{{ a.shortDigest }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="大小" width="90">
                      <template #default="{ row: a }">{{ fmtSize(a.size) }}</template>
                    </el-table-column>
                    <el-table-column label="推送时间" width="160">
                      <template #default="{ row: a }">{{ fmtTime(a.pushTime) }}</template>
                    </el-table-column>
                    <el-table-column label="拉取地址" min-width="240">
                      <template #default="{ row: a }">
                        <div class="kp-mono" style="font-size:11.5px;word-break:break-all">{{ a.pullRefs[0] }}</div>
                      </template>
                    </el-table-column>
                    <el-table-column label="" width="80" align="right">
                      <template #default="{ row: a }">
                        <el-button link type="primary" size="small" @click="copyPull(a)">复制</el-button>
                      </template>
                    </el-table-column>
                  </el-table>
                  <el-pagination v-if="artifactPages[row.name]" v-model:current-page="artifactPages[row.name].page" :page-size="artifactPages[row.name].pageSize" :total="artifactPages[row.name].total" layout="total, prev, pager, next" size="small" :aria-label="`${row.name} 制品分页`" @current-change="p=>loadArtifacts(row,p)" />
                </div>
              </template>
            </el-table-column>
            <el-table-column label="仓库" min-width="220">
              <template #default="{ row }">
                <span class="kp-mono">{{ row.shortName }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="artifactCount" label="制品" width="70" align="center" />
            <el-table-column prop="pullCount" label="拉取" width="70" align="center" />
            <el-table-column label="更新时间" width="150">
              <template #default="{ row }">{{ fmtTime(row.updatedAt) }}</template>
            </el-table-column>
            <el-table-column label="" width="90" align="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="copy(row.pullRef)">复制地址</el-button>
              </template>
            </el-table-column>
            <template #empty><div class="kp-empty">该项目下没有仓库</div></template>
          </el-table>
          <el-pagination v-model:current-page="repoPage.page" :page-size="repoPage.pageSize" :total="repoPage.total" layout="total, prev, pager, next" size="small" aria-label="仓库分页" @current-change="loadRepos" style="margin-top:12px" />
        </div>
      </el-drawer>
    </main>
  </component>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Box, CircleCheck, Warning, MagicStick } from '@element-plus/icons-vue'
import { canCreate, canUpdate, canDelete } from '../utils/perm'
import PlatformLayout from '../layout/PlatformLayout.vue'
import api from '../api'
import {normalizePage} from '../utils/pagination'
import {createRequestGate} from '../utils/resource'

const canCreateReg = computed(() => canCreate('registry'))
const canUpdateReg = computed(() => canUpdate('registry'))
const canDeleteReg = computed(() => canDelete('registry'))
defineProps({ embedded: { type: Boolean, default: false } })

const loading = ref(false)
const saving = ref(false)
const testing = ref('')
const registries = ref([])
const formVisible = ref(false)
const editingId = ref('')
const form = reactive({ name: '', url: '', username: '', password: '', insecure: false, ca: '' })

const discoverVisible = ref(false)
const discovering = ref(false)
const discoverNs = ref('harbor')
const candidates = ref([])

const browseVisible = ref(false)
const browseLoading = ref(false)
const browseRegistry = ref(null)
const projects = ref([])
const project = ref('')
const repos = ref([])
const repoFilter = ref('')
const artifacts = reactive({})
const artifactsLoading = reactive({})
const artifactErrors=reactive({})
const artifactPages=reactive({})
const projectPage=reactive({page:1,pageSize:20,total:0})
const repoPage=reactive({page:1,pageSize:20,total:0})
const browseError=ref('')
const projectGate=createRequestGate(),repoGate=createRequestGate()
let artifactEpoch=0
const artifactRequests=new Map()

const okCount = computed(() => registries.value.filter(r => r.health?.ok).length)
const badCount = computed(() => registries.value.filter(r => r.health && !r.health.ok).length)
const currentProject = computed(() => projects.value.find(p => p.name === project.value))
const filteredRepos = computed(() => {
  const f = repoFilter.value.trim().toLowerCase()
  return f ? repos.value.filter(r => r.name.toLowerCase().includes(f)) : repos.value
})

async function load() {
  loading.value = true
  try {
    registries.value = await api.registries()
    // 首次进来没有健康状态时静默测一遍，避免列表里一直是「未测试」
    const need = registries.value.filter(r => !r.health)
    if (need.length) {
      await Promise.all(need.map(r => api.testRegistry(r.id).catch(() => null)))
      registries.value = await api.registries()
    }
  } catch (e) { registries.value = [] }
  finally { loading.value = false }
}

function openAdd() {
  editingId.value = ''
  Object.assign(form, { name: '', url: '', username: '', password: '', insecure: false, ca: '' })
  formVisible.value = true
}
function openEdit(row) {
  editingId.value = row.id
  Object.assign(form, { name: row.name, url: row.url, username: row.username, password: '', insecure: row.insecure, ca:'' })
  formVisible.value = true
}

async function submitForm() {
  if (!form.url.trim()) return ElMessage.warning('请填写仓库地址')
  saving.value = true
  try {
    if (editingId.value) await api.updateRegistry(editingId.value, { ...form,...(!form.ca.trim() ? {ca:undefined} : {}) })
    else await api.addRegistry({ ...form,...(!form.ca.trim() ? {ca:undefined} : {}) })
    ElMessage.success(editingId.value ? '已保存' : '已添加')
    formVisible.value = false
    await load()
    const target = registries.value.find(r => form.url && r.url.replace(/\/$/, '') === form.url.replace(/\/$/, ''))
    if (target) test(target)
  } catch (e) { /* 拦截器已提示 */ }
  finally { saving.value = false }
}

async function test(row) {
  testing.value = row.id
  try {
    const r = await api.testRegistry(row.id)
    if (r.ok) ElMessage.success(`连接正常${r.version ? ' · ' + r.version : ''} · ${r.ms}ms`)
    else ElMessage.error(`连接失败：${r.message}`)
    await load()
  } catch (e) { /* 拦截器已提示 */ }
  finally { testing.value = '' }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定移除镜像仓库「${row.name}」吗？只删除本平台的配置，不会影响 Harbor 本身。`, '移除仓库',
      { type: 'warning', confirmButtonText: '确定移除', confirmButtonClass: 'el-button--danger' })
    await api.removeRegistry(row.id)
    ElMessage.success('已移除')
    await load()
  } catch (e) { /* 取消 */ }
}

function openDiscover() {
  discoverVisible.value = true
  candidates.value = []
}
async function runDiscover() {
  discovering.value = true
  try {
    const clusterId = localStorage.getItem('kp_cluster') || ''
    candidates.value = await api.discoverRegistries(clusterId, discoverNs.value.trim())
    if (!candidates.value.length) ElMessage.info('没有扫描到带 NodePort 的 Service')
  } catch (e) { /* 拦截器已提示 */ }
  finally { discovering.value = false }
}
function useCandidate(row) {
  discoverVisible.value = false
  openAdd()
  form.name = row.likelyHarbor ? 'harbor' : row.service
  form.url = row.url
  form.insecure = false
}

function resetArtifacts() {
 artifactEpoch++
 for(const map of [artifacts,artifactsLoading,artifactErrors,artifactPages]) for(const key of Object.keys(map)) delete map[key]
 artifactRequests.clear()
}
async function browse(row) {
 browseRegistry.value=row; browseVisible.value=true; projects.value=[]; repos.value=[]; project.value='';repoFilter.value=''
 projectPage.page=1;projectPage.total=0;repoPage.page=1;repoPage.total=0;resetArtifacts()
 await loadProjects()
}
async function loadProjects() {
 const request=projectGate.next(),registryId=browseRegistry.value?.id
 if(!registryId)return
 repoGate.invalidate();resetArtifacts();projects.value=[];repos.value=[];project.value='';repoPage.total=0;repoPage.page=1
 browseLoading.value=true;browseError.value=''
 try {
  const data=normalizePage(await api.registryProjects(registryId,{page:projectPage.page,pageSize:projectPage.pageSize}),projectPage)
  if(!projectGate.current(request))return
  projects.value=data.items;Object.assign(projectPage,{page:data.page,pageSize:data.pageSize,total:data.total})
  if(projects.value.length){project.value=projects.value[0].name;await loadRepos()}
 } catch(e){if(projectGate.current(request))browseError.value=e.message || '项目加载失败'}
 finally{if(projectGate.current(request))browseLoading.value=false}
}
function changeProject(){repoPage.page=1;repoFilter.value='';return loadRepos()}
async function loadRepos() {
 if(!project.value || !browseRegistry.value)return
 const request=repoGate.next(),registryId=browseRegistry.value.id,projectName=project.value
 resetArtifacts();repos.value=[];browseLoading.value=true;browseError.value=''
 try {
  const data=normalizePage(await api.registryRepositories(registryId,projectName,{page:repoPage.page,pageSize:repoPage.pageSize}),repoPage)
  if(!repoGate.current(request))return
  repos.value=data.items;Object.assign(repoPage,{page:data.page,pageSize:data.pageSize,total:data.total})
 }catch(e){if(repoGate.current(request))browseError.value=e.message || '仓库加载失败'}
 finally{if(repoGate.current(request))browseLoading.value=false}
}
function expandRepository(row,expandedRows){if(expandedRows.some(r=>r.name===row.name) && !artifacts[row.name])loadArtifacts(row,1)}
async function loadArtifacts(row,page=1) {
 const epoch=artifactEpoch,request=Symbol(),registryId=browseRegistry.value?.id,projectName=project.value
 if(!registryId)return
 artifactRequests.set(row.name,request);artifactsLoading[row.name]=true;artifactErrors[row.name]=''
 try {
  const data=normalizePage(await api.registryArtifacts(registryId,projectName,row.name,{page,pageSize:20}),{page,pageSize:20})
  if(epoch!==artifactEpoch || artifactRequests.get(row.name)!==request)return
  artifacts[row.name]=data.items;artifactPages[row.name]={page:data.page,pageSize:data.pageSize,total:data.total}
 }catch(e){if(epoch===artifactEpoch && artifactRequests.get(row.name)===request){artifacts[row.name]=[];artifactErrors[row.name]=e.message || '制品加载失败'}}
 finally{if(epoch===artifactEpoch && artifactRequests.get(row.name)===request)artifactsLoading[row.name]=false}
}
onUnmounted(()=>{projectGate.invalidate();repoGate.invalidate();resetArtifacts()})

function copy(text) {
  navigator.clipboard?.writeText(text)
    .then(() => ElMessage.success('已复制'))
    .catch(() => ElMessage.error('复制失败'))
}
function copyPull(a) {
  copy(`docker pull ${a.pullRefs[0]}`)
}
function fmtSize(n) {
  if (!n) return '-'
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GiB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`
  return `${Math.round(n / 1024)} KiB`
}
function fmtTime(v) {
  if (!v) return '-'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

onMounted(load)
</script>

<style scoped>
.plat-page { min-height: 100vh; background: var(--kp-bg); }
.plat-main { max-width: 1280px; margin: 0 auto; padding: 24px 22px 48px; }
.plat-main.platform-embedded-main { max-width: none; margin: 0; padding: 0; }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
.page-head h1 { margin: 0; font-size: 21px; font-weight: 650; letter-spacing: -.02em; }
.page-head p { margin: 6px 0 0; font-size: 12px; max-width: 720px; line-height: 1.6; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.dot.ok { background: #16a34a; box-shadow: 0 0 0 3px rgba(22,163,74,.12); }
.dot.bad { background: #dc2626; box-shadow: 0 0 0 3px rgba(220,38,38,.12); }
.dot.unknown { background: #cbd5e1; }
</style>
