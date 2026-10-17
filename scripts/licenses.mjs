import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const dirs=execFileSync('npm',['ls','--omit=dev','--parseable','--all'],{encoding:'utf8'}).trim().split('\n').slice(1);
const notices=['Personal Atlas — Runtime dependency license notices\nGenerated from installed, lockfile-resolved production dependencies.'];
for(const dir of [...new Set(dirs)].sort()){
 const p=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
 const files=fs.readdirSync(dir).filter(name=>/^licen[cs]e(?:\.|$)/i.test(name)&&fs.statSync(path.join(dir,name)).isFile());
 notices.push(`\n${'='.repeat(72)}\n${p.name} ${p.version}\nDeclared license: ${typeof p.license==='string'?p.license:JSON.stringify(p.license)}\n`);
 if(!files.length)throw new Error(`License text not found: ${p.name}; inspect before redistribution.`);
 for(const file of files)notices.push(fs.readFileSync(path.join(dir,file),'utf8'));
}
fs.writeFileSync('public/licenses/THIRD_PARTY_NOTICES.txt',notices.join('\n'));
console.log(`Saved notices for ${new Set(dirs).size} runtime dependency packages.`);
