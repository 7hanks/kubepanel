const guards = new Set()
export function registerUnsavedGuard(guard) { guards.add(guard); return ()=>guards.delete(guard) }
export async function confirmContextChange(reason) { for (const guard of [...guards]) if (await guard(reason) === false) return false; return true }
