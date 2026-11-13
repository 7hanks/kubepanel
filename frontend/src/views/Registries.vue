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
            选择已配置的 Harbor，浏览项目、镜像仓库与标签，复制 <code>docker pull</code> 地址。
          </p>
        </div>
        <div style="display:flex;gap:8px">
          <el-button v-if="embedded" :loading="loading" :icon="Refresh" @click="load">刷新</el-button>
          <el-button v-if="canCreateReg" :icon="MagicStick" @click="openDiscover">从集群发现</el-button>
          <el-button v-if="canCreateReg" type="primary" :icon="Plus" @click="openAdd">添加仓库</el-button>
        </div>
      </div>

      <div class="kp-stat-grid" style="margin-bottom:16px">
        <button type="button" class="kp-stat registry-stat" :class="{ selected: registryFilter === 'all' }" :aria-pressed="registryFilter === 'all'" @click="registryFilter = 'all'"><div class="label">已配置仓库</div><div class="value">{{ registries.length }}</div>
          <span class="stat-hint">查看全部连接配置</span><el-icon class="icon"><Box /></el-icon></button>
        <button type="button" class="kp-stat registry-stat" :class="{ selected: registryFilter === 'ok' }" :aria-pressed="registryFilter === 'ok'" @click="registryFilter = 'ok'"><div class="label">连接正常</div>
          <div class="value" :class="okCount ? 'kp-ok' : ''">{{ okCount }}</div>
          <span class="stat-hint">查看可用连接</span><el-icon class="icon"><CircleCheck /></el-icon></button>
        <button type="button" class="kp-stat registry-stat" :class="{ selected: registryFilter === 'bad' }" :aria-pressed="registryFilter === 'bad'" @click="registryFilter = 'bad'"><div class="label">连接异常</div>
          <div class="value" :class="badCount ? 'kp-danger' : ''">{{ badCount }}</div>
          <span class="stat-hint">查看失败原因</span><el-icon class="icon"><Warning /></el-icon></button>
      </div>

      <el-alert v-if="registryError" type="error" :title="registryError" :closable="false" class="registry-alert"><el-button link type="primary" @click="load()">重新加载</el-button></el-alert>
      <div class="kp-card" style="padding:0">
        <div class="registry-list-head"><span>{{ registryFilterLabel }} · {{ filteredRegistries.length }} 个</span><span class="kp-muted">配置数不代表 Harbor 内的镜像数量</span><el-button v-if="registryFilter !== 'all'" link type="primary" @click="registryFilter = 'all'">清除筛选</el-button></div>
        <el-table :data="filteredRegistries" v-loading="loading" size="small" style="width:100%">
          <el-table-column label="名称" min-width="150">
            <template #default="{ row }">
              <div style="display:flex;align-items:center;gap:8px">
                <span class="dot" :class="row.health ? (row.health.ok ? 'ok' : 'bad') : 'unknown'" />
                <el-button link type="primary" class="registry-name" @click="browse(row)">{{ row.name }}</el-button>
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
              <span class="kp-muted">{{ row.username || '匿名' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="最近测试" min-width="200">
            <template #default="{ row }">
              <el-tag disable-transitions v-if="row.health" :type="row.health.ok ? 'success' : 'danger'" size="small" effect="light">
                {{ healthLabel(row.health) }}
              </el-tag>
              <span v-else class="kp-muted">未测试</span>
              <div v-if="row.health?.message" class="health-message" :class="{ 'kp-danger': !row.health.ok }">{{ row.health.message }}</div>
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
              {{ registryError ? '仓库配置加载失败，请重新加载。' : registryFilter !== 'all' ? '没有符合当前状态的仓库，可清除筛选查看全部。' : '还没有添加镜像仓库。点右上角「添加仓库」，或「从集群发现」填入地址。' }}
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
      <el-drawer v-model="browseVisible" :title="`浏览 · ${browseRegistry?.name || ''}`" size="min(1080px, 100vw)" class="registry-drawer" destroy-on-close>
        <div class="registry-browser">
          <div class="browser-address kp-muted">{{ browseRegistry?.url }}</div>
          <section class="browser-section" aria-labelledby="registry-projects-heading" v-loading="projectsLoading">
            <div class="browser-heading"><h2 id="registry-projects-heading">项目</h2><span class="kp-muted">共 {{ projectPage.total }} 个</span><el-button link type="primary" :disabled="projectsLoading" @click="loadProjects">刷新项目</el-button></div>
            <el-alert v-if="projectError" type="error" :title="projectError" :closable="false" class="registry-alert"><el-button link type="primary" @click="loadProjects">重试</el-button></el-alert>
            <div v-else-if="projects.length" class="project-selector">
              <el-select v-model="project" aria-label="选择项目" @change="changeProject">
                <el-option v-for="p in projects" :key="p.name" :label="`${p.name}（${p.repoCount} 个仓库）`" :value="p.name" />
              </el-select>
              <el-tag v-if="currentProject" disable-transitions :type="currentProject.public ? 'success' : 'info'" effect="plain">{{ currentProject.public ? '公开项目' : '私有项目' }}</el-tag>
              <span v-if="currentProject" class="kp-muted">{{ currentProject.repoCount }} 个镜像仓库</span>
            </div>
            <div v-else-if="!projectsLoading" class="browser-empty">当前账号没有可见项目。请检查 Harbor 中的项目和账号权限，或编辑仓库认证信息后重试。</div>
            <el-pagination v-if="projectPage.total > projectPage.pageSize" v-model:current-page="projectPage.page" :page-size="projectPage.pageSize" :total="projectPage.total" layout="total, prev, pager, next" size="small" aria-label="项目分页" @current-change="loadProjects" />
          </section>

          <section v-if="project" class="browser-section" aria-labelledby="registry-repositories-heading" v-loading="reposLoading">
            <div class="browser-heading"><h2 id="registry-repositories-heading">镜像仓库</h2><span class="kp-muted">{{ project }} · 共 {{ repoPage.total }} 个</span></div>
            <el-alert v-if="repoError" type="error" :title="repoError" :closable="false" class="registry-alert"><el-button link type="primary" @click="loadRepos">重试</el-button></el-alert>
            <template v-else>
              <div class="repository-filter"><el-input v-model="repoFilter" placeholder="筛选当前页仓库名" aria-label="筛选当前页仓库名" clearable /><span v-if="repoFilter" class="kp-muted">筛选只覆盖当前页</span></div>
              <el-table :data="filteredRepos" size="small" row-key="name" :row-class-name="repositoryRowClass">
                <el-table-column label="仓库名称" min-width="210">
                  <template #default="{ row }"><el-button link type="primary" class="repository-name" @click="selectRepository(row,{reveal:true,refresh:true})">{{ row.name }}</el-button></template>
                </el-table-column>
                <el-table-column prop="artifactCount" label="镜像 / 制品" width="110" align="center" />
                <el-table-column prop="pullCount" label="拉取次数" width="90" align="center" />
                <el-table-column label="更新时间" min-width="165"><template #default="{ row }">{{ fmtTime(row.updatedAt) }}</template></el-table-column>
                <el-table-column label="操作" width="160" align="right"><template #default="{ row }"><el-button link type="primary"  :loading="!!artifactsLoading[row.name]" @click="selectRepository(row,{reveal:true,refresh:true})">查看标签</el-button><el-button link type="primary" @click="copy(row.pullRef)">复制地址</el-button></template></el-table-column>
                <template #empty><div class="kp-empty">{{ reposLoading ? '正在加载镜像仓库…' : repoFilter ? '当前页没有匹配的仓库，请修改筛选。' : '该项目下没有镜像仓库。' }}</div></template>
              </el-table>
              <el-pagination v-if="repoPage.total" v-model:current-page="repoPage.page" :page-size="repoPage.pageSize" :total="repoPage.total" layout="total, prev, pager, next" size="small" aria-label="仓库分页" @current-change="loadRepos" />
            </template>
          </section>

          <section v-if="selectedRepository" ref="artifactSection" tabindex="-1" class="browser-section artifact-section" aria-labelledby="registry-artifacts-heading" v-loading="!!artifactsLoading[selectedRepository.name]">
            <div class="browser-heading"><h2 id="registry-artifacts-heading">镜像与标签</h2><span v-if="currentArtifactPage" class="kp-muted">共 {{ currentArtifactPage.total }} 个镜像 / 制品</span><el-button link type="primary" :disabled="artifactsLoading[selectedRepository.name]" @click="loadArtifacts(selectedRepository, currentArtifactPage?.page || 1)">刷新标签</el-button></div>
            <div class="repository-path">{{ selectedRepository.name }}</div>
            <el-alert v-if="artifactErrors[selectedRepository.name]" type="error" :title="artifactErrors[selectedRepository.name]" :closable="false" class="registry-alert"><el-button link type="primary" @click="loadArtifacts(selectedRepository, currentArtifactPage?.page || 1)">重试</el-button></el-alert>
            <template v-else>
              <article v-for="a in currentArtifacts" :key="a.digest" class="artifact-item">
                <div class="artifact-tags"><span class="kp-muted">标签</span><el-tag v-for="tag in a.tags" :key="tag" disable-transitions effect="plain">{{ tag }}</el-tag><span v-if="!a.tags?.length" class="kp-muted">无标签，可通过 digest 拉取</span></div>
                <dl class="artifact-metadata"><div><dt>大小</dt><dd>{{ fmtSize(a.size) }}</dd></div><div><dt>推送时间</dt><dd>{{ fmtTime(a.pushTime) }}</dd></div><div class="artifact-digest"><dt>Digest</dt><dd class="kp-mono">{{ a.digest || '—' }}</dd></div></dl>
                <div v-for="pullRef in a.pullRefs" :key="pullRef" class="artifact-pull"><code>docker pull {{ pullRef }}</code><el-button link type="primary" @click="copy(`docker pull ${pullRef}`)">复制命令</el-button></div>
              </article>
              <div v-if="!currentArtifacts.length && !artifactsLoading[selectedRepository.name]" class="browser-empty">该仓库下没有镜像或制品。</div>
              <el-pagination v-if="currentArtifactPage?.total" :current-page="currentArtifactPage.page" :page-size="currentArtifactPage.pageSize" :total="currentArtifactPage.total" layout="total, prev, pager, next" size="small" :aria-label="`${selectedRepository.name} 制品分页`" @current-change="p => loadArtifacts(selectedRepository, p)" />
            </template>
          </section>
        </div>
      </el-drawer>
    </main>
  </component>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Box, CircleCheck, Warning, MagicStick } from '@element-plus/icons-vue'
import { canCreate, canUpdate, canDelete } from '../utils/perm'
import PlatformLayout from '../layout/PlatformLayout.vue'
import api from '../api'
import {normalizePage} from '../utils/pagination'
import {createRequestGate} from '../utils/resource'
import { copyText } from '../utils/clipboard'

const canCreateReg = computed(() => canCreate('registry'))
const canUpdateReg = computed(() => canUpdate('registry'))
const canDeleteReg = computed(() => canDelete('registry'))
defineProps({ embedded: { type: Boolean, default: false } })

const loading = ref(false)
const saving = ref(false)
const testing = ref('')
const registries = ref([])
const registryError = ref('')
const registryFilter = ref('all')
const formVisible = ref(false)
const editingId = ref('')
const form = reactive({ name: '', url: '', username: '', password: '', insecure: false, ca: '' })

const discoverVisible = ref(false)
const discovering = ref(false)
const discoverNs = ref('harbor')
const candidates = ref([])

const browseVisible = ref(false)
const projectsLoading = ref(false)
const reposLoading = ref(false)
const browseRegistry = ref(null)
const projects = ref([])
const project = ref('')
const repos = ref([])
const repoFilter = ref('')
const selectedRepository = ref(null)
const artifactSection = ref(null)
const artifacts = reactive({})
const artifactsLoading = reactive({})
const artifactErrors=reactive({})
const artifactPages=reactive({})
const projectPage=reactive({page:1,pageSize:20,total:0})
const repoPage=reactive({page:1,pageSize:20,total:0})
const projectError = ref('')
const repoError = ref('')
const projectGate=createRequestGate(),repoGate=createRequestGate()
let artifactEpoch=0
const artifactRequests=new Map()

const okCount = computed(() => registries.value.filter(r => r.health?.ok).length)
const badCount = computed(() => registries.value.filter(r => r.health && !r.health.ok).length)
const registryFilterLabel = computed(() => ({ all: '全部仓库配置', ok: '连接正常的仓库', bad: '连接异常的仓库' })[registryFilter.value])
const filteredRegistries = computed(() => registries.value.filter(r => registryFilter.value === 'all' || (registryFilter.value === 'ok' ? r.health?.ok : r.health && !r.health.ok)))
const currentProject = computed(() => projects.value.find(p => p.name === project.value))
const currentArtifacts = computed(() => artifacts[selectedRepository.value?.name] || [])
const currentArtifactPage = computed(() => artifactPages[selectedRepository.value?.name])
const filteredRepos = computed(() => {
  const f = repoFilter.value.trim().toLowerCase()
  return f ? repos.value.filter(r => r.name.toLowerCase().includes(f)) : repos.value
})

async function load({ autoTest = true } = {}) {
  loading.value = true
  registryError.value = ''
  try {
    registries.value = await api.registries()
    // 首次进来没有健康状态时静默测一遍，避免列表里一直是「未测试」
    const need = registries.value.filter(r => !r.health)
    if (autoTest && need.length) {
      await Promise.all(need.map(r => api.testRegistry(r.id).catch(() => null)))
      registries.value = await api.registries()
    }
  } catch (e) { registryError.value = e.message || '仓库配置加载失败' }
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
    const saved = editingId.value
      ? await api.updateRegistry(editingId.value, { ...form,...(!form.ca.trim() ? {ca:undefined} : {}) })
      : await api.addRegistry({ ...form,...(!form.ca.trim() ? {ca:undefined} : {}) })
    ElMessage.success(editingId.value ? '已保存' : '已添加')
    formVisible.value = false
    await load({ autoTest: false })
    if (saved?.id) await test(saved)
  } catch (e) { /* 拦截器已提示 */ }
  finally { saving.value = false }
}

