// ตัวช่วยทดสอบ: แทนโมดูล "cloudflare:workers" (มีเฉพาะบน Cloudflare) ด้วยของจำลอง เพื่อรัน src/index.js ใน Node ได้
import {register} from 'node:module';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){if(s==='cloudflare:workers')return{url:'data:text/javascript,export class DurableObject{constructor(a,b){this.ctx=a;this.env=b}}',shortCircuit:true};return n(s,c)}`));
