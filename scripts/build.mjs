import {cp,mkdir,readFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});await cp('src','dist',{recursive:true});const html=await readFile('dist/index.html','utf8');for(const match of html.matchAll(/(?:src|href)="(\/[^"#]+)"/g))await readFile('dist'+match[1]);console.log('Built standalone frontend; no AWS calls were made.');
