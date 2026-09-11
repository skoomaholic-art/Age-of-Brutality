#!/usr/bin/env node
"use strict";
const fs=require("fs"),path=require("path");
const ROOT=path.resolve(__dirname,"..");
const reg=JSON.parse(fs.readFileSync(path.join(ROOT,"cards","canonical_registry_v5.7.2.json"),"utf8"));
const mgd=JSON.parse(fs.readFileSync(path.join(ROOT,"data","master_game_data_v5.7.2-dev.json"),"utf8"));
const quantityKey=/(колич|копи|тираж|экземпляр|copies|copy|quantity|qty|count)/i;
let total=0;
const counts={};
const quantityFields=[];
for(const [sheet,rows] of Object.entries(reg.sheets||{})){
  counts[sheet]=rows.length; total+=rows.length;
}
for(const [sheet,rows] of Object.entries(mgd.sheets||{})){
  if(!Array.isArray(rows)) continue;
  rows.forEach((row,index)=>{
    if(!row||typeof row!=="object") return;
    const hits=Object.entries(row).filter(([k])=>quantityKey.test(k));
    if(hits.length) quantityFields.push({sheet,index,fields:Object.fromEntries(hits)});
  });
}
console.log("=== CARD QUANTITY AUDIT V5.7.2 ===");
console.log(`registry_object_count=${reg.object_count}`);
console.log(`calculated_registry_rows=${total}`);
console.log(`unique_card_id_count=${reg.unique_card_id_count}`);
console.log("sheet_counts="+JSON.stringify(counts));
console.log(`quantity_like_field_rows=${quantityFields.length}`);
if(quantityFields.length) console.log("quantity_like_fields="+JSON.stringify(quantityFields));
console.log("historical_visual_pack_cards=160");
if(total!==160){
  console.log(`STATUS=UNRESOLVED_PHYSICAL_COPY_COUNT delta=${160-total}`);
  process.exitCode=2;
}else{
  console.log("STATUS=REGISTRY_ROWS_MATCH_HISTORICAL_160");
}
