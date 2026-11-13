import test from 'node:test'
import assert from 'node:assert/strict'
import {resourceUiPolicy} from '../src/utils/resource-policy.js'
test('resource flows distinguish host joins, runtime Pods, simple metadata and authored configurations',()=>{
 assert.equal(resourceUiPolicy({kind:'Node',group:''}).create,'none')
 assert.equal(resourceUiPolicy({kind:'Node',group:''}).edit,'simple')
 assert.equal(resourceUiPolicy({kind:'Pod',group:''}).edit,'none')
 assert.equal(resourceUiPolicy({kind:'Pod',group:''}).create,'form')
 for(const kind of ['Namespace','ServiceAccount'])assert.equal(resourceUiPolicy({kind,group:''}).create,'simple')
 assert.equal(resourceUiPolicy({kind:'Event',group:'events.k8s.io'}).yamlReadonly,true)
 assert.equal(resourceUiPolicy({kind:'Deployment',group:'apps'}).edit,'form')
 assert.equal(resourceUiPolicy({kind:'RoleBinding',group:'rbac.authorization.k8s.io'}).create,'yaml')
 assert.equal(resourceUiPolicy({kind:'EndpointSlice',group:'discovery.k8s.io'}).edit,'yaml')
 assert.equal(resourceUiPolicy({kind:'Node',group:'custom.example.com'}).create,'yaml')
})

test('storage resources expose dedicated forms in their real API groups',()=>{
 for(const kind of ['PersistentVolumeClaim','PersistentVolume']){
  assert.equal(resourceUiPolicy({kind,group:''}).create,'form')
  assert.equal(resourceUiPolicy({kind,group:''}).edit,'form')
 }
 assert.equal(resourceUiPolicy({kind:'StorageClass',group:'storage.k8s.io'}).create,'form')
 assert.equal(resourceUiPolicy({kind:'StorageClass',group:'storage.k8s.io'}).edit,'form')
 assert.equal(resourceUiPolicy({kind:'StorageClass',group:'custom.example.com'}).edit,'yaml')
})
