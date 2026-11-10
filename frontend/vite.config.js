import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 前端构建产物输出到 frontend/dist，Docker 构建阶段会把它拷进镜像的 /app/public
export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: {
      // 本地开发时把 /api 与 /healthz 转发到后端，生产环境由 Express 同源托管
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false, ws: true },
      '/livez': { target: 'http://127.0.0.1:8080', changeOrigin: false },
      '/readyz': { target: 'http://127.0.0.1:8080', changeOrigin: false },
      '/healthz': { target: 'http://127.0.0.1:8080', changeOrigin: false },
    },
  },
})
