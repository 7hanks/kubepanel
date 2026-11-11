/** Clipboard API requires HTTPS; keep YAML copying usable on an explicitly supported HTTP IP endpoint. */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return }
  } catch { /* Permission/secure-context failure: try the selected-text fallback. */ }
  const active = document.activeElement
  const selection = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null
  const editor = document.createElement('textarea')
  try {
    editor.value = text
    editor.setAttribute('readonly', '')
    Object.assign(editor.style, { position: 'fixed', left: '-9999px', top: '0', opacity: '0' })
    document.body.appendChild(editor)
    editor.select()
    if (!document.execCommand?.('copy')) throw new Error('复制失败')
  } catch { throw new Error('复制失败，请手动选择文本复制') }
  finally {
    editor.remove()
    active?.focus?.({ preventScroll: true })
    if (selection) active.setSelectionRange?.(...selection)
  }
}
