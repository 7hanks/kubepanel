const guards = new Set()
export function registerUnsavedGuard(guard) { guards.add(guard); return ()=>guards.delete(guard) }
export async function confirmContextChange() { for (const guard of [...guards]) if (await guard() === false) return false; return true }
