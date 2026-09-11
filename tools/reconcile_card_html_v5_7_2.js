#!/usr/bin/env node
"use strict";
const fs=require("fs"),path=require("path");
const ROOT=path.resolve(__dirname,"..");
const EDITOR=path.join(ROOT,"visual","html_v22","card_editor.html");
const PRINT=path.join(ROOT,"visual","html_v22","print_studio.html");
function patch(file,replacements){
  let s=fs.readFileSync(file,"utf8");
  for(const [oldText,newText] of replacements){
    if(s.includes(oldText)) s=s.replace(oldText,newText);
    else if(!s.includes(newText)) throw new Error(`Cannot reconcile ${path.relative(ROOT,file)}: pattern missing: ${oldText.slice(0,100)}`);
  }
  fs.writeFileSync(file,s,"utf8");
}
const oldTitles='TIT=["Название","Имя","NAME","Name","TITLE","Title"]';
const newTitles='TIT=["Название","Имя","NAME","Name","TITLE","Title","Тип","Дом"]';
patch(EDITOR,[
  [oldTitles,newTitles],
  ['function sub(r,s){for(const k of SUB)if(r?.[k])return String(r[k]);return s}',
   'function sub(r,s){const t=title(r);for(const k of [...SUB,"Правитель"])if(r?.[k]&&String(r[k])!==t)return String(r[k]);return s}']
]);
patch(PRINT,[
  [oldTitles,newTitles],
  ['function sub(r,s){for(const k of SUB)if(r?.[k])return String(r[k]);return s}',
   'function sub(r,s){const t=title(r);for(const k of [...SUB,"Правитель"])if(r?.[k]&&String(r[k])!==t)return String(r[k]);return s}'],
  ['let A=P.cards.filter(c=>(!sf||c.sheet===sf)&&(!only||S.has(c.uid)));const out=$("#pages");',
   'const designs=P.cards.filter(c=>(!sf||c.sheet===sf)&&(!only||S.has(c.uid)));let A=designs.flatMap(c=>{const raw=Number(c.data?.["Копий"]);const copies=Number.isInteger(raw)&&raw>=1?raw:1;return Array.from({length:copies},(_,i)=>({...c,printCopy:i+1,printCopies:copies}))});const out=$("#pages");'],
  ['$("#stat").textContent=`${A.length} карт • ${Math.ceil(A.length/9)} A4 • выбрано ${S.size}`',
   '$("#stat").textContent=`${A.length} физических карт • ${designs.length} дизайнов • ${Math.ceil(A.length/9)} A4`']
]);
console.log("Card HTML reconcile OK");
