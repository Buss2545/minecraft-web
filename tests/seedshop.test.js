const {boot,ok,done}=require('./lib');
(async()=>{console.log('seedshop');const g=await boot(),{E,p}=g;
 for(const day of [2,30,60,90]){await E("S.day="+day);
  ok(await E("(()=>{const se=season();return !!document&&Object.keys(CROPS).filter(k=>CROPS[k].s.includes(se)).length>0})()"),'วัน '+day+' มีเมล็ดในฤดู');}
 const st=await E("(()=>{const m={};let n=0,tot=0;for(let d=1;d<=300;d++){S.day=d;for(const k in CROPS){tot++;const x=seedDeal(k);if(x){n++;m[x]=(m[x]||0)+1}}}return{n,tot,m,max:Math.max(...Object.keys(m).map(Number))}})()");
 console.log(JSON.stringify(st));ok(st.max<=40&&st.n>0&&st.n/st.tot<.4,'ลดสูงสุด 40% และไม่ลดทุกวัน');
 await E("closeM();toScene('w');S.day=5;S.money=9999;shop('grocery','buy')");await p.waitForTimeout(600);
 const t=await E("M.textContent");console.log(t.slice(0,500));
 ok(await E("(()=>{const se=season();return Object.keys(CROPS).every(k=>CROPS[k].s.includes(se)===new RegExp('เมล็ด'+CROPS[k].n+'( |🏷|฿)').test(M.textContent))})()"),'ร้านชำแสดงเฉพาะเมล็ดตามฤดู');
 await p.screenshot({path:'/tmp/seed.png'});
 await E("closeM();DLV.tab='gro';");
 ok(await E("dlvShops().find(x=>x.id==='gro').it.filter(i=>i[0].startsWith('seed:')).every(i=>CROPS[i[0].slice(5)].s.includes(season()))"),'แอปส่งสุขก็กรองตามฤดู');
 await done(g,'seedshop')})().catch(e=>{console.error(e);process.exit(1)});
