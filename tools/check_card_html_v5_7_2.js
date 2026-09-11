#!/usr/bin/env node
"use strict";
const fs=require("fs"),path=require("path");
const ROOT=path.resolve(__dirname,"..");
function read(rel){const p=path.join(ROOT,rel);if(!fs.existsSync(p))throw new Error(`Missing ${rel}`);return fs.readFileSync(p,"utf8")}
function req(text,needle,label){if(!text.includes(needle))throw new Error(`${label}: missing ${needle}`)}
const editor=read("visual/html_v22/card_editor.html");
const print=read("visual/html_v22/print_studio.html");
const readme=read("visual/html_v22/README.md");
for(const [name,text] of [["editor",editor],["print",print]]){
  req(text,"canonical_registry_v5.7.2.json",name);
  req(text,"63×88",name);
  req(text,"3 мм bleed",name);
  req(text,'"Тип","Дом"',`${name} generic titles`);
}
req(editor,"Разрешить правку игровых полей","editor");
req(editor,"Project JSON","editor");
req(editor,"ART SLOT","editor");
req(print,'["Копий"]',"physical copy expansion");
req(print,"физических карт","physical copy status");
req(print,"69mm","print geometry");
req(print,"94mm","print geometry");
req(print,"210mm","A4 width");
req(print,"297mm","A4 height");
req(print,"repeat(3,69mm)","3x3 columns");
req(print,"repeat(3,94mm)","3x3 rows");
req(readme,"300 dpi","README");
console.log("Card HTML preprint source check OK");
