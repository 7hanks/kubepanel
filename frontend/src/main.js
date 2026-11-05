import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import '@xterm/xterm/css/xterm.css'
import './styles.css'

import App from './App.vue'
import router from './router'

const app = createApp(App)

// 注册全部 Element Plus 图标，模板里可直接用 <el-icon><Refresh /></el-icon>
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(router)
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')
