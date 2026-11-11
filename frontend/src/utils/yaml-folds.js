import { yamlLanguage } from '@codemirror/lang-yaml'
export function yamlFoldRanges(text,{managed=false,status=false}={}) {
 if(!managed&&!status)return []
 if(text.length>2*1024*1024)return []
 const tree=yamlLanguage.parser.parse(text),ranges=[]
 const key=pair=>text.slice(pair.firstChild?.from,pair.firstChild?.to).replace(/^['"]|['"]$/g,'')
 const pairs=(node,fn)=>{for(let child=node?.firstChild;child;child=child.nextSibling)if(child.name==='Pair')fn(child)}
 for(let document=tree.topNode.firstChild;document;document=document.nextSibling){
  const mapping=document.getChild('BlockMapping')
  pairs(mapping,pair=>{
   if(status&&key(pair)==='status')ranges.push({from:pair.from,to:pair.to})
   if(managed&&key(pair)==='metadata')pairs(pair.getChild('BlockMapping'),item=>{if(key(item)==='managedFields')ranges.push({from:item.from,to:item.to})})
  })
 }
 return ranges.sort((a,b)=>a.from-b.from)
}
