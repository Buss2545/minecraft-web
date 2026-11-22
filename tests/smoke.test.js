// ไล่เปิดทุกอาคาร/เมนู/จำลองหลายวัน เพื่อจับ error ที่เล็ดลอด
const {boot,ok,done}=require('./lib');
(async()=>{console.log('smoke');const g=await boot(),{E,p}=g;const bad=[];
 const T=async(label,code,w=250)=>{try{await E(code);await p.waitForTimeout(w)}catch(e){bad.push(label+': '+String(e).split('\n')[0].slice(0,140))}};
 const ids=await E("JSON.stringify(BLD.map(b=>b.id))");
 for(const id of JSON.parse(ids)){await T('enter '+id,"closeM();try{toScene('i','"+id+"')}finally{}",300);await T('leave '+id,"toScene('w')",150)}
 for(const m of ['status','dex','outfit','ach','map','quest','bag','friends'])await T('menu '+m,"closeM();menu('"+m+"')",300);
 for(const id of ['grocery','clinic','clothes','flower','phone'])await T('shop '+id,"closeM();shop('"+id+"','buy')",250);
 await T('tv',"closeM();tvMenu(0);tvMenu(1);tvMenu(2)");await T('pat',"closeM();patMenu(SK.find(q=>q.id==='suk'))");await T('alms',"closeM();S.inv={'crop:rice':1};almsPick(SK.find(q=>q.id==='suk'))");
 await T('computer',"closeM();computerMenu()",500);await T('shop pc',"closeM();shopPcDesk()");await T('weather app',"closeM();wxApp&&0");
 for(let i=0;i<30;i++)await T('sleep day '+i,"closeM();S.energy=40;S.hp=S.hp||50;sleepNow(true,'ทดสอบ')",350);
 await T('sleep',"closeM();sleepMenu&&sleepMenu()",300);
 console.log(bad.length?'พบปัญหา:\n'+bad.join('\n'):'ไม่พบ error');
 ok(bad.length===0,'smoke: เปิดทุกอาคาร/เมนูไม่ error');await done(g,'smoke')})().catch(e=>{console.error(e);process.exit(1)});
