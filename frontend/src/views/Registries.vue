<template>
  <component :is="workspace || embedded ? 'div' : PlatformLayout" active="registries" :class="{ 'registry-workspace': workspace }">
    <template v-if="!embedded && !workspace" #actions>
      <el-button size="small" :loading="loading" circle @click="load"><el-icon><Refresh /></el-icon></el-button>
    </template>

    <main class="plat-main" :class="{ 'platform-embedded-main': embedded, 'workspace-main': workspace }">
     <template v-if="!workspace">
      <div class="page-head">
        <div>
          <h1>镜像仓库</h1>
          <p class="kp-muted">
            选择已配置的 Harbor，浏览项目、镜像仓库与标签，复制 <code>docker pull</code> 地址。
          </p>
        </div>
        <div style="display:flex;gap:8px">
          <a class="registry-open-workspace" :href="workspaceHref()" target="_blank" rel="noopener noreferrer">在新标签页打开</a>
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
              <el-tooltip v-if="row.health?.message && !row.health.ok" :content="row.health.message" placement="top" :show-after="200">
                <el-button link type="danger" size="small" class="health-detail">查看原因</el-button>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="290" fixed="right" align="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="browse(row)">浏览</el-button>
              <a class="registry-row-workspace" :href="workspaceHref(row)" target="_blank" rel="noopener noreferrer" :aria-label="`在新标签页打开 ${row.name}`">工作区</a>
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

     </template>

      <!-- 添加 / 编辑 -->
      <el-dialog v-model="formVisible" :title="workspace ? (editingId ? '编辑 Harbor 连接' : '添加 Harbor 连接') : (editingId ? '编辑镜像仓库' : '添加镜像仓库')" width="min(560px, 94vw)" top="10vh">
        <p class="connection-help">保存 Harbor 实例的地址和登录方式。项目是在 Harbor 实例内创建的，不会出现在连接列表中。</p>
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

     <template v-if="!workspace">
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

     </template>
     <template v-else>
      <header class="workspace-header"><div><span class="workspace-brand">KubePanel</span><h1>镜像仓库工作区</h1><p class="kp-muted">管理已保存仓库中的项目、镜像制品与标签</p></div><router-link to="/registries" class="workspace-back">返回仓库配置</router-link></header>
      <div class="workspace-controls"><label for="workspace-registry">Harbor 连接</label><el-select id="workspace-registry" :model-value="browseRegistry?.id||''" :loading="loading" aria-label="工作区镜像仓库" placeholder="选择已保存的 Harbor 实例" @visible-change="open=>{if(open)syncConnections({fresh:true})}" @update:model-value="switchWorkspace"><el-option v-for="row in registries" :key="row.id" :label="row.name" :value="row.id"/></el-select><el-button :loading="loading" @click="refreshWorkspace">刷新连接</el-button><el-button v-if="canCreateReg" :icon="Plus" @click="openAdd">添加 Harbor 连接</el-button><span class="workspace-connection-hint">切换 Harbor 实例；实例内的项目在下方选择。</span></div>
      <el-alert v-if="registryError||workspaceError" type="error" :title="registryError||workspaceError" :closable="false" class="registry-alert"/>
      <div v-if="!loading&&!registryError&&!workspaceError&&!registries.length" class="browser-empty">尚未保存镜像仓库，请返回仓库配置添加连接。</div>
     </template>

      <!-- 浏览项目 / 仓库 / 标签 -->
      <component :is="workspace ? 'section' : 'el-drawer'" v-if="!workspace||browseRegistry" :model-value="workspace||browseVisible" @update:model-value="value=>{if(!workspace)browseVisible=value}" :title="workspace ? undefined : `浏览 · ${browseRegistry?.name || ''}`" size="min(1080px, 100vw)" :class="workspace ? 'workspace-content' : 'registry-drawer'" destroy-on-close>
        <div class="registry-browser">
          <div class="browser-address kp-muted"><strong v-if="workspace">{{ browseRegistry?.name }} · </strong>{{ browseRegistry?.url }}</div>
          <el-alert v-if="operationNotice" :type="operationNotice.type" :title="operationNotice.message" :closable="false" class="registry-alert"/>
          <section class="browser-section" aria-labelledby="registry-projects-heading" v-loading="projectsLoading">
            <div class="browser-heading"><h2 id="registry-projects-heading">Harbor 项目</h2><span class="kp-muted">列表共 {{ projectPage.total }} 个</span><el-button v-if="canCreateReg" type="primary" :disabled="projectSaving" @click="openCreateProject">创建项目</el-button><el-button link type="primary" :disabled="projectsLoading" @click="loadProjects">刷新项目</el-button></div>
            <el-alert v-if="projectError" type="error" :title="projectError" :closable="false" class="registry-alert"><el-button link type="primary" @click="loadProjects">重试</el-button></el-alert>
            <div v-if="projectOptions.length" class="project-selector">
              <span class="project-select-label">当前项目</span><el-select v-model="project" aria-label="选择项目" @visible-change="open=>{if(open)loadProjects({preserveDetails:true})}" @change="changeProject">
                <el-option v-for="p in projectOptions" :key="p.name" :label="projectOptionLabel(p)" :value="p.name" />
              </el-select>
              <el-tag v-if="currentProject" disable-transitions :type="currentProject.public ? 'success' : 'info'" effect="plain">{{ currentProject.public ? '公开项目' : '私有项目' }}</el-tag>
              <span v-if="currentProject" class="kp-muted">{{ currentProject.repoCount }} 个镜像仓库</span>
            </div>
            <p v-if="currentProject?.pendingList" class="project-sync-note" role="status">项目“{{currentProject.name}}”已创建，Harbor 列表暂未返回此项目，已保留在选择器中。可继续浏览，或稍后刷新项目。</p>
            <div v-else-if="!projectOptions.length&&!projectsLoading&&!projectError" class="browser-empty">当前账号没有可见项目。请检查 Harbor 中的项目和账号权限，或编辑仓库认证信息后重试。</div>
            <el-pagination v-if="projectPage.total > projectPage.pageSize" :current-page="projectPage.page" :page-size="projectPage.pageSize" :total="projectPage.total" layout="total, prev, pager, next" size="small" aria-label="项目分页" @update:current-page="changeProjectPage" />
          </section>

          <section v-if="project" class="browser-section" aria-labelledby="registry-repositories-heading" v-loading="reposLoading">
            <div class="browser-heading"><h2 id="registry-repositories-heading">镜像仓库</h2><span class="kp-muted">{{ project }} · 共 {{ repoPage.total }} 个</span><el-button link type="primary" :disabled="reposLoading" @click="loadRepos">刷新仓库</el-button></div>
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
                <div class="artifact-tags"><span class="kp-muted">标签</span><span v-for="tag in a.tags" :key="tag" class="artifact-tag-entry"><el-tag disable-transitions effect="plain">{{ tag }}</el-tag><el-button v-if="canDeleteReg" text type="danger" size="small" :disabled="!!deleteBusy" :aria-label="`删除标签 ${tag}`" @click="deleteTag(a,tag)">删除标签</el-button></span><span v-if="!a.tags?.length" class="kp-muted">无标签，可通过 digest 拉取</span></div>
                <dl class="artifact-metadata"><div><dt>大小</dt><dd>{{ fmtSize(a.size) }}</dd></div><div><dt>推送时间</dt><dd>{{ fmtTime(a.pushTime) }}</dd></div><div class="artifact-digest"><dt>Digest</dt><dd class="kp-mono">{{ a.digest || '—' }}</dd></div></dl>
                <div v-for="pullRef in a.pullRefs" :key="pullRef" class="artifact-pull"><code>docker pull {{ pullRef }}</code><el-button link type="primary" @click="copy(`docker pull ${pullRef}`)">复制命令</el-button></div>
                <div v-if="canUpdateReg||canDeleteReg" class="artifact-actions"><el-button v-if="canUpdateReg" link type="primary" :disabled="tagSaving" @click="openTag(a)">添加标签</el-button><el-button v-if="canDeleteReg" link type="danger" :disabled="!!deleteBusy" :loading="deleteBusy===a.digest" @click="deleteArtifact(a)">删除制品</el-button></div>
              </article>
              <div v-if="!currentArtifacts.length && !artifactsLoading[selectedRepository.name]" class="browser-empty">该仓库下没有镜像或制品。</div>
              <el-pagination v-if="currentArtifactPage?.total" :current-page="currentArtifactPage.page" :page-size="currentArtifactPage.pageSize" :total="currentArtifactPage.total" layout="total, prev, pager, next" size="small" :aria-label="`${selectedRepository.name} 制品分页`" @current-change="p => loadArtifacts(selectedRepository, p)" />
            </template>
          </section>
        </div>
      </component>

      <el-dialog v-model="projectDialog" title="创建项目" width="min(520px, 94vw)" append-to-body :close-on-click-modal="!projectSaving" :close-on-press-escape="!projectSaving" :show-close="!projectSaving">
       <div v-if="projectTarget" class="mutation-context"><strong>目标仓库：{{projectTarget.name}}</strong><span>{{projectTarget.url}}</span><code>仓库 ID：{{projectTarget.id}}</code></div>
       <el-form label-position="top" :disabled="projectSaving"><el-form-item label="项目名称"><el-input v-model="projectDraft.name" aria-label="新项目名称" placeholder="例如 team-apps" maxlength="255"/></el-form-item><el-form-item label="可见性"><el-radio-group v-model="projectDraft.public" aria-label="项目可见性"><el-radio :value="false">私有</el-radio><el-radio :value="true">公开</el-radio></el-radio-group></el-form-item></el-form>
       <p class="kp-muted">公开项目允许匿名拉取；项目操作仍受保存账号在 Harbor 中的权限限制。</p><el-alert v-if="projectMutationError" type="error" :title="projectMutationError" :closable="false"/>
       <template #footer><el-button :disabled="projectSaving" @click="projectDialog=false">取消</el-button><el-button type="primary" :loading="projectSaving" :disabled="projectUncertain||!canCreateReg" @click="submitProject">创建项目</el-button></template>
      </el-dialog>
      <el-dialog v-model="tagDialog" title="添加标签" width="min(640px, 94vw)" append-to-body :close-on-click-modal="!tagSaving" :close-on-press-escape="!tagSaving" :show-close="!tagSaving">
       <dl v-if="tagTarget" class="mutation-context"><div><dt>仓库</dt><dd>{{tagTarget.registryName}} · {{tagTarget.registryUrl}}（{{tagTarget.registryId}}）</dd></div><div><dt>项目</dt><dd>{{tagTarget.project}}</dd></div><div><dt>镜像仓库</dt><dd>{{tagTarget.repository}}</dd></div><div><dt>Digest</dt><dd class="kp-mono">{{tagTarget.digest}}</dd></div></dl>
       <el-form label-position="top" :disabled="tagSaving"><el-form-item label="新标签"><el-input v-model="tagDraft.name" aria-label="新制品标签" placeholder="例如 release-2026" maxlength="128"/></el-form-item></el-form><p class="kp-muted">为此 Digest 添加新标签；已有同名标签时由 Harbor 拒绝，页面不会自动覆盖。</p><el-alert v-if="tagMutationError" type="error" :title="tagMutationError" :closable="false"/>
       <template #footer><el-button :disabled="tagSaving" @click="tagDialog=false">取消</el-button><el-button type="primary" :loading="tagSaving" :disabled="tagUncertain||!canUpdateReg" @click="submitTag">添加标签</el-button></template>
      </el-dialog>
    </main>
  </component>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import {useRoute,useRouter} from 'vue-router'
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
const props=defineProps({ embedded: { type: Boolean, default: false },workspace:{type:Boolean,default:false} })
const route=useRoute(),router=useRouter()

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
const confirmedProjects=reactive(new Map()),selectedProjectRecord=ref(null)
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
const workspaceError=ref(''),operationNotice=ref(null)
const projectDialog=ref(false),projectTarget=ref(null),projectDraft=reactive({name:'',public:false}),projectSaving=ref(false),projectMutationError=ref(''),projectUncertain=ref(false)
const tagDialog=ref(false),tagTarget=ref(null),tagDraft=reactive({name:''}),tagSaving=ref(false),tagMutationError=ref(''),tagUncertain=ref(false),deleteBusy=ref('')
const projectGate=createRequestGate(),repoGate=createRequestGate(),listGate=createRequestGate()
let artifactEpoch=0,browserEpoch=0,projectMutationEpoch=0,tagMutationEpoch=0,deleteRequest=null,connectionSync=null,connectionSyncAgain=false,projectSelectionVersion=0,disposed=false
const connectionChangeKey='kp_registry_connections_changed'
const artifactRequests=new Map()

