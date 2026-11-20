// /api/ver: ต้องตามการเปลี่ยนเส้นทาง .html → ไม่มีนามสกุล และเวอร์ชันต้องเปลี่ยนเมื่อไฟล์เกมเปลี่ยน (assets จำลอง)
import assert from 'node:assert/strict';
import worker from '../src/index.js';
const files={'/game-core/baan-suan-sukjai-core':'core-v1','/game-core/likhit-chiwit':'lk','/':'index','/game.js':'js','/auto-update.js':'au'};
const redirects={'/game-core/baan-suan-sukjai-core.html':'/game-core/baan-suan-sukjai-core','/game-core/likhit-chiwit.html':'/game-core/likhit-chiwit','/index.html':'/'};
const env={ASSETS:{fetch:async req=>{const u=new URL(req.url);if(redirects[u.pathname])return new Response(null,{status:307,headers:{location:redirects[u.pathname]}});
 const body=files[u.pathname];return body==null?new Response('nf',{status:404}):new Response(body,{status:200,headers:{etag:'"'+body+'"'}})}}};
const call=async(q='')=>(await worker.fetch(new Request('https://x.test/api/ver'+q),env,{waitUntil(){}})).json();
const a=await call();assert.equal(a.ok,true);assert.ok(!a.v.includes('s307')&&!a.v.includes('|x|'),'ไม่ติดค่าคงที่จากการ redirect: '+a.v);
const d=await call('?d=1');assert.ok(d.files.every(f=>!/^s\d|^r$|^e$/.test(f[1])),'ทุกไฟล์อ่านค่าได้: '+JSON.stringify(d.files));
console.log('version-api: ผ่าน (cache 20 วิ ทำให้เทสต์เปลี่ยนเวอร์ชันซ้ำในกระบวนการเดียวกันไม่ได้ ตรวจเฉพาะการตาม redirect)');
