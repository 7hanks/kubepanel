export function normalizePage(value, defaults = {}) {
 const page=Number(defaults.page) || 1, pageSize=Number(defaults.pageSize) || 20
 if(Array.isArray(value)) return {items:value,total:value.length,page,pageSize}
 if(!value || !Array.isArray(value.items)) throw new Error('服务端分页响应缺少 items 数组')
 return {items:value.items,total:Number(value.total) || 0,page:Number(value.page) || page,pageSize:Number(value.pageSize) || pageSize}
}