const okCount = computed(() => registries.value.filter(r => r.health?.ok).length)
const badCount = computed(() => registries.value.filter(r => r.health && !r.health.ok).length)
const registryFilterLabel = computed(() => ({ all: '全部仓库配置', ok: '连接正常的仓库', bad: '连接异常的仓库' })[registryFilter.value])
const filteredRegistries = computed(() => registries.value.filter(r => registryFilter.value === 'all' || (registryFilter.value === 'ok' ? r.health?.ok : r.health && !r.health.ok)))
const projectOptions=computed(()=>{
 const options=new Map(projects.value.map(item=>[item.name,item]))
 for(const [name,item] of confirmedProjects)if(!options.has(name))options.set(name,item)
 if(selectedProjectRecord.value&&!options.has(selectedProjectRecord.value.name))options.set(selectedProjectRecord.value.name,selectedProjectRecord.value)
 return [...options.values()]
})
const currentProject = computed(() => projectOptions.value.find(p => p.name === project.value))
const currentArtifacts = computed(() => artifacts[selectedRepository.value?.name] || [])
const currentArtifactPage = computed(() => artifactPages[selectedRepository.value?.name])
const filteredRepos = computed(() => {
  const f = repoFilter.value.trim().toLowerCase()
  return f ? repos.value.filter(r => r.name.toLowerCase().includes(f)) : repos.value
})

