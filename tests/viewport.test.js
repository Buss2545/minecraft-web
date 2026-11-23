const {boot,ok,done}=require('./lib');
const SP='/tmp/claude-0/-home-claude/914e2ec0-2c6c-50da-9245-985b207dee98/scratchpad/vp/';require('fs').mkdirSync(SP,{recursive:true});
const VPS=[['phoneP',390,844],['phoneS',360,640],['phoneL',844,390],['phoneSL',640,360],['tabletP',768,1024],['tabletL',1024,768],['desk',1440,900]];
(async()=>{console.log('viewports');const g=await boot(),{E,p}=g;
 await E("closeM();S.day=16;S.min=20*60+10;S.rain=false;toScene('w');P.x=40*TS;P.y=12*TS;trafficTick=()=>{}");
 const SCR={world:"closeM()",tv:"closeM();S.tvDay=S.day;tvMenu(0)",tv4:"closeM();tvMenu(4)",pat:"closeM();patCeremony(SK.find(q=>q.id==='suk'))",menu:"closeM();menu&&menu()",monk:"closeM();skMenu(SK.find(q=>q.id==='suk'))",lot:"closeM();tvMenu(3)"};
 for(const [vn,w,h] of VPS){await p.setViewportSize({width:w,height:h});await p.waitForTimeout(500);
  for(const [sn,code] of Object.entries(SCR)){try{await E(code)}catch(e){}await p.waitForTimeout(350);
   const m=await p.evaluate(()=>{const de=document.documentElement,M=document.getElementById('modal'),c=M&&M.firstElementChild,r=c&&c.getBoundingClientRect(),hud=document.getElementById('hud').getBoundingClientRect(),cv=document.querySelector('canvas');
    const wide=[...document.querySelectorAll('#modal *,#hud *')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&(b.right>innerWidth+1||b.left<-1)}).length;
    return{sw:de.scrollWidth,iw:innerWidth,ih:innerHeight,mOn:M&&M.classList.contains('on'),mh:r?Math.round(r.height):0,mw:r?Math.round(r.width):0,mt:r?Math.round(r.top):0,mb:r?Math.round(r.bottom):0,scroll:c?(getComputedStyle(c).overflowY+'/'+(c.scrollHeight>c.clientHeight)):'',hudW:Math.round(hud.width),hudB:Math.round(hud.bottom),wide}});
   const bad=(m.sw>m.iw+1)||m.wide>0||(m.mOn&&(m.mw>m.iw+1));console.log(vn,sn,JSON.stringify(m),bad?'  ⚠':'');
   if(['world','tv','pat','monk'].includes(sn))await p.screenshot({path:SP+vn+'-'+sn+'.png'})}}
 await done(g,'viewports')})().catch(e=>{console.error(e);process.exit(1)});
