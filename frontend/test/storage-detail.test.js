import test from 'node:test'
import assert from 'node:assert/strict'
import {storageFacts,volumeSourceRows,storageRelation} from '../src/utils/storage-detail.js'
test('PVC distinguishes requested and actual capacity instead of inventing observed data',()=>{
 const pvc={kind:'PersistentVolumeClaim',spec:{resources:{requests:{storage:'20Gi'}},accessModes:['ReadWriteOnce'],volumeName:'data'},status:{capacity:{storage:'10Gi'},accessModes:['ReadWriteOnce'],phase:'Bound'}}
 const facts=Object.fromEntries(storageFacts(pvc));assert.equal(facts['申请容量'],'20Gi');assert.equal(facts['实际容量'],'10Gi');assert.match(facts['实际访问模式'],/RWO/)
 delete pvc.status.capacity;assert.equal(Object.fromEntries(storageFacts(pvc))['实际容量'],'—')
 assert.equal(storageRelation(pvc).namespace,'_all')
})
test('PV source and claim identity remain readable for hostPath NFS and CSI',()=>{
 assert.equal(Object.fromEntries(volumeSourceRows({spec:{hostPath:{path:'/data/jenkins'}}}))['路径'],'/data/jenkins')
 assert.equal(Object.fromEntries(volumeSourceRows({spec:{nfs:{server:'nfs',path:'/exports',readOnly:false}}}))['只读'],'否')
 assert.equal(Object.fromEntries(volumeSourceRows({spec:{csi:{driver:'drv',volumeHandle:'id',volumeAttributes:{tier:'fast'}}}}))['卷标识'],'id')
 assert.deepEqual(storageRelation({kind:'PersistentVolume',spec:{claimRef:{name:'data',namespace:'team',uid:'u1'}}}),{kind:'PersistentVolumeClaim',plural:'persistentvolumeclaims',namespace:'team',name:'data',uid:'u1'})
})