async function load({ autoTest = true } = {}) {
  const request=listGate.next()
  loading.value = true
  registryError.value = ''
  try {
    const records=await api.registries()
    if(!listGate.current(request))return
    registries.value = records
    // 首次进来没有健康状态时静默测一遍，避免列表里一直是「未测试」
    const need = registries.value.filter(r => !r.health)
    if (autoTest && need.length) {
      await Promise.all(need.map(r => api.testRegistry(r.id).catch(() => null)))
      const tested=await api.registries()
      if(listGate.current(request))registries.value = tested
    }
  } catch (e) { if(listGate.current(request))registryError.value = e.message || '仓库配置加载失败' }
  finally { if(listGate.current(request))loading.value = false }
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
    notifyConnectionsChanged()
    if(props.workspace)await syncConnections({fresh:true});else await load({ autoTest: false })
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
    notifyConnectionsChanged()
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
  tagMutationEpoch++
  tagDialog.value=false
  tagTarget.value=null
  tagSaving.value=false
  tagMutationError.value=''
  tagUncertain.value=false
  deleteRequest=null
  deleteBusy.value=''
  selectedRepository.value = null
  for (const map of [artifacts, artifactsLoading, artifactErrors, artifactPages]) {
    for (const key of Object.keys(map)) delete map[key]
  }
  artifactRequests.clear()
}
function resetBrowser() {
  browserEpoch++
  projectMutationEpoch++
  projectDialog.value=false
  projectTarget.value=null
  projectSaving.value=false
  projectMutationError.value=''
  projectUncertain.value=false
  operationNotice.value=null
  projectGate.invalidate()
  repoGate.invalidate()
  resetArtifacts()
  browseRegistry.value = null
  projects.value = []
  project.value = ''
  confirmedProjects.clear()
  selectedProjectRecord.value=null
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
  workspaceError.value=''
  browseRegistry.value = row
  browseVisible.value = true
  await loadProjects()
}
async function loadProjects(options={}) {
  const request = projectGate.next(), registryId = browseRegistry.value?.id
  if (!registryId) return
  const previous=project.value,selectionVersion=projectSelectionVersion,preserveDetails=options?.preserveDetails===true,desired=options?.selectProject||(!options?.replaceSelection?previous:'')
  if(currentProject.value)selectedProjectRecord.value={...currentProject.value}
  if(options?.replaceSelection)selectedProjectRecord.value=null
  if(!preserveDetails){
   repoGate.invalidate();resetArtifacts();projects.value=[];repos.value=[]
   project.value=desired;repoFilter.value='';repoPage.total=0;repoPage.page=1
  }
  projectsLoading.value = true
  if(!preserveDetails)reposLoading.value = false
  projectError.value = ''
  if(!preserveDetails)repoError.value = ''
  try {
    const data = normalizePage(await api.registryProjects(registryId, { page: projectPage.page, pageSize: projectPage.pageSize }), projectPage)
    if (!projectGate.current(request)) return
    projects.value = data.items
    for(const item of data.items)if(confirmedProjects.has(item.name))confirmedProjects.set(item.name,{...item,pendingList:false})
    Object.assign(projectPage, { page: data.page, pageSize: data.pageSize, total: data.total })
    projectsLoading.value = false
    const selectionChanged=selectionVersion!==projectSelectionVersion,preferred=selectionChanged?project.value:desired
    const next=projectOptions.value.some(item=>item.name===preferred)?preferred:projects.value[0]?.name||projectOptions.value[0]?.name||''
    project.value=next
    selectedProjectRecord.value=currentProject.value?{...currentProject.value}:null
    if(next&&!selectionChanged&&(!preserveDetails||next!==previous))await loadRepos()
  } catch (e) {
    if (projectGate.current(request)) projectError.value = e.message || '项目加载失败'
  } finally {
    if (projectGate.current(request)) projectsLoading.value = false
  }
}
function changeProject() {
  projectSelectionVersion++
  selectedProjectRecord.value=currentProject.value?{...currentProject.value}:null
  repoPage.page = 1
  repoFilter.value = ''
  return loadRepos()
}
function changeProjectPage(page){if(page===projectPage.page)return;projectPage.page=page;return loadProjects({replaceSelection:true})}
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
    const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize))
    if (!data.items.length && lastPage < data.page && lastPage < page) return await loadArtifacts(row, lastPage)
    if(selectedRepository.value?.name===row.name)selectedRepository.value.artifactCount=data.total
  } catch (e) {
    if (epoch === artifactEpoch && artifactRequests.get(row.name) === request) artifactErrors[row.name] = e.message || '镜像与标签加载失败'
  } finally {
    if (epoch === artifactEpoch && artifactRequests.get(row.name) === request) artifactsLoading[row.name] = false
  }
}
watch(browseVisible, visible => { if (!visible) resetBrowser() }, { flush: 'sync' })
watch(()=>route.params.registryId,()=>{if(props.workspace)applyWorkspaceRoute()})
onUnmounted(()=>{disposed=true;if(typeof window!=='undefined'){window.removeEventListener('focus',onWorkspaceReturn);window.removeEventListener('storage',onConnectionsChanged);document.removeEventListener('visibilitychange',onWorkspaceVisibility)}listGate.invalidate();resetBrowser()})

