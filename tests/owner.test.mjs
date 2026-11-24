// ระบบเจ้าของเว็บไซต์/แอดมินชั่วคราว (ตรรกะฝั่งเซิร์ฟเวอร์ ใช้ที่เก็บข้อมูลจำลอง) • รัน: node tests/owner.test.mjs
import assert from 'node:assert/strict';
import {AuthCore} from '../src/auth-core.js';
const m=new Map(),st={get:async k=>m.get(k),put:async(k,v)=>{m.set(k,JSON.parse(JSON.stringify(v)))},delete:async k=>m.delete(k),list:async({prefix})=>new Map([...m].filter(([k])=>k.startsWith(prefix)))};
const c=new AuthCore(st);let T=Date.now();c.now=()=>T;
const reg=n=>c.register({username:n,password:'password123',pid:'p'+n,ip:'1'}),pub=async n=>c.pub(await st.get('u:'+n));
const o=await reg('boss'),a=await reg('adm1'),u=await reg('usr1'),CODE='ownercode12345';
assert.equal((await c.claimOwner({uid:o.user.uid,code:'x',setupCode:CODE,ip:'1'})).err,'cred');
assert.equal((await c.claimOwner({uid:u.user.uid,code:'x',setupCode:'',ip:'1'})).err,'disabled');
assert.equal((await c.claimOwner({uid:o.user.uid,code:CODE,setupCode:CODE,ip:'1'})).user.owner,true);
assert.equal((await c.ownerGrant({by:o.user.uid,username:'adm1',hours:1})).ok,true);
assert.equal((await pub('adm1')).role,'admin');
assert.equal((await c.adminTarget(a.user.uid,'boss')).err,'owner','แอดมินแตะเจ้าของไม่ได้');
assert.equal((await c.adminTarget(a.user.uid,'usr1')).err,undefined);
assert.equal((await c.adminTarget(o.user.uid,'adm1',true)).err,undefined,'เจ้าของแตะแอดมินได้');
T+=3700000;assert.equal((await c.expireAdmin(await st.get('u:adm1'))).role,'user','แอดมินชั่วคราวหมดเวลา');
await c.ownerGrant({by:o.user.uid,username:'adm1',hours:0});assert.equal((await pub('adm1')).until,0,'ถาวร');
assert.equal((await c.ownerRevoke({by:o.user.uid,username:'adm1'})).ok,true);assert.equal((await pub('adm1')).role,'user');
await c.ownerGrant({by:o.user.uid,username:'adm1',hours:6});
assert.equal((await c.adminDelete({by:o.user.uid,username:'adm1',owner:true})).ok,true);assert.equal(await st.get('u:adm1'),undefined,'เจ้าของลบบัญชีแอดมินได้');
assert.equal((await c.ownerGrant({by:o.user.uid,username:'boss',hours:1})).err,'self');
assert.equal((await c.ownerGrant({by:o.user.uid,username:'usr1',hours:5})).err,'hours');
assert.equal((await c.claimAdmin({uid:o.user.uid,code:'adminsetupcode1',setupCode:'adminsetupcode1',ip:'1'})).user.owner,true,'กรอกรหัสแอดมินไม่ลดเจ้าของ');
/* อันดับ: แอดมิน/เจ้าของเว็บไม่ขึ้น คนธรรมดาขึ้น */
{const L=new Map(),s2={get:async k=>L.get(k),put:async(k,v)=>{if(typeof k==='object')for(const[a,b]of Object.entries(k))L.set(a,JSON.parse(JSON.stringify(b)));else L.set(k,JSON.parse(JSON.stringify(v)))},delete:async k=>L.delete(k),list:async({prefix})=>new Map([...L].filter(([k])=>k.startsWith(prefix)))};
 const c2=new AuthCore(s2);const R=n=>c2.register({username:n,password:'password123',pid:'p'+n,ip:'1'});
 const ow=await R('boss2'),ad=await R('adm2'),us=await R('usr2');await c2.claimOwner({uid:ow.user.uid,code:CODE,setupCode:CODE,ip:'1'});await c2.ownerGrant({by:ow.user.uid,username:'adm2',hours:0});
 for(const x of[ow,ad,us])await s2.put('svm:'+x.user.uid,{sum:{money:5000,subs:1,day:3,name:'x'}});
 const lb=await c2.leaderboard(true);assert.equal(lb.boards.money.length,1,'อันดับไม่รวมแอดมิน/เจ้าของ');}
console.log('owner: ผ่าน');
