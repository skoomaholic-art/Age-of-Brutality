# RC3 fragment diagnostic

## Fragment integrity
- `engine_runtime.part-00.b64`: base64_bytes=8912, decoded_bytes=6683, decode=PASS
  - invalid_byte_positions=[]
  - error=none
- `engine_runtime.part-01.b64`: base64_bytes=8904, decoded_bytes=6676, decode=PASS
  - invalid_byte_positions=[]
  - error=none
- `engine_runtime.part-02.b64`: base64_bytes=9012, decoded_bytes=6759, decode=PASS
  - invalid_byte_positions=[]
  - error=none
- `engine_runtime.part-03.b64`: base64_bytes=9012, decoded_bytes=6759, decode=PASS
  - invalid_byte_positions=[]
  - error=none
- `engine_runtime.part-04.b64`: base64_bytes=8957, decoded_bytes=6715, decode=PASS
  - invalid_byte_positions=[(6656, 32)]
  - error=none

## Reconstructed prefix
- bytes=33592
- sha256=528a587c1c50622ae7507dd2d10adc025a4b132b83ea3a4d99aec65babffe52b

## JavaScript check
- node_check=FAIL
```text
/tmp/rc3diag/per_part.js:183



SyntaxError: Unexpected end of input
    at wrapSafe (node:internal/modules/cjs/loader:1713:18)
    at checkSyntax (node:internal/main/check_syntax:78:3)

Node.js v22.23.2
```

## Structural markers
- ArenaEngine occurrences: 1
- exportData occurrences: 5
- window.ArenaEngine occurrences: 0
- IIFE endings: 0

## Tail of recovered prefix
```text
his.remainingPartnerSlots(captor)<=0)return{valid:false,detail:' :  1     3 '};h.reserved++;this.spendInfluence(captor,3,' ');this.logPrisoner('execute',owner,c,captor,{detail:`${captor}  ${c.name} (${owner});  1 ,  3 `});this.metrics.total.executions++;this.killCharacter(owner,c,'  ');return{valid:true}}
 resolvePrisonerDecision(rec,choice,amount=null,response=null,detentionChoice=null){
  const c=this.characterByUid(rec.owner,rec.uid);if(!c?.alive||c.heldBy!==rec.captor)return{valid:false,detail:'     '};
  if(choice==='release')return this.releasePrisoner(rec.owner,c,rec.captor,'release');
  if(choice==='hold')return this.detainPrisoner(rec.owner,c,rec.captor,rec.location,detentionChoice);
  if(choice==='execute')return this.executePrisoner(rec.owner,c,rec.captor);
  if(choice!=='ransom')return{valid:false,detail:'   '};

```
