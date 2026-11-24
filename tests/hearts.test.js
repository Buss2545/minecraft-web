const {boot,ok,done}=require('./lib');
(async()=>{console.log('heart scenes complete');const g=await boot(),{E,p}=g;
 ok(await E("NPCS.concat(SK).every(n=>[3,5,7,10].every(l=>!!heartData(n,l)))"),'ทุกคนมีคัตซีนหัวใจครบ 3/5/7/10');
 ok(await E("NPCS.concat(SK).every(n=>[3,5,7,10].every(l=>{const d=heartData(n,l);return d&&d.lines.length>=3&&d.lines.every(x=>typeof x==='string')}))"),'บทครบทุกฉาก');
 for(const id of['praew','tachat','tanto','chai']){
  await E("closeM();playScene(heartScene(NPCS.concat(SK).find(x=>x.id==\""+id+"\"),3),()=>{});");await p.waitForTimeout(600);
  ok(await E("!!document.querySelector('.cine')"),id+' ♥3 เล่นได้');await E("CS.skp&&CS.skp()");await p.waitForTimeout(900);}
 await done(g,'hearts')})().catch(e=>{console.error(e);process.exit(1)});