function workspaceHref(row){return router.resolve({name:'registry-workspace',params:{...(row?.id?{registryId:row.id}:{})}}).href}
async function switchWorkspace(id){const row=registries.value.find(item=>item.id===id);if(row)await router.replace(workspaceHref(row))}
async function applyWorkspaceRoute(){
 if(!props.workspace)return
 workspaceError.value=''
 const id=typeof route.params.registryId==='string'?route.params.registryId:''
 const row=id?registries.value.find(item=>item.id===id):registries.value[0]
 if(!row){resetBrowser();if(id)workspaceError.value='指定的镜像仓库不存在或当前账号不可用，请选择其他已保存仓库';return}
 await browse(row)
}
async function refreshWorkspace(){await syncConnections({fresh:true})}
function connectionIdentity(row){return JSON.stringify([row?.url,row?.username||'',row?.insecure===true,row?.hasCa===true,row?.hasPassword===true])}
async function syncConnections({fresh=false}={}){
 if(disposed)return
 if(connectionSync){if(fresh)connectionSyncAgain=true;return connectionSync}
 connectionSync=(async()=>{
  do{
   connectionSyncAgain=false
   const epoch=browserEpoch,current=browseRegistry.value
   await load({autoTest:false})
   if(registryError.value||epoch!==browserEpoch)continue
   if(!current){await applyWorkspaceRoute();continue}
   const updated=registries.value.find(item=>item.id===current.id)
   if(!updated){resetBrowser();workspaceError.value='当前 Harbor 连接已被移除或不再可用，请在上方选择其他连接';continue}
   if(connectionIdentity(updated)!==connectionIdentity(current)){await browse(updated);continue}
   browseRegistry.value=updated
  }while(connectionSyncAgain&&!disposed)
 })().finally(()=>{connectionSync=null})
 return connectionSync
}
function notifyConnectionsChanged(){try{localStorage.setItem(connectionChangeKey,`${Date.now()}-${Math.random()}`)}catch{ /* The dropdown and return-to-tab refresh remain available when storage is blocked. */ }}
function onWorkspaceReturn(){if(props.workspace&&document.visibilityState!=='hidden')syncConnections({fresh:true})}
function onWorkspaceVisibility(){if(document.visibilityState==='visible')onWorkspaceReturn()}
function onConnectionsChanged(event){if(props.workspace&&event.key===connectionChangeKey)syncConnections({fresh:true})}
function rememberCreatedProject(record){confirmedProjects.set(record.name,{...record,pendingList:true});selectedProjectRecord.value={...record,pendingList:true}}
function projectOptionLabel(record){return `${record.name}（${record.repoCount??0} 个仓库）${record.pendingList?' · 刚创建':!projects.value.some(item=>item.name===record.name)?' · 当前页外':''}`}
function pinArtifact(artifact,tag){
 if(!browseRegistry.value||!project.value||!selectedRepository.value||!artifact?.digest)return null
 return Object.freeze({registryId:browseRegistry.value.id,registryName:browseRegistry.value.name,registryUrl:browseRegistry.value.url,project:project.value,repository:selectedRepository.value.name,digest:artifact.digest,...(tag!==undefined?{tag}:{}),tags:[...(artifact.tags||[])]})
}
function artifactContextMatches(target){return target&&browseRegistry.value?.id===target.registryId&&project.value===target.project&&selectedRepository.value?.name===target.repository}
function unknownOutcome(error){return !error?.status||error.status>=500||error.status===408}
function mutationMessage(error,action){return unknownOutcome(error)?`${action}请求结果未确认，请刷新核对后再操作；页面不会自动重试。${error?.message?' '+error.message:''}`:error?.message||`${action}失败`}
function openCreateProject(){
 if(!canCreateReg.value||!browseRegistry.value||projectSaving.value)return
 projectMutationEpoch++
 projectTarget.value=Object.freeze({id:browseRegistry.value.id,name:browseRegistry.value.name,url:browseRegistry.value.url})
 Object.assign(projectDraft,{name:'',public:false});projectMutationError.value='';projectUncertain.value=false;projectDialog.value=true
}
async function submitProject(){
 if(!canCreateReg.value||projectSaving.value||projectUncertain.value||!projectDialog.value||!projectTarget.value)return
 const target=projectTarget.value,epoch=projectMutationEpoch,name=projectDraft.name.trim(),isPublic=projectDraft.public===true
 if(name.length>255||!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(name)){
  projectMutationError.value='项目名称须为 1–255 个字符，以小写字母或数字开头和结尾，分隔符可用点、横线或下划线'
  return
 }
 projectSaving.value=true;projectMutationError.value=''
 try{
  await api.createRegistryProject(target.id,{name,public:isPublic,expectedUrl:target.url},{silent:true})
  if(epoch!==projectMutationEpoch||browseRegistry.value?.id!==target.id)return
  projectDialog.value=false;operationNotice.value={type:'success',message:`${target.name}：已创建${isPublic?'公开':'私有'}项目 ${name}`}
  rememberCreatedProject({name,public:isPublic,repoCount:0});project.value=name
  projectPage.page=1;await loadProjects({selectProject:name})
 }catch(error){if(epoch===projectMutationEpoch&&browseRegistry.value?.id===target.id){projectUncertain.value=unknownOutcome(error);projectMutationError.value=mutationMessage(error,'创建项目')}}
 finally{if(epoch===projectMutationEpoch)projectSaving.value=false}
}
function openTag(artifact){
 if(!canUpdateReg.value||tagSaving.value)return
 const target=pinArtifact(artifact);if(!target)return
 tagMutationEpoch++;tagTarget.value=target;tagDraft.name='';tagMutationError.value='';tagUncertain.value=false;tagDialog.value=true
}
async function submitTag(){
 if(!canUpdateReg.value||tagSaving.value||tagUncertain.value||!tagDialog.value||!tagTarget.value)return
 const target=tagTarget.value,epoch=tagMutationEpoch,tag=tagDraft.name.trim()
 if(!artifactContextMatches(target)){tagDialog.value=false;return}
 if(!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)){tagMutationError.value='标签使用字母、数字、下划线、点或横线，不能以点或横线开头，最多 128 字符';return}
 if(target.tags.includes(tag)){tagMutationError.value='此制品已包含该标签，请填写新标签';return}
 tagSaving.value=true;tagMutationError.value=''
 try{
  await api.createRegistryTag(target.registryId,{project:target.project,repository:target.repository,digest:target.digest,tag,expectedUrl:target.registryUrl},{silent:true})
  if(epoch!==tagMutationEpoch||!artifactContextMatches(target))return
  tagDialog.value=false;operationNotice.value={type:'success',message:`${target.registryName} / ${target.repository}：已为 ${target.digest} 添加标签 ${tag}`}
  await loadArtifacts(selectedRepository.value,currentArtifactPage.value?.page||1)
 }catch(error){if(epoch===tagMutationEpoch&&artifactContextMatches(target)){tagUncertain.value=unknownOutcome(error);tagMutationError.value=mutationMessage(error,'添加标签')}}
 finally{if(epoch===tagMutationEpoch)tagSaving.value=false}
}
function deleteTag(artifact,tag){return deleteImageObject(artifact,tag)}
function deleteArtifact(artifact){return deleteImageObject(artifact)}
async function deleteImageObject(artifact,tag){
 if(!canDeleteReg.value||deleteBusy.value)return
 const target=pinArtifact(artifact,tag);if(!target)return
 const epoch=browserEpoch,artifactVersion=artifactEpoch,tagOnly=tag!==undefined,action=tagOnly?'删除标签':'删除制品'
 const context=`仓库：${target.registryName}（${target.registryId}）\n地址：${target.registryUrl}\n项目：${target.project}\n镜像仓库：${target.repository}\nDigest：${target.digest}\n${tagOnly?`标签：${target.tag}`:`关联标签：${target.tags.join('、')||'无标签'}`}`
 try{await ElMessageBox.confirm(`${context}\n\n${tagOnly?'仅移除此标签；保留制品和其他标签。':'将删除此 Digest 及其全部标签，之后可能无法拉取。此操作不可在页面撤销。'}`,action,{type:'warning',confirmButtonText:action,confirmButtonClass:'el-button--danger',customClass:'registry-mutation-confirm',dangerouslyUseHTMLString:false})}catch{return}
 if(epoch!==browserEpoch||artifactVersion!==artifactEpoch||!artifactContextMatches(target)||!canDeleteReg.value)return
 const request=Symbol();deleteRequest=request;deleteBusy.value=target.digest;operationNotice.value=null
 const params={project:target.project,repository:target.repository,digest:target.digest,...(tagOnly?{tag:target.tag}:{}),expectedUrl:target.registryUrl}
 try{
  if(tagOnly)await api.removeRegistryTag(target.registryId,params,{silent:true});else await api.removeRegistryArtifact(target.registryId,params,{silent:true})
  if(deleteRequest!==request||!artifactContextMatches(target))return
  operationNotice.value={type:'success',message:`${target.registryName} / ${target.repository}：已${action} ${tagOnly?target.tag:target.digest}`}
  await loadArtifacts(selectedRepository.value,currentArtifactPage.value?.page||1)
 }catch(error){if(deleteRequest===request&&artifactContextMatches(target))operationNotice.value={type:'error',message:`${target.registryName} / ${target.repository} / ${target.digest}${tagOnly?' / '+target.tag:''}：${mutationMessage(error,action)}`}}
 finally{if(deleteRequest===request){deleteRequest=null;deleteBusy.value=''}}
}

