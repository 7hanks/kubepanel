import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
for (const file of ['index.js',...fs.readdirSync('src').filter(x=>x.endsWith('.js')).map(x=>path.join('src',x))]) {
  const check=spawnSync(process.execPath,['--check',file],{stdio:'inherit'})
  if(check.status!==0) process.exit(check.status||1)
}