async function test(row) {
  testing.value = row.id
  try {
    const r = await api.testRegistry(row.id)
    if (r.ok) ElMessage.success(`${healthLabel(r)}${r.version ? ' · ' + r.version : ''} · ${r.ms}ms`)
    else ElMessage.error(`连接失败：${r.message}`)
    await load({ autoTest: false })
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
  selectedRepository.value = null
  for (const map of [artifacts, artifactsLoading, artifactErrors, artifactPages]) {
    for (const key of Object.keys(map)) delete map[key]
  }
  artifactRequests.clear()
}
function resetBrowser() {
  projectGate.invalidate()
  repoGate.invalidate()
  resetArtifacts()
  browseRegistry.value = null
  projects.value = []
  project.value = ''
  repos.value = []
  repoFilter.value = ''
  projectPage.page = 1
  projectPage.total = 0
  repoPage.page = 1
  repoPage.total = 0
  projectError.value = ''
  repoError.value = ''
  projectsLoading.value = false
  reposLoading.value = false
}
async function browse(row) {
  resetBrowser()
  browseRegistry.value = row
  browseVisible.value = true
  await loadProjects()
}
async function loadProjects() {
  const request = projectGate.next(), registryId = browseRegistry.value?.id
  if (!registryId) return
  repoGate.invalidate()
  resetArtifacts()
  projects.value = []
  repos.value = []
  project.value = ''
  repoFilter.value = ''
  repoPage.total = 0
  repoPage.page = 1
  projectsLoading.value = true
  reposLoading.value = false
  projectError.value = ''
  repoError.value = ''
  try {
    const data = normalizePage(await api.registryProjects(registryId, { page: projectPage.page, pageSize: projectPage.pageSize }), projectPage)
    if (!projectGate.current(request)) return
    projects.value = data.items
    Object.assign(projectPage, { page: data.page, pageSize: data.pageSize, total: data.total })
    projectsLoading.value = false
    if (projects.value.length) {
      project.value = projects.value[0].name
      await loadRepos()
    }
  } catch (e) {
    if (projectGate.current(request)) projectError.value = e.message || '项目加载失败'
  } finally {
    if (projectGate.current(request)) projectsLoading.value = false
  }
}
function changeProject() {
  repoPage.page = 1
  repoFilter.value = ''
  return loadRepos()
}
async function loadRepos() {
  if (!project.value || !browseRegistry.value) return
  const request = repoGate.next(), registryId = browseRegistry.value.id, projectName = project.value
  resetArtifacts()
  repos.value = []
  repoPage.total = 0
  reposLoading.value = true
  repoError.value = ''
  try {
    const data = normalizePage(await api.registryRepositories(registryId, projectName, { page: repoPage.page, pageSize: repoPage.pageSize }), repoPage)
    if (!repoGate.current(request)) return
    repos.value = data.items
    Object.assign(repoPage, { page: data.page, pageSize: data.pageSize, total: data.total })
    reposLoading.value = false
    if (repos.value.length) await selectRepository(repos.value[0])
  } catch (e) {
    if (repoGate.current(request)) repoError.value = e.message || '镜像仓库加载失败'
  } finally {
    if (repoGate.current(request)) reposLoading.value = false
  }
}
async function selectRepository(row,{reveal=false,refresh=false}={}) {
  selectedRepository.value = row
  if ((refresh || !artifacts[row.name]) && !artifactsLoading[row.name]) await loadArtifacts(row, 1)
  if(reveal){await nextTick();artifactSection.value?.scrollIntoView({block:'start',behavior:'smooth'});artifactSection.value?.focus({preventScroll:true})}
}
function repositoryRowClass({ row }) {
  return selectedRepository.value?.name === row.name ? 'selected-repository' : ''
}
async function loadArtifacts(row,page=1) {
  const epoch = artifactEpoch, request = Symbol(), registryId = browseRegistry.value?.id, projectName = project.value
  if (!registryId || !projectName || !row) return
  artifactRequests.set(row.name, request)
  artifactsLoading[row.name] = true
  artifactErrors[row.name] = ''
  delete artifacts[row.name]
  artifactPages[row.name] = { page, pageSize: 20, total: artifactPages[row.name]?.total || 0 }
  try {
    const data = normalizePage(await api.registryArtifacts(registryId, projectName, row.name, { page, pageSize: 20 }), { page, pageSize: 20 })
    if (epoch !== artifactEpoch || artifactRequests.get(row.name) !== request) return
    artifacts[row.name] = data.items
    artifactPages[row.name] = { page: data.page, pageSize: data.pageSize, total: data.total }
  } catch (e) {
    if (epoch === artifactEpoch && artifactRequests.get(row.name) === request) artifactErrors[row.name] = e.message || '镜像与标签加载失败'
  } finally {
    if (epoch === artifactEpoch && artifactRequests.get(row.name) === request) artifactsLoading[row.name] = false
  }
}
watch(browseVisible, visible => { if (!visible) resetBrowser() }, { flush: 'sync' })
onUnmounted(resetBrowser)

function healthLabel(health) {
  if (!health.ok) return '连接异常'
  if (health.authenticated === true) return '认证通过'
  if (health.authenticated === false) return '匿名访问可用'
  return '可连接（请重新测试认证）'
}

async function copy(text) {
  try {
    await copyText(text)
    ElMessage.success('已复制')
  } catch (e) { ElMessage.error(e.message || '复制失败') }
}
function fmtSize(n) {
  if (n === null || n === undefined) return '-'
  if (n === 0) return '0 B'
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
.registry-stat { appearance: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.registry-stat:hover, .registry-stat.selected { border-color: var(--kp-brand); }
.registry-stat:focus-visible { outline: 2px solid var(--kp-brand); outline-offset: 3px; }
.stat-hint { display: block; margin-top: 9px; color: var(--kp-muted); font-size: 12px; }
.registry-list-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; padding: 14px 16px; font-size: 14px; border-bottom: 1px solid var(--kp-border); }
.registry-list-head > .kp-muted { flex: 1; font-size: 13px; }
.registry-name, .repository-name { max-width: 100%; height: auto; white-space: normal; text-align: left; overflow-wrap: anywhere; line-height: 1.6; font-weight: 600; }
.health-message { margin-top: 4px; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.registry-alert { margin-bottom: 14px; }
.registry-browser { font-size: 14px; line-height: 1.6; }
.registry-browser :deep(.el-table), .registry-browser :deep(.el-button), .registry-browser :deep(.el-tag), .registry-browser :deep(.el-select__placeholder) { font-size: 14px; }
.browser-address { overflow-wrap: anywhere; margin-bottom: 18px; }
.browser-section + .browser-section { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--kp-border); }
.browser-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; margin-bottom: 14px; }
.browser-heading h2 { font-size: 16px; font-weight: 600; margin: 0; }
.browser-heading > .el-button { margin-left: auto; }
.browser-heading > .kp-muted { overflow-wrap: anywhere; }
.project-selector { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.project-selector .el-select { width: min(360px, 100%); }
.browser-empty { padding: 20px 14px; background: var(--kp-bg); color: var(--kp-muted); border-radius: 6px; line-height: 1.7; }
.repository-filter { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
.repository-filter .el-input { width: min(320px, 100%); }
.registry-browser :deep(.selected-repository) { --el-table-tr-bg-color: var(--el-color-primary-light-9); }
.registry-browser .el-pagination { max-width: 100%; overflow-x: auto; margin-top: 14px; padding-bottom: 4px; }
.repository-path { overflow-wrap: anywhere; color: var(--kp-brand); font-weight: 600; margin-top: -4px; margin-bottom: 14px; }
.artifact-item { padding: 16px; border: 1px solid var(--kp-border); border-radius: 6px; margin-bottom: 12px; }
.artifact-tags { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.artifact-tags :deep(.el-tag) { height: auto; white-space: normal; overflow-wrap: anywhere; line-height: 1.5; padding-top: 3px; padding-bottom: 3px; max-width: 100%; }
.artifact-metadata { display: flex; flex-wrap: wrap; gap: 10px 28px; margin: 14px 0; }
.artifact-metadata > div { display: flex; gap: 10px; min-width: 0; }
.artifact-metadata dt { color: var(--kp-muted); flex-shrink: 0; }
.artifact-metadata dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.artifact-metadata > .artifact-digest { flex-basis: 100%; }
.artifact-pull { display: flex; align-items: flex-start; gap: 12px; border-top: 1px solid var(--kp-border); padding-top: 10px; margin-top: 10px; }
.artifact-pull code { flex: 1; min-width: 0; overflow-wrap: anywhere; white-space: normal; font-size: 14px; line-height: 1.7; }
.artifact-pull .el-button { flex-shrink: 0; margin-top: 2px; }
@media (max-width: 600px) {
  .plat-main { padding: 18px 14px 32px; }
  .registry-list-head > .kp-muted { flex-basis: 100%; }
  .artifact-item { padding: 12px; }
  .artifact-metadata { gap: 10px; }
  .artifact-metadata > div { flex-basis: 100%; }
  .artifact-pull { flex-wrap: wrap; gap: 6px; }
  .artifact-pull code { flex-basis: 100%; }
}
.dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.dot.ok { background: #16a34a; box-shadow: 0 0 0 3px rgba(22,163,74,.12); }
.dot.bad { background: #dc2626; box-shadow: 0 0 0 3px rgba(220,38,38,.12); }
.dot.unknown { background: #cbd5e1; }
</style>
