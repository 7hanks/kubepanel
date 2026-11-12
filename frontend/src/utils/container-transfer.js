export const MAX_TRANSFER_BYTES=5*1024**3
export const MAX_EDIT_BYTES=1024**2

export function validateUpload(file) {
 if(!file || !Number.isSafeInteger(file.size) || file.size<0)throw new Error('文件大小无效')
 if(file.size>MAX_TRANSFER_BYTES)throw new Error('上传文件不能超过 5 GiB')
 if(typeof file.name!=='string' || !file.name || ['.','..'].includes(file.name) || /[\/\\\x00-\x1f\x7f]/.test(file.name))throw new Error('文件名称无效')
 return file
}

// Keep the original File as the XHR body. The shared client supplies CSRF,
// credentials and session-error handling; neither JSON nor Base64 is involved.
export async function uploadFile(client,target,file,{signal,onProgress}={}) {
 validateUpload(file)
 if(target.confirmed!==true)throw new Error('上传文件需要明确确认')
 const params={clusterId:target.clusterId,namespace:target.namespace,pod:target.pod,container:target.container,uid:target.uid,path:target.path,size:file.size,overwrite:String(target.overwrite===true),confirmed:'true'}
 return client.post('/v1/container/files/upload',file,{
  adapter:'xhr',timeout:0,signal,params,headers:{'Content-Type':'application/octet-stream'},transformRequest:[value=>value],
  onUploadProgress:event=>onProgress?.({loaded:Math.min(file.size,Math.max(0,Number(event.loaded)||0)),total:file.size}),
 })
}

export function startNativeDownload(value,name,{origin=globalThis.location?.origin,document=globalThis.document}={}) {
 if(typeof value!=='string'||!value.trim())throw new Error('下载地址无效')
 const url=new URL(value,origin)
 if(url.origin!==origin || !['http:','https:'].includes(url.protocol) || url.username || url.password)throw new Error('下载地址必须是同源地址')
 const link=document.createElement('a')
 link.href=url.href;link.download=name;link.referrerPolicy='no-referrer';link.rel='noreferrer';link.style && (link.style.display='none')
 document.body.appendChild(link)
 try{link.click()}finally{link.remove()}
}

export function formatTransferBytes(bytes) {
 if(bytes>=1024**3)return `${(bytes/1024**3).toFixed(2)} GiB`
 if(bytes>=1024**2)return `${(bytes/1024**2).toFixed(2)} MiB`
 if(bytes>=1024)return `${(bytes/1024).toFixed(1)} KiB`
 return `${bytes} B`
}
