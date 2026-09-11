#!/usr/bin/env node
"use strict";
const fs=require("fs"),path=require("path");
const ROOT=path.resolve(__dirname,"..");
const reg=JSON.parse(fs.readFileSync(path.join(ROOT,"cards","canonical_registry_v5.7.2.json"),"utf8"));
const mgd=JSON.parse(fs.readFileSync(path.join(ROOT,"data","master_game_data_v5.7.2-dev.json"),"utf8"));
const quantityKey=/(колич|копи|тираж|экземпляр|copies|copy|quantity|qty|count)/i;
const physicalSheet=/(event|intrigue|advisor|adviser|ambition|house|character|собы|интриг|совет|амби|дом|персонаж)/i;
let totalDesigns=0, knownPhysicalCopies=0;
const designCounts={}, physicalCounts={}, quantityFields=[], mgdCandidateSheets={};
for(const [sheet,rows] of Object.entries(reg.sheets||{})){
  designCounts[sheet]=rows.length; totalDesigns+=rows.length;
  const physical=rows.reduce((sum,row)=>{
    const raw=Number(row && row["Копий"]);
    const copies=Number.isInteger(raw)&&raw>=1?raw:1;
    return sum+copies;
  },0);
  physicalCounts[sheet]=physical; knownPhysicalCopies+=physical;
}
for(const [sheet,rows] of Object.entries(mgd.sheets||{})){
  if(!Array.isArray(rows)) continue;
  if(physicalSheet.test(sheet)) mgdCandidateSheets[sheet]={rows:rows.length,first_row_keys:rows[0]&&typeof rows[0]==="object"?Object.keys(rows[0]):[]};
  rows.forEach((row,index)=>{
    if(!row||typeof row!=="object") return;
    const hits=Object.entries(row).filter(([k])=>quantityKey.test(k));
    if(hits.length) quantityFields.push({sheet,index,fields:Object.fromEntries(hits)});
  });
}
const hasIntrigues=Object.prototype.hasOwnProperty.call(reg.sheets||{},"Intrigues");
console.log("=== CARD QUANTITY AUDIT V5.7.2 ===");
console.log(`registry_design_count=${reg.object_count}`);
console.log(`calculated_registry_designs=${totalDesigns}`);
console.log(`unique_card_id_count=${reg.unique_card_id_count}`);
console.log("registry_design_counts="+JSON.stringify(designCounts));
console.log("known_physical_counts="+JSON.stringify(physicalCounts));
console.log(`known_physical_copy_count=${knownPhysicalCopies}`);
console.log("mgd_candidate_sheets="+JSON.stringify(mgdCandidateSheets));
console.log(`quantity_like_field_rows=${quantityFields.length}`);
if(quantityFields.length) console.log("quantity_like_fields="+JSON.stringify(quantityFields));
console.log(`intrigues_sheet_present=${hasIntrigues}`);
console.log("historical_visual_pack_cards=160");
if(knownPhysicalCopies!==160){
  console.log(`STATUS=UNRESOLVED_PHYSICAL_COPY_COUNT delta=${160-knownPhysicalCopies}`);
  process.exitCode=2;
}else console.log("STATUS=KNOWN_PHYSICAL_COPIES_MATCH_HISTORICAL_160");
