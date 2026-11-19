import { onUnmounted, shallowReactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

export function useContainerLogDownload(allowed) {
  const downloads = shallowReactive(new Map())
  let lastTailLines = '2000'

  async function downloadLogs(container, clusterId) {
    if (!allowed(container, clusterId) || downloads.has(container.key)) return
    const request = new AbortController()
    downloads.set(container.key, request)
    try {
      const { value } = await ElMessageBox.prompt('输入要下载的日志行数，单次最多 5 MiB。', '下载日志', {
        inputValue: lastTailLines,
        inputPlaceholder: '日志行数',
        inputValidator: value => /^[1-9]\d*$/.test(value) && Number(value) <= 20000 || '请输入 1–20000 的整数',
        confirmButtonText: '下载',
        cancelButtonText: '取消',
      })
      if (request.signal.aborted || !allowed(container, clusterId)) return
      lastTailLines = value
      const blob = await api.containerLogsDownload({ ...container, clusterId, tailLines: Number(value) }, { signal: request.signal })
      if (request.signal.aborted) return
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      link.href = url
      link.download = `${container.pod}-${container.name}.log`
      document.body.appendChild(link)
      try { link.click() } finally {
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (cause) {
      if (request.signal.aborted || cause === 'cancel' || cause === 'close') return
      let message = cause.message || '日志下载失败'
      const body = cause.raw?.response?.data
      if (body instanceof Blob) {
        try { message = JSON.parse(await body.text()).message || message } catch { /* Keep the original error. */ }
      }
      if (!request.signal.aborted) ElMessage.error(message)
    } finally {
      downloads.delete(container.key)
    }
  }

  onUnmounted(() => { for (const request of downloads.values()) request.abort() })
  return { downloads, downloadLogs }
}
