import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { DataBoard, Box, Grid, Files, Operation, CopyDocument, AlarmClock, Timer, TrendCharts, Connection, Share, Lock, Link, Tickets, Key, User, PieChart, ScaleToOriginal, UserFilled, Stamp, Avatar, Postcard, FolderOpened, Coin, Management, Monitor, Collection, Bell, SetUp, MoreFilled, EditPen, Document, Expand, Fold, Warning, Refresh, ArrowDown, OfficeBuilding } from '@element-plus/icons-vue'
import '@xterm/xterm/css/xterm.css'
import './styles.css'

import App from './App.vue'
import router from './router'

const app = createApp(App)

// 仅注册导航和动态图标；各页面静态图标通过本地显式导入。
for (const [key, component] of Object.entries({DataBoard,Box,Grid,Files,Operation,CopyDocument,AlarmClock,Timer,TrendCharts,Connection,Share,Lock,Link,Tickets,Key,User,PieChart,ScaleToOriginal,UserFilled,Stamp,Avatar,Postcard,FolderOpened,Coin,Management,Monitor,Collection,Bell,SetUp,MoreFilled,EditPen,Document,Expand,Fold,Warning,Refresh,ArrowDown,OfficeBuilding})) {
  app.component(key, component)
}

app.use(router)
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')
