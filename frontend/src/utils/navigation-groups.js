/** Invalid browser preferences must never prevent the navigation from rendering. */
export function parseNavigationExpansion(serialized) {
  try {
    const value = JSON.parse(serialized)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, open]) => typeof open === 'boolean'))
  } catch { return {} }
}

/** Search only changes the view, leaving the user's expansion preferences intact. */
export function visibleNavigationGroups(groups, query, expansion, canAccess) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return groups.map(group => {
    const items = group.items.filter(item => {
      if (!canAccess(item)) return false
      const text = [group.title, item.label, item.kind, item.plural, item.aliases].join(' ').toLowerCase()
      return terms.every(term => text.includes(term))
    })
    return { ...group, items, open: !!terms.length || (expansion[group.id] ?? !!group.defaultOpen) }
  }).filter(group => group.items.length)
}

/** A newly visited deep link reveals its resource without resetting other groups. */
export function revealActiveNavigationGroup(groups, expansion, isActive) {
  const group = groups.find(group => group.items.some(isActive))
  return group && !expansion[group.id] ? { ...expansion, [group.id]: true } : expansion
}
