const fs=require('fs');const [,,F,O]=process.argv;let t=fs.readFileSync(F,'utf8');
const a='resize();layApply();uiHide(OPT.hideUI);prev();updTools();requestAnimationFrame(frame);';
t=t.replace(a,()=>a+'window.__ev=s=>eval(s);window.__dbg=()=>({paused,started});');
const b="function up(o){\n  if(!o||typeof o!=='object')return;";
if(!t.includes(b)){console.error('no up anchor');process.exit(1)}
t=t.replace(b,()=>"window.__up=o=>up(o);window.__snap=()=>snap();window.__M=M;\n  "+b);
fs.writeFileSync(O,t)
