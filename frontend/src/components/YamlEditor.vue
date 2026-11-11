<template><div ref="host" class="yaml-editor" :class="{'is-dark':dark}" /></template>
<script setup>
import {ref,onMounted,onUnmounted,watch} from 'vue'
import {EditorState,Compartment} from '@codemirror/state'
import {EditorView,lineNumbers,highlightActiveLineGutter,keymap,drawSelection} from '@codemirror/view'
import {yaml} from '@codemirror/lang-yaml'
import {defaultHighlightStyle,syntaxHighlighting,codeFolding,foldEffect,unfoldEffect,foldedRanges,bracketMatching} from '@codemirror/language'
import {defaultKeymap,history,historyKeymap,indentWithTab} from '@codemirror/commands'
import {yamlFoldRanges} from '../utils/yaml-folds'
const props=defineProps({modelValue:{type:String,default:''},readonly:Boolean,label:{type:String,default:'资源 YAML'},hideManaged:Boolean,hideStatus:Boolean,dark:Boolean})
const emit=defineEmits(['update:modelValue','dblclick'])
const host=ref(null),readOnly=new Compartment(),theme=new Compartment()
let view,disposed=false
function folds(){if(!view||disposed)return;const effects=[];foldedRanges(view.state).between(0,view.state.doc.length,(from,to)=>effects.push(unfoldEffect.of({from,to})));for(const range of yamlFoldRanges(view.state.doc.toString(),{managed:props.hideManaged,status:props.hideStatus}))effects.push(foldEffect.of(range));if(effects.length)view.dispatch({effects})}
const editorTheme=()=>EditorView.theme({'&':{height:'100%',fontSize:'14px',backgroundColor:props.dark?'#172033':'#fafbfc',color:props.dark?'#dce4f2':'#243447'},'.cm-scroller':{overflow:'auto',fontFamily:'Consolas, "SFMono-Regular", monospace',lineHeight:'1.7'},'.cm-content':{padding:'12px 0'},'.cm-gutters':{backgroundColor:props.dark?'#172033':'#f4f6f9',color:'#8994a5',borderRight:'1px solid #e2e7ef'},'.cm-foldPlaceholder':{backgroundColor:'#edf3ff',borderColor:'#c9dcff',color:'#2563eb'},'&.cm-focused':{outline:'none'}},{dark:props.dark})
onMounted(()=>{view=new EditorView({parent:host.value,state:EditorState.create({doc:props.modelValue,extensions:[yaml(),lineNumbers(),highlightActiveLineGutter(),drawSelection(),history(),keymap.of([...defaultKeymap,...historyKeymap,indentWithTab]),syntaxHighlighting(defaultHighlightStyle),bracketMatching(),codeFolding(),readOnly.of([EditorState.readOnly.of(props.readonly),EditorView.editable.of(!props.readonly),EditorView.contentAttributes.of({'aria-label':props.label,'aria-readonly':String(props.readonly)})]),theme.of(editorTheme()),EditorView.domEventHandlers({dblclick:()=>{emit('dblclick');return false}}),EditorView.updateListener.of(update=>{if(update.docChanged){emit('update:modelValue',update.state.doc.toString());queueMicrotask(folds)}})]})});folds()})
watch(()=>props.modelValue,value=>{if(view&&value!==view.state.doc.toString()){view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}});queueMicrotask(folds)}})
watch(()=>props.readonly,value=>{view?.dispatch({effects:readOnly.reconfigure([EditorState.readOnly.of(value),EditorView.editable.of(!value),EditorView.contentAttributes.of({'aria-label':props.label,'aria-readonly':String(value)})])})})
watch(()=>props.dark,()=>view?.dispatch({effects:theme.reconfigure(editorTheme())}))
watch([()=>props.hideManaged,()=>props.hideStatus],()=>queueMicrotask(folds))
onUnmounted(()=>{disposed=true;view?.destroy();view=null})
</script>
<style scoped>.yaml-editor{height:100%;min-height:0;border:1px solid var(--kp-border-strong);border-radius:6px;overflow:hidden;text-align:left}.yaml-editor:focus-within{border-color:var(--kp-brand)}.yaml-editor :deep(.cm-editor){height:100%}.yaml-editor :deep(.cm-scroller){min-height:0}.yaml-editor :deep(.cm-content){min-width:100%}</style>