function healthLabel(health) {
  if (!health.ok) return '连接异常'
  if (health.authenticated === true) return '测试通过'
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

onMounted(async()=>{if(props.workspace){window.addEventListener('focus',onWorkspaceReturn);window.addEventListener('storage',onConnectionsChanged);document.addEventListener('visibilitychange',onWorkspaceVisibility)}await load({autoTest:!props.workspace});if(!disposed&&props.workspace&&!registryError.value)await applyWorkspaceRoute()})
</script>

<style scoped>
.plat-page { min-height: 100vh; background: var(--kp-bg); }
.plat-main { max-width: 1280px; margin: 0 auto; padding: 24px 22px 48px; }
.plat-main.platform-embedded-main { max-width: none; margin: 0; padding: 0; }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
.page-head h1 { margin: 0; font-size: 21px; font-weight: 650; letter-spacing: -.02em; }
.page-head p { margin: 6px 0 0; font-size: 12px; max-width: 720px; line-height: 1.6; }
.connection-help,.workspace-connection-hint,.project-sync-note{font-size:13px;line-height:1.65;color:var(--kp-muted)}.connection-help{margin:0 0 18px}.workspace-connection-hint{flex-basis:100%}.project-sync-note{margin:12px 0 0;color:var(--kp-brand)}.project-select-label{font-size:13px;color:var(--kp-text-2)}
.registry-open-workspace{display:inline-flex;align-items:center;justify-content:center;padding:8px 14px;border:1px solid var(--kp-border-strong);border-radius:8px;color:var(--kp-brand);font-size:14px;white-space:nowrap;background:var(--kp-surface)}.registry-open-workspace:hover{border-color:var(--kp-brand);background:var(--kp-brand-soft)}.registry-row-workspace{color:var(--kp-brand);font-size:13px;margin:0 10px}.registry-workspace{min-height:100vh;background:var(--kp-bg)}.workspace-main{max-width:1500px;padding:30px 36px 60px}.workspace-header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}.workspace-brand{font-size:14px;font-weight:700;color:var(--kp-brand)}.workspace-header h1{font-size:26px;font-weight:650;margin:7px 0}.workspace-header p{font-size:14px;margin:0;line-height:1.6}.workspace-back{color:var(--kp-brand);white-space:nowrap}.workspace-controls{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:22px;padding:18px 20px;border:1px solid var(--kp-border);border-radius:10px;background:var(--kp-surface)}.workspace-controls>.el-select{width:min(360px,100%)}.workspace-content{display:block;border:1px solid var(--kp-border);border-radius:10px;background:var(--kp-surface);padding:24px}.mutation-context{display:flex;flex-direction:column;gap:7px;padding:12px 14px;margin:0 0 20px;border:1px solid var(--kp-border);border-radius:8px;overflow-wrap:anywhere;font-size:13px}.mutation-context>div{display:grid;grid-template-columns:70px minmax(0,1fr);gap:12px}.mutation-context dt{color:var(--kp-muted)}.mutation-context dd{margin:0}.artifact-tag-entry{display:inline-flex;align-items:center;gap:4px;max-width:100%;flex-wrap:wrap}.artifact-actions{display:flex;gap:14px;justify-content:flex-end;border-top:1px solid var(--kp-border);padding-top:12px;margin-top:12px}.registry-workspace a:focus-visible,.registry-open-workspace:focus-visible,.registry-row-workspace:focus-visible{outline:2px solid var(--kp-brand);outline-offset:3px}
:global(.registry-mutation-confirm .el-message-box__message p){white-space:pre-line;overflow-wrap:anywhere}:global(.registry-mutation-confirm){max-width:calc(100vw - 28px);width:620px}
.registry-stat { appearance: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.registry-stat:hover, .registry-stat.selected { border-color: var(--kp-brand); }
.registry-stat:focus-visible { outline: 2px solid var(--kp-brand); outline-offset: 3px; }
.stat-hint { display: block; margin-top: 9px; color: var(--kp-muted); font-size: 12px; }
.registry-list-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; padding: 14px 16px; font-size: 14px; border-bottom: 1px solid var(--kp-border); }
.registry-list-head > .kp-muted { flex: 1; font-size: 13px; }
.registry-name, .repository-name { max-width: 100%; height: auto; white-space: normal; text-align: left; overflow-wrap: anywhere; line-height: 1.6; font-weight: 600; }
.health-detail { margin-left: 8px; }
.registry-alert { margin-bottom: 14px; }
.registry-browser { font-size: 14px; line-height: 1.6; }
.registry-browser :deep(.el-table), .registry-browser :deep(.el-button), .registry-browser :deep(.el-tag), .registry-browser :deep(.el-select__placeholder) { font-size: 14px; }
.browser-address { overflow-wrap: anywhere; margin-bottom: 18px; }
.browser-section + .browser-section { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--kp-border); }
.browser-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; margin-bottom: 14px; }
.browser-heading h2 { font-size: 16px; font-weight: 600; margin: 0; }
.browser-heading > .el-button:first-of-type { margin-left: auto; }
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
  .workspace-header{align-items:flex-start;flex-wrap:wrap}.workspace-header h1{font-size:23px}.workspace-content{padding:16px 12px}.workspace-controls{padding:14px}.workspace-controls>.el-select{flex:1;min-width:170px}.page-head>div:last-child{flex-wrap:wrap}.mutation-context>div{grid-template-columns:1fr;gap:4px}
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
