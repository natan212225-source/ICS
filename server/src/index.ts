import express from 'express'; import cors from 'cors'; import jwt from 'jsonwebtoken'; import bcrypt from 'bcryptjs'; import crypto from 'crypto';
import fs from 'fs'; import path from 'path'; import { z } from 'zod';
import { PrismaClient } from '@prisma/client'; import ExcelJS from 'exceljs';
import { allowedPermissions, parsePermissions, serializePermissions } from './permissions';
import { Document, Packer, Paragraph, Table, TableRow, TableCell, HeadingLevel } from 'docx';
import { jsPDF } from 'jspdf'; import { applyPlugin, type UserOptions } from 'jspdf-autotable';
import regions from './regions.json'; import { stamp } from './calendar';
declare module 'jspdf' {
 interface jsPDF { autoTable(options:UserOptions):void; }
}
const S=process.env.JWT_SECRET, db=new PrismaClient(), app=express();
if(!S||S.length<64)throw new Error('JWT_SECRET must be set to at least 64 characters');
if(process.env.NODE_ENV==='production'&&process.env.JWT_SECRET==='change-me-in-production')throw new Error('A production JWT_SECRET is required');
const isProduction=process.env.NODE_ENV==='production';
const allowedOrigins=(process.env.CORS_ORIGINS||'http://127.0.0.1:5173,http://localhost:5173').split(',').map(s=>s.trim()).filter(Boolean);
applyPlugin(jsPDF);
app.disable('x-powered-by');
app.set('trust proxy',1);
app.use((q,r,n)=>{r.setHeader('X-Content-Type-Options','nosniff');r.setHeader('Referrer-Policy','no-referrer');r.setHeader('X-Frame-Options','DENY');r.setHeader('Permissions-Policy','camera=(self),microphone=(),geolocation=()');r.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; media-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");if(isProduction)r.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');n();});
app.use(cors({origin:(origin,cb)=>{
 if(!origin||allowedOrigins.includes(origin)) return cb(null,true);
 cb(null,false);
},credentials:true,methods:['GET','POST','PUT','PATCH','DELETE'],allowedHeaders:['Content-Type','Authorization','X-ICS-CSRF']}));
app.use(express.json({limit:'8mb'}));
app.use((error:any,_q:any,r:any,n:any)=>{
 if(error instanceof SyntaxError&&'body'in error)return r.status(400).json({error:'Request body contains invalid JSON'});
 if(error?.type==='entity.too.large')return r.status(413).json({error:'Request body is too large'});
 n(error);
});
const loginAttempts=new Map<string,{count:number;until:number}>();
const adminMutationAttempts=new Map<string,{count:number;until:number}>();
const adminMutationLimit=(q:any,r:any,n:any)=>{
 const key=String(q.ip||q.socket?.remoteAddress||'unknown');
 const now=Date.now();
 const entry=adminMutationAttempts.get(key);
 if(entry?.until>now)return r.status(429).json({error:'Too many administration requests. Try again later.'});
 const next=entry&&entry.until<=now?{count:0,until:0}:entry||{count:0,until:0};
 next.count++;
 if(next.count>=60)next.until=now+15*60e3;
 adminMutationAttempts.set(key,next);
 n();
};
const getCookie=(q:any,name:string)=>String(q.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||'';
const cookie=(name:string,value:string,maxAge:number)=>`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict${isProduction?'; Secure':''}; Max-Age=${maxAge}`;
const clearCookie=(name:string)=>`${name}=; Path=/; HttpOnly; SameSite=Strict${isProduction?'; Secure':''}; Max-Age=0`;
const hashToken=(token:string)=>crypto.createHash('sha256').update(token).digest('hex');
const passwordPolicy=(password:string)=>password.length>=14&&/[a-z]/.test(password)&&/[A-Z]/.test(password)&&/[0-9]/.test(password)&&/[^A-Za-z0-9]/.test(password);
const parseJsonObject=(value:unknown,fallback:any={})=>{
 if(typeof value!=='string')return fallback;
 try{
  const parsed=JSON.parse(value);
  return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:fallback;
 }catch{return fallback}
};
const W=(f:any)=>(q:any,r:any,n:any)=>Promise.resolve(f(q,r,n)).catch(e=>{
 console.error('[ICS API 500]',{
  method:q.method,
  path:q.originalUrl,
  code:e?.code||e?.name||'InternalError',
  message:e?.message,
  stack:e?.stack
 });
 if(e?.code==='P2002') return r.status(409).json({error:'A record with that unique value already exists'});
 if(e?.code==='P2025') return r.status(404).json({error:'Record not found'});
 if(e?.code==='P2003') return r.status(400).json({error:'A related role or branch no longer exists'});
 if(e?.code==='P2014') return r.status(409).json({error:'The record is referenced by other data and cannot be removed'});
 if(e?.code==='P2021'||e?.code==='P2022') return r.status(503).json({error:'Database schema is not ready. Run prisma db push and restart the server'});
 if(e?.code==='P2024'||e?.code==='P2034'||e?.code==='P2010'||String(e?.message||'').match(/database is (locked|busy)|sqlite_busy|sqlite_locked/i)) return r.status(503).json({error:'Database is temporarily busy. Please retry the request'});
 if(e?.issues&&Array.isArray(e.issues)) return r.status(400).json({error:e.issues.map((issue:any)=>issue.message).join(', ')});
 r.status(500).json({error:'Request could not be completed'});
});
const auth=async(q:any,r:any,n:any)=>{try{
 const fromCookie=getCookie(q,'ics_access');
 const bearer=(q.headers.authorization||'').startsWith('Bearer ')?(q.headers.authorization||'').slice(7):'';
 const token=fromCookie||bearer;
 if(!token)throw 0;
 const t:any=jwt.verify(token,S,{algorithms:['HS256'],issuer:'ics-api',audience:'ics-web'});
 const u=await db.user.findUnique({where:{id:t.id},include:{role:true,branch:true}});
 if(!u||u.suspended||u.passwordVersion!==t.pv)throw 0;
 q.u=u;q.perms=parsePermissions(u.role.permissions);n();
 }catch{r.status(401).json({error:'Unauthorized'})}};
const can=(p:string)=>(q:any,r:any,n:any)=>q.perms.includes(p)?n():r.status(403).json({error:'Forbidden: '+p});
const log=(q:any,action:string,detail='')=>db.auditLog.create({data:{userId:q.u.id,action,detail,ip:q.ip||'',...stamp()}});
const wide=(u:any)=>u.role.name==='SUPER_ADMIN'||u.branch.isHead;
const scope=(q:any)=>wide(q.u)?{}:{branchId:q.u.branchId};
const passwordDeadline=(u:any)=>u.passwordUpdatedAt ? new Date(u.passwordUpdatedAt).getTime()+15*24*60*60*1000 : 0;
const strip=(u:any)=>({id:u.id,username:u.username,fullName:u.fullName,suspended:u.suspended,role:u.role.name,roleId:u.roleId,perms:parsePermissions(u.role.permissions),branch:u.branch.name,branchId:u.branchId,passwordChangeRequired:u.passwordMustChange||passwordDeadline(u)>0&&passwordDeadline(u)<=Date.now()});
const safeDetails=(value:any)=>{const blocked=/<(script|style|iframe|object|svg|math|video|audio|img)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,allowed=new Set(['b','strong','i','em','u','s','strike','ul','ol','li','br','p','div','h2','h3','span','font']);
 let html=String(value||'').replace(/<!--[\s\S]*?-->/g,'').replace(blocked,'').replace(/<\/?(script|style|iframe|object|svg|math|video|audio|img)\b[^>]*\/?>/gi,'');
 return html.replace(/<\/?([a-z0-9]+)\b([^>]*)>/gi,(_tag:string,rawName:string,attrs:string)=>{let name=rawName.toLowerCase();if(!allowed.has(name))return '';const closing=_tag.startsWith('</');if(closing)return `</${name==='font'?'span':name}>`;
  const styles:string[]=[];const styleMatch=attrs.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i),styleText=styleMatch?.[1]||styleMatch?.[2]||'';
  styleText.split(';').forEach((rule:string)=>{const [key,...parts]=rule.split(':');const prop=key?.trim().toLowerCase(),v=parts.join(':').trim();if(prop==='text-align'&&/^(left|right|center|justify)$/.test(v))styles.push(`${prop}:${v}`);
   if((prop==='color'||prop==='background-color')&&/^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\(\s*[\d.,%\s]+\))$/i.test(v))styles.push(`${prop}:${v}`);
   if(prop==='font-size'&&/^(8|9|10|11|12|14|16|18|20|24|28|32|36)(px|pt)?$/i.test(v))styles.push(`${prop}:${v}`);
   if(prop==='font-family'&&/^(Arial|Calibri|Georgia|Tahoma|Verdana|sans-serif|serif)(,\s*(Arial|Calibri|Georgia|Tahoma|Verdana|sans-serif|serif))*$/i.test(v))styles.push(`${prop}:${v}`);
  });
  if(name==='font'){const color=attrs.match(/\bcolor\s*=\s*["']?([#a-z0-9(),.%\s]+)["']?/i)?.[1]?.trim(),face=attrs.match(/\bface\s*=\s*["']?([a-z]+)["']?/i)?.[1],size=attrs.match(/\bsize\s*=\s*["']?([1-7])["']?/i)?.[1],sizes:any={'1':'10px','2':'12px','3':'14px','4':'16px','5':'20px','6':'28px','7':'36px'};
   if(color&&/^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\(\s*[\d.,%\s]+\))$/i.test(color))styles.push(`color:${color}`);if(face&&/^(Arial|Calibri|Georgia|Tahoma|Verdana)$/i.test(face))styles.push(`font-family:${face}`);if(size)styles.push(`font-size:${sizes[size]}`);
   name='span';
  }
  const safeStyle=[...new Set(styles)].join(';');return `<${name}${safeStyle?` style="${safeStyle}"`:''}>`;
 });
};
// aging job: Not taken > 180 days => OLD
const age=()=>db.lostItem.updateMany({where:{status:'NOT_TAKEN',createdAt:{lt:new Date(Date.now()-180*864e5)}},data:{status:'OLD'}});
setInterval(()=>age().catch(()=>{}),36e5);age().catch(()=>{});

app.use('/api',(q,r,n)=>{
 if(!['GET','HEAD','OPTIONS'].includes(q.method)){
  if(q.headers['x-ics-csrf']!=='1')return r.status(403).json({error:'Forbidden'});
  const origin=q.headers.origin;
  if(origin&&allowedOrigins.length&&!allowedOrigins.includes(String(origin)))return r.status(403).json({error:'Forbidden'});
 }
 n();
});
app.post('/api/login',W(async(q:any,r:any)=>{
 const ip=String(q.ip||q.socket?.remoteAddress||'unknown');
 const username=typeof q.body?.username==='string'?q.body.username.trim().toLowerCase():'';
 const password=typeof q.body?.password==='string'?q.body.password:'';
 if(!username||!password)return r.status(400).json({error:'Invalid credentials'});
 const attemptKey=`${ip}:${username}`;
 const attempts=loginAttempts.get(attemptKey);
 if(attempts&&attempts.until>Date.now())return r.status(429).json({error:'Too many attempts. Try again later.'});
 const u=(await db.user.findMany({include:{role:true,branch:true}})).find((x:any)=>x.username.trim().toLowerCase()===username&&!x.deletedAt)||null;
 const valid=!!u&&!u.suspended&&(!u.lockedUntil||new Date(u.lockedUntil).getTime()<=Date.now())&&bcrypt.compareSync(password,u.password);
 if(!valid){
  if(u&&!u.suspended){const failed=u.failedAttempts+1,locked=failed>=5?new Date(Date.now()+15*60e3):null;await db.user.update({where:{id:u.id},data:{failedAttempts:failed,lockedUntil:locked}});
   await db.auditLog.create({data:{userId:u.id,action:'login_failed',detail:'Authentication rejected',ip,...stamp()}});
  }
  const next=loginAttempts.get(attemptKey)||{count:0,until:0};next.count++;if(next.count>=10)next.until=Date.now()+15*60e3;loginAttempts.set(attemptKey,next);
  return r.status(401).json({error:'Invalid credentials'});
 }
 await db.user.update({where:{id:u.id},data:{failedAttempts:0,lockedUntil:null}});
 const access=jwt.sign({id:u.id,pv:u.passwordVersion},S,{algorithm:'HS256',expiresIn:'15m',issuer:'ics-api',audience:'ics-web'});
 const refresh=crypto.randomBytes(48).toString('base64url');
 const expiresAt=new Date(Date.now()+7*24*60*60e3);
 await db.refreshSession.create({data:{id:crypto.randomUUID(),tokenHash:hashToken(refresh),userId:u.id,expiresAt,ip,userAgent:String(q.headers['user-agent']||'')}});
 r.setHeader('Set-Cookie',[cookie('ics_access',access,15*60),cookie('ics_refresh',refresh,7*24*60*60)]);
 loginAttempts.delete(attemptKey);
 q.u=u;await log(q,'login','session established');
 r.json({token:access,user:strip(u)});
}));
app.post('/api/refresh',W(async(q:any,r:any)=>{
 const refresh=getCookie(q,'ics_refresh');if(!refresh)return r.status(401).json({error:'Session expired'});
 const session=await db.refreshSession.findUnique({where:{tokenHash:hashToken(refresh)},include:{user:{include:{role:true,branch:true}}}});
 if(!session||session.revokedAt||session.expiresAt<=new Date()||session.user.suspended)return r.status(401).json({error:'Session expired'});
 await db.refreshSession.update({where:{id:session.id},data:{revokedAt:new Date()}});
 const replacement=crypto.randomBytes(48).toString('base64url'),expiresAt=new Date(Date.now()+7*24*60*60e3);
 await db.refreshSession.create({data:{id:crypto.randomUUID(),tokenHash:hashToken(replacement),userId:session.userId,expiresAt,ip:String(q.ip||''),userAgent:String(q.headers['user-agent']||'')}});
 const access=jwt.sign({id:session.userId,pv:session.user.passwordVersion},S,{algorithm:'HS256',expiresIn:'15m',issuer:'ics-api',audience:'ics-web'});
 r.setHeader('Set-Cookie',[cookie('ics_access',access,15*60),cookie('ics_refresh',replacement,7*24*60*60)]);
 r.json({token:access,user:strip(session.user)});
}));
app.post('/api/logout',auth,W(async(q:any,r:any)=>{
 const refresh=getCookie(q,'ics_refresh');
 if(refresh)await db.refreshSession.updateMany({where:{tokenHash:hashToken(refresh),revokedAt:null},data:{revokedAt:new Date()}});
 await log(q,'logout');
 r.setHeader('Set-Cookie',[clearCookie('ics_access'),clearCookie('ics_refresh')]);r.json({ok:true});
}));
app.get('/api/regions',(_q,r)=>r.json(regions));
app.post('/api/password/forgot',W(async(q:any,r:any)=>{
 const username=String(q.body?.username||'').trim().toLowerCase();if(!username)return r.status(400).json({error:'Username is required'});
 const target=(await db.user.findMany()).find((x:any)=>x.username.trim().toLowerCase()===username&&!x.deletedAt)||null;
 if(target){const pending=await db.approvalRequest.findFirst({where:{recordId:target.id,type:'PASSWORD_RESET',status:'PENDING'}});
  if(!pending)await db.approvalRequest.create({data:{recordId:target.id,type:'PASSWORD_RESET',payload:'{}',reason:'User requested a forgotten-password reset',requestedBy:target.id,branchId:target.branchId}});
 }
 r.json({ok:true,message:'If the account exists, an administrator approval request was created.'});
}));
app.use('/api',auth);
app.get('/api/me',(q:any,r)=>r.json(strip(q.u)));
// --- admin: users, branches, roles
app.get('/api/users',can('manage_users'),W(async(q:any,r:any)=>{
 const search=String(q.query.search||'').trim();
 const page=Math.max(1,Number(q.query.page)||1);
 const pageSize=Math.min(100,Math.max(1,Number(q.query.pageSize)||25));
 const where:any={
  deletedAt:null,
  ...(search?{OR:[
   {username:{contains:search}},
   {fullName:{contains:search}},
   {role:{name:{contains:search}}},
   {branch:{name:{contains:search}}}
  ]}:{})
 };
 const [rows,total]=await Promise.all([
  db.user.findMany({where,include:{role:true,branch:true},orderBy:{id:'desc'},skip:(page-1)*pageSize,take:pageSize}),
  db.user.count({where})
 ]);
 r.json({users:rows.map(strip),total,page,pageSize,pages:Math.max(1,Math.ceil(total/pageSize))});
}));
app.post('/api/users',adminMutationLimit,can('manage_users'),W(async(q:any,r:any)=>{
 const b=q.body,username=typeof b.username==='string'?b.username.trim().toLowerCase():'';if(!/^[a-z0-9_.-]{3,64}$/i.test(username))return r.status(400).json({error:'Invalid username'});
 if(typeof b.fullName!=='string'||b.fullName.trim().length<2||b.fullName.trim().length>100)return r.status(400).json({error:'Invalid full name'});
 if(typeof b.password!=='string'||!passwordPolicy(b.password))return r.status(400).json({error:'Password must be 14+ characters with upper, lower, number, and symbol'});
 if(b.confirmPassword!==undefined&&b.confirmPassword!==b.password)return r.status(400).json({error:'Password confirmation does not match'});
 const roleId=Number(b.roleId),branchId=Number(b.branchId);if(!Number.isInteger(roleId)||!Number.isInteger(branchId))return r.status(400).json({error:'Invalid role or branch'});
 const [role,branch,users]=await Promise.all([db.role.findUnique({where:{id:roleId}}),db.branch.findUnique({where:{id:branchId}}),db.user.findMany()]);
 if(!role)return r.status(400).json({error:'Selected role does not exist'});
 if(!branch)return r.status(400).json({error:'Selected branch does not exist'});
 const existing=users.find((x:any)=>x.username.trim().toLowerCase()===username);
 if(existing)return r.status(409).json({error:'Username already exists'});
 try{
  const suspended=b.active===false;
  const u=await db.user.create({data:{username,fullName:b.fullName.trim(),password:bcrypt.hashSync(b.password,12),passwordUpdatedAt:new Date(),passwordMustChange:false,failedAttempts:0,lockedUntil:null,deletedAt:null,suspended,roleId,branchId}});
  await db.refreshSession.updateMany({where:{userId:u.id,revokedAt:null},data:{revokedAt:new Date()}});
   await log(q,'user_create',username);
  const created=await db.user.findUnique({where:{id:u.id},include:{role:true,branch:true}});
   r.status(201).json({user:created?strip(created):null});
 }catch(e:any){if(e?.code==='P2002')return r.status(409).json({error:'Username already exists'});throw e;}
}));
app.put('/api/users/:id',adminMutationLimit,can('manage_users'),W(async(q:any,r:any)=>{
 const id=Number(q.params.id);
 if(!Number.isInteger(id)||id<=0||id===q.u.id)return r.status(400).json({error:'Invalid user'});
 const target=await db.user.findUnique({where:{id}});
 if(!target||target.deletedAt)return r.status(404).json({error:'User not found'});
 const fullName=typeof q.body.fullName==='string'?q.body.fullName.trim():target.fullName;
 if(fullName.length<2||fullName.length>100)return r.status(400).json({error:'Full name must be 2-100 characters'});
 const roleId=q.body.roleId===undefined?target.roleId:Number(q.body.roleId);
 const branchId=q.body.branchId===undefined?target.branchId:Number(q.body.branchId);
 if(!Number.isInteger(roleId)||!Number.isInteger(branchId))return r.status(400).json({error:'Invalid role or branch'});
 const [role,branch]=await Promise.all([db.role.findUnique({where:{id:roleId}}),db.branch.findUnique({where:{id:branchId}})]);
 if(!role)return r.status(400).json({error:'Selected role does not exist'});
 if(!branch)return r.status(400).json({error:'Selected branch does not exist'});
 const update:any={fullName,roleId,branchId};
 if(typeof q.body.suspended==='boolean')update.suspended=q.body.suspended;
 if(q.body.password!==undefined){
  if(typeof q.body.password!=='string'||!passwordPolicy(q.body.password))return r.status(400).json({error:'Password must be 14+ characters with upper, lower, number, and symbol'});
  update.password=bcrypt.hashSync(q.body.password,12);
  update.passwordUpdatedAt=new Date();
  update.passwordMustChange=false;
  update.passwordVersion={increment:1};
 }
 const updated=await db.user.update({where:{id},data:update,include:{role:true,branch:true}});
 await db.refreshSession.updateMany({where:{userId:id,revokedAt:null},data:{revokedAt:new Date()}});
 await log(q,'user_update',target.username);
 r.json(strip(updated));
}));
app.patch('/api/users/:id',can('manage_users'),W(async(q:any,r:any)=>{
 const id=Number(q.params.id);if(!Number.isInteger(id)||id===q.u.id)return r.status(400).json({error:'Invalid user'});
 const target=await db.user.findUnique({where:{id}});if(!target)return r.status(404).json({error:'User not found'});
 const update:any={};
 if(typeof q.body.suspended==='boolean')update.suspended=q.body.suspended;
 if(q.body.fullName!==undefined){const fullName=String(q.body.fullName).trim();if(fullName.length<2||fullName.length>100)return r.status(400).json({error:'Invalid full name'});update.fullName=fullName}
 if(q.body.roleId!==undefined){const roleId=Number(q.body.roleId);if(!Number.isInteger(roleId))return r.status(400).json({error:'Invalid role'});update.roleId=roleId}
 if(q.body.branchId!==undefined){const branchId=Number(q.body.branchId);if(!Number.isInteger(branchId))return r.status(400).json({error:'Invalid branch'});update.branchId=branchId}
 if(!Object.keys(update).length)return r.status(400).json({error:'No supported changes'});
 const pending=await db.approvalRequest.findFirst({where:{recordId:id,type:'USER_CHANGE',status:'PENDING'}});
 if(pending)return r.status(409).json({error:'A change request is already pending for this account'});
 const request=await db.approvalRequest.create({data:{recordId:id,type:'USER_CHANGE',payload:JSON.stringify({before:{fullName:target.fullName,roleId:target.roleId,branchId:target.branchId,suspended:target.suspended},changes:update}),reason:String(q.body.reason||'Account administration change').trim(),requestedBy:q.u.id,branchId:target.branchId}});
 await log(q,'request_USER_CHANGE','approval:'+request.id);r.json({ok:true,approvalId:request.id,pending:true});
}));
app.delete('/api/users/:id',adminMutationLimit,can('manage_users'),W(async(q:any,r:any)=>{
 const id=Number(q.params.id);if(!Number.isInteger(id)||id===q.u.id)return r.status(400).json({error:'Invalid user'});
 const target=await db.user.findUnique({where:{id}});if(!target)return r.status(404).json({error:'User not found'});
 const reason=String(q.body?.reason||'').trim();if(!reason)return r.status(400).json({error:'Deletion reason is required'});
 await db.refreshSession.updateMany({where:{userId:id,revokedAt:null},data:{revokedAt:new Date()}});
 await db.user.update({where:{id},data:{deletedAt:new Date(),suspended:true}});
 await log(q,'user_delete',`${target.username}: ${reason}`);
 r.status(204).send();
}));
app.post('/api/users/:id/password-request',W(async(q:any,r:any)=>{
 const id=Number(q.params.id);const target=await db.user.findUnique({where:{id}});if(!target)return r.status(404).json({error:'User not found'});
 if(q.u.id!==id&&q.u.role.name!=='SUPER_ADMIN'&&!q.perms.includes('manage_users'))return r.status(403).json({error:'Forbidden'});
 const oldPassword=String(q.body?.oldPassword||''),newPassword=String(q.body?.newPassword||''),confirmPassword=String(q.body?.confirmPassword||'');
 if(!bcrypt.compareSync(oldPassword,target.password))return r.status(400).json({error:'Old password is incorrect'});
 if(newPassword!==confirmPassword)return r.status(400).json({error:'New password and confirmation do not match'});
 if(!passwordPolicy(newPassword))return r.status(400).json({error:'Password must be 14+ characters with upper, lower, number, and symbol'});
 if(await bcrypt.compare(newPassword,target.password))return r.status(400).json({error:'New password must differ from the old password'});
 const pending=await db.approvalRequest.findFirst({where:{recordId:id,type:'PASSWORD_CHANGE',status:'PENDING'}});
 if(pending)return r.status(409).json({error:'A password change request is already pending'});
 const request=await db.approvalRequest.create({data:{recordId:id,type:'PASSWORD_CHANGE',payload:JSON.stringify({newPasswordHash:bcrypt.hashSync(newPassword,12)}),reason:String(q.body?.reason||'Password change request').trim(),requestedBy:q.u.id,branchId:target.branchId}});
 await log(q,'request_PASSWORD_CHANGE','approval:'+request.id);r.json({ok:true,approvalId:request.id,pending:true});
}));
app.post('/api/password/forgot',W(async(q:any,r:any)=>{
 const username=String(q.body?.username||'').trim().toLowerCase();if(!username)return r.status(400).json({error:'Username is required'});
 const target=await db.user.findUnique({where:{username}});
 if(target){const pending=await db.approvalRequest.findFirst({where:{recordId:target.id,type:'PASSWORD_RESET',status:'PENDING'}});
  if(!pending)await db.approvalRequest.create({data:{recordId:target.id,type:'PASSWORD_RESET',payload:'{}',reason:'User requested a forgotten-password reset',requestedBy:target.id,branchId:target.branchId}});
 }
 r.json({ok:true,message:'If the account exists, an administrator approval request was created.'});
}));
app.get('/api/branches',W(async(_q:any,r:any)=>r.json(await db.branch.findMany())));
app.post('/api/branches',can('manage_users'),W(async(q:any,r:any)=>{
 if(q.u.role.name!=='SUPER_ADMIN')return r.status(403).json({error:'Forbidden'});
 if(typeof q.body.name!=='string'||q.body.name.trim().length<2||typeof q.body.code!=='string'||!/^[A-Z0-9_-]{2,20}$/i.test(q.body.code))return r.status(400).json({error:'Invalid branch'});
 r.json(await db.branch.create({data:{name:q.body.name.trim(),code:q.body.code.trim().toUpperCase(),region:typeof q.body.region==='string'?q.body.region.slice(0,100):'',isHead:!!q.body.isHead}}));await log(q,'branch_create',q.body.code);
}));
app.get('/api/roles',can('manage_users'),W(async(q:any,r:any)=>{
 const search=String(q.query.search||'').trim();
 const page=Math.max(1,Number(q.query.page)||1);
 const pageSize=Math.min(100,Math.max(1,Number(q.query.pageSize)||100));
 const where=search?{name:{contains:search}}:{};
 const [rows,total]=await Promise.all([db.role.findMany({where,orderBy:{name:'asc'},skip:(page-1)*pageSize,take:pageSize}),db.role.count({where})]);
 r.json({roles:rows.map((role:any)=>({...role,permissions:parsePermissions(role.permissions)})),total,page,pageSize});
}));
app.get('/api/roles/:id',can('manage_users'),W(async(q:any,r:any)=>{
 const id=Number(q.params.id);
 if(!Number.isInteger(id))return r.status(400).json({error:'Invalid role'});
 const role=await db.role.findUnique({where:{id}});
 if(!role)return r.status(404).json({error:'Role not found'});
 r.json({...role,permissions:parsePermissions(role.permissions)});
}));
app.post('/api/roles',adminMutationLimit,can('manage_users'),W(async(q:any,r:any)=>{
 if(q.u.role.name!=='SUPER_ADMIN'&&!q.perms.includes('manage_users'))return r.status(403).json({error:'Forbidden'});
 const name=typeof q.body.name==='string'?q.body.name.trim():'';
 const description=typeof q.body.description==='string'?q.body.description.trim().slice(0,500):'';
 if(name.length<2||name.length>100)return r.status(400).json({error:'Role name must be 2-100 characters'});
 const permissions=parsePermissions(q.body.permissions);
 if(!permissions.length)return r.status(400).json({error:'Select at least one valid permission'});
 if(name.toLowerCase()==='super_admin'&&!permissions.includes('manage_users'))return r.status(400).json({error:'Super Admin must retain management permission'});
 const existing=await db.role.findUnique({where:{name}});
 if(existing)return r.status(409).json({error:'Role name already exists'});
 try{
  const role=await db.role.create({data:{name,description,permissions:serializePermissions(permissions),isSystem:false}});
  await log(q,'role_create',name);
  r.status(201).json({...role,permissions:parsePermissions(role.permissions)});
 }catch(e:any){if(e?.code==='P2002')return r.status(409).json({error:'Role name already exists'});throw e;}
}));
app.put('/api/roles/:id',adminMutationLimit,can('manage_users'),W(async(q:any,r:any)=>{
 if(q.u.role.name!=='SUPER_ADMIN'&&!q.perms.includes('manage_users'))return r.status(403).json({error:'Forbidden'});
 const id=Number(q.params.id);if(!Number.isInteger(id))return r.status(400).json({error:'Invalid role'});
 const role=await db.role.findUnique({where:{id}});if(!role)return r.status(404).json({error:'Role not found'});
 const name=typeof q.body.name==='string'?q.body.name.trim():role.name;
 const description=typeof q.body.description==='string'?q.body.description.trim().slice(0,500):role.description;
 const permissions=parsePermissions(q.body.permissions===undefined?role.permissions:q.body.permissions);
 if(name.length<2||name.length>100)return r.status(400).json({error:'Role name must be 2-100 characters'});
 if(!permissions.length)return r.status(400).json({error:'Select at least one valid permission'});
 if(role.name==='SUPER_ADMIN') {
  const superPermissions=[...allowedPermissions];
  try{
   const updated=await db.role.update({where:{id},data:{name,description,permissions:serializePermissions(superPermissions)}});
   await log(q,'role_update',name);
   r.json({...updated,permissions:parsePermissions(updated.permissions)});
   return;
  }catch(e:any){if(e?.code==='P2002')return r.status(409).json({error:'Role name already exists'});throw e;}
 }
 try{
  const updated=await db.role.update({where:{id},data:{name,description,permissions:serializePermissions(permissions)}});
  await log(q,'role_update',name);
  r.json({...updated,permissions:parsePermissions(updated.permissions)});
 }catch(e:any){if(e?.code==='P2002')return r.status(409).json({error:'Role name already exists'});throw e;}
}));
app.delete('/api/roles/:id',adminMutationLimit,can('manage_users'),W(async(q:any,r:any)=>{
 if(q.u.role.name!=='SUPER_ADMIN'&&!q.perms.includes('manage_users'))return r.status(403).json({error:'Forbidden'});
 const id=Number(q.params.id);if(!Number.isInteger(id))return r.status(400).json({error:'Invalid role'});
 const role=await db.role.findUnique({where:{id},include:{users:true}});
 if(!role)return r.status(404).json({error:'Role not found'});
 if(role.isSystem||role.name==='SUPER_ADMIN'||role.name==='ADMIN'||role.name==='System Case Register Officer')return r.status(400).json({error:'System roles cannot be deleted'});
 if(role.users.length)return r.status(409).json({error:'Role is assigned to users; remove or reassign those users first'});
 await db.role.delete({where:{id}});
 await log(q,'role_delete',role.name);
 r.status(204).send();
}));
// --- backed customers
app.get('/api/backed',can('read'),W(async(q:any,r:any)=>{const s=String(q.query.q||''),requestNumber=String(q.query.requestNumber||'');
 r.json(await db.backedCustomer.findMany({where:{...scope(q),...(requestNumber?{requestNumber:{contains:requestNumber}}:{}),...(s?{OR:[{firstName:{contains:s}},{lastName:{contains:s}},{middleName:{contains:s}}]}:{})},include:{user:true,branch:true},orderBy:{id:'desc'},take:300}));}));
app.post('/api/backed',can('create_backed'),W(async(q:any,r:any)=>{const b=q.body;if(!b.firstName||!b.lastName||!(+b.age>0)||!b.reasons?.length)return r.status(400).json({error:'First/last name, age and reason required'});
 const s=stamp();const x=await db.backedCustomer.create({data:{firstName:b.firstName,middleName:b.middleName||'',lastName:b.lastName,age:+b.age,photo:b.photo||'',requestNumber:String(b.requestNumber||'').trim(),attachments:JSON.stringify(Array.isArray(b.attachments)?b.attachments:[]),reasons:b.reasons.join(', '),addrType:b.addrType,region:b.region,zone:b.zone||'',woreda:b.woreda||'',kebele:b.kebele||'',createdAtGC:s.atGC,createdAtEC:s.atEC,userId:q.u.id,branchId:q.u.branchId}});
 await log(q,'backed_create',String(x.id));r.json(x);}));
app.post('/api/backed/:id/request',can('create_backed'),W(async(q:any,r:any)=>{const id=+q.params.id,rec:any=await db.backedCustomer.findFirst({where:{id,...scope(q)}});if(!rec)return r.status(404).json({error:'Not found'});
 const edit=q.body.type==='EDIT';if(!edit&&q.body.type!=='CANCEL')return r.status(400).json({error:'Invalid request type'});
 const allowed=['firstName','middleName','lastName','age','requestNumber','reasons','photo','attachments','region','zone','woreda','kebele'];const ch:any={};
 if(edit){for(const k of allowed)if(q.body.changes?.[k]!==undefined)ch[k]=k==='age'?Number(q.body.changes[k]):q.body.changes[k];
  if(!Object.keys(ch).length)return r.status(400).json({error:'Select a field to edit'});
  if(ch.age!==undefined&&(!Number.isFinite(ch.age)||ch.age<=0))return r.status(400).json({error:'Age must be a positive number'});
  if((ch.firstName!==undefined&&!String(ch.firstName).trim())||(ch.lastName!==undefined&&!String(ch.lastName).trim()))return r.status(400).json({error:'First and last name cannot be empty'});
  if(ch.attachments!==undefined){if(!Array.isArray(ch.attachments))return r.status(400).json({error:'Documents must be an array'});ch.attachments=JSON.stringify(ch.attachments);}
  if(ch.region!==undefined)ch.addrType=['Addis Ababa Administration','Dire Dawa City Administration'].includes(ch.region)?'City':'Region';
 }
 const reason=String(q.body.reason||'').trim();if(!reason)return r.status(400).json({error:'Reason for request is required'});
 const before:any={};for(const k in ch)before[k]=rec[k];
 const request=await db.approvalRequest.create({data:{recordId:id,type:q.body.type,payload:JSON.stringify({before,changes:ch}),reason,requestedBy:q.u.id,branchId:rec.branchId}});
 await db.backedCustomer.update({where:{id},data:{status:edit?'PENDING_EDIT_APPROVAL':'PENDING_CANCEL_APPROVAL'}});await log(q,'request_'+q.body.type,'approval:'+request.id);r.json({ok:1});}));
// --- lost & found (officer identity always from session)
app.get('/api/lost',can('read'),W(async(q:any,r:any)=>{const s=String(q.query.q||'');await age();
 const rows=await db.lostItem.findMany({where:{...scope(q),...(s?{OR:[{itemNo:{contains:s}},{firstName:{contains:s}},{lastName:{contains:s}},{phone:{contains:s}}]}:{})},include:{user:true,branch:true},orderBy:{id:'desc'},take:300});
 r.json(q.u.role.name==='SUPER_ADMIN'?rows:rows.map((row:any)=>({...row,claimantPhoto:'',handoverPhoto:''})));}));
app.post('/api/lost',can('create_lost'),W(async(q:any,r:any)=>{const b=q.body;if(!b.firstName||!b.itemType||(b.itemType==='Other'&&!String(b.details||'').replace(/<[^>]*>/g,'').trim()))return r.status(400).json({error:'Name, item type (and details for Other) required'});
 const s=stamp();const x=await db.lostItem.create({data:{firstName:b.firstName,middleName:b.middleName||'',lastName:b.lastName||'',sex:b.sex||'Male',phone:b.phone||'',addrType:b.addrType,region:b.region,zone:b.zone||'',woreda:b.woreda||'',kebele:b.kebele||'',itemType:b.itemType,itemNo:b.itemNo||'',details:safeDetails(b.details),photo:b.photo||'',attachments:JSON.stringify(Array.isArray(b.attachments)?b.attachments:[]),registeredDateGC:s.atGC,registeredDateEC:s.atEC,userId:q.u.id,branchId:q.u.branchId}});
 await log(q,'lost_create',String(x.id));r.json(x);}));
app.post('/api/lost/:id/status/request',can('update'),W(async(q:any,r:any)=>{const id=+q.params.id,status=q.body.status,reason=String(q.body.reason||'').trim();
 if(!['TAKEN','NOT_TAKEN','OLD'].includes(status))return r.status(400).json({error:'Invalid status'});
 if(!reason)return r.status(400).json({error:'Specific change details are required'});
 const handoverPhoto=String(q.body.handoverPhoto||'');
 if(status==='TAKEN'&&!String(q.body.claimant||'').trim())return r.status(400).json({error:'Claimant name / ID is required'});
 if(status==='TAKEN'&&(!/^data:image\/(?:jpeg|png|webp);base64,/i.test(handoverPhoto)||handoverPhoto.length>8*1024*1024))return r.status(400).json({error:'A valid handover photo under 6 MB is required'});
 const rec=await db.lostItem.findFirst({where:{id,...scope(q)}});
 if(!rec)return r.status(404).json({error:'Not found'});
 if(status==='OLD'&&rec.createdAt>new Date(Date.now()-180*864e5))return r.status(400).json({error:'An item can be marked over 6 months old only after 180 days'});
 const pending=await db.approvalRequest.findFirst({where:{recordId:id,type:'LOST_STATUS',status:'PENDING'}});
 if(pending)return r.status(409).json({error:'A status change request is already awaiting SuperAdmin approval'});
 const capturedAt=status==='TAKEN'?new Date():null;
 const changes={status,claimant:status==='TAKEN'?String(q.body.claimant).trim():'',handoverPhoto:status==='TAKEN'?handoverPhoto:'',handoverCapturedAt:capturedAt?.toISOString()||''};
 const request=await db.approvalRequest.create({data:{recordId:id,type:'LOST_STATUS',payload:JSON.stringify({before:{status:rec.status,claimant:rec.claimant},changes}),reason,requestedBy:q.u.id,branchId:rec.branchId}});
 await log(q,'request_LOST_STATUS','approval:'+request.id);r.json({ok:1,requestedAt:request.createdAt});}));
// --- system case register
const CASE_STATUSES=['Open','In Progress','Resolved','Closed'];
const CASE_SEX=['Male','Female'];
const cleanText=(value:string)=>value.replace(/[\u0000-\u001F\u007F]/g,'').replace(/<[^>]*>/g,'').trim();
const caseSchema=z.object({
 fullName:z.string().trim().min(2).max(100),
 requestNumber:z.string().trim().min(3).max(100),
 sex:z.enum(['Male','Female']),
 region:z.string().trim().min(2).max(100),
 zone:z.string().trim().max(100).default(''),
 caseTypeId:z.coerce.number().int().positive(),
 subReason:z.string().trim().max(100).default(''),
 status:z.enum(['Open','In Progress','Resolved','Closed']).default('Open'),
 remarks:z.string().trim().max(5000).default('').transform(cleanText),
 documentName:z.string().trim().max(255).optional(),
 documentData:z.string().optional()
});
const uploadDir=path.resolve(process.env.UPLOAD_DIR||path.join(process.cwd(),'uploads'));
fs.mkdirSync(uploadDir,{recursive:true});
const saveCaseDocument=(name:string,data:string)=>{
 const m=/^data:(application\/pdf|image\/jpeg|image\/png);base64,(.+)$/s.exec(data||'');
 if(!m)throw new Error('Only PDF, JPG, and PNG files are allowed');
 const mime=m[1],buf=Buffer.from(m[2],'base64');
 if(buf.length<4||buf.length>5*1024*1024)throw new Error('Document must be 1 byte to 5 MB');
 const pdf=buf.subarray(0,4).toString('ascii')==='%PDF';
 const jpg=buf[0]===0xff&&buf[1]===0xd8&&buf[2]===0xff;
 const png=buf.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
 if((mime==='application/pdf'&&!pdf)||(mime==='image/jpeg'&&!jpg)||(mime==='image/png'&&!png))throw new Error('Uploaded file content does not match its declared type');
 const ext=mime==='application/pdf'?'.pdf':mime==='image/jpeg'?'.jpg':'.png';
 const filename=crypto.randomUUID()+ext;
 fs.writeFileSync(path.join(uploadDir,filename),buf,{flag:'wx',mode:0o600});
 return {filename,mime,name:cleanText(name||'document'+ext)};
};
const caseScope=(q:any)=>scope(q);
const caseAudit=async(q:any,caseId:number,action:string,before:any,after:any)=>{
 const s=stamp();
 await db.caseAudit.create({data:{caseId,userId:q.u.id,action,beforeJson:JSON.stringify(before||{}),afterJson:JSON.stringify(after||{}),ip:String(q.ip||''),atGC:s.atGC,atEC:s.atEC}});
};

app.get('/api/case-types',can('case.read'),W(async(q:any,r:any)=>{
 if(q.query.page===undefined&&q.query.pageSize===undefined&&q.query.search===undefined&&q.query.status===undefined){
  return r.json(await db.caseType.findMany({where:{active:true},orderBy:{name:'asc'}}));
 }
 const search=cleanText(String(q.query.search||''));
 const status=String(q.query.status||'all');
 const page=Math.max(1,Number(q.query.page)||1);
 const pageSize=Math.min(100,Math.max(1,Number(q.query.pageSize)||25));
 const where:any={
  ...(search?{OR:[{name:{contains:search}},{description:{contains:search}}]}:{}),
  ...(status==='active'?{active:true}:{}),
  ...(status==='inactive'?{active:false}:{})
 };
 const [rows,total]=await Promise.all([
  db.caseType.findMany({where,orderBy:{name:'asc'},skip:(page-1)*pageSize,take:pageSize,include:{_count:{select:{cases:true}}}}),
  db.caseType.count({where})
 ]);
 r.json({types:rows.map((x:any)=>({...x,usedCount:x._count.cases})),total,page,pageSize,pages:Math.max(1,Math.ceil(total/pageSize))});
}));
app.post('/api/case-types',can('manage_users'),W(async(q:any,r:any)=>{
 if(q.u.role.name!=='SUPER_ADMIN'&&q.u.role.name!=='ADMIN')return r.status(403).json({error:'Forbidden'});
 const name=cleanText(String(q.body?.name||''));
 const description=cleanText(String(q.body?.description||'')).slice(0,500);
 const pattern=String(q.body?.requestPattern||'^[A-Z0-9][A-Z0-9-]{2,49}$');
 if(name.length<2||name.length>150)return r.status(400).json({error:'Case type name must be 2-150 characters'});
 try{new RegExp(pattern)}catch{return r.status(400).json({error:'Invalid request number pattern'})}
 const existing=await db.caseType.findUnique({where:{name}});
 if(existing)return r.status(409).json({error:'Case type name already exists'});
 const type=await db.caseType.create({data:{name,description,requestPattern:pattern,active:q.body?.active!==false}});
 await log(q,'case_type_create',name);r.status(201).json(type);
}));
app.put('/api/case-types/:id',can('manage_users'),W(async(q:any,r:any)=>{
 if(q.u.role.name!=='SUPER_ADMIN'&&q.u.role.name!=='ADMIN')return r.status(403).json({error:'Forbidden'});
 const id=Number(q.params.id);if(!Number.isInteger(id))return r.status(400).json({error:'Invalid case type'});
 const current=await db.caseType.findUnique({where:{id}});
 if(!current)return r.status(404).json({error:'Case type not found'});
 const name=typeof q.body.name==='string'?cleanText(q.body.name):current.name;
 const description=typeof q.body.description==='string'?cleanText(q.body.description).slice(0,500):current.description;
 const pattern=typeof q.body.requestPattern==='string'?q.body.requestPattern:current.requestPattern;
 if(name.length<2||name.length>150)return r.status(400).json({error:'Case type name must be 2-150 characters'});
 try{new RegExp(pattern)}catch{return r.status(400).json({error:'Invalid request number pattern'})}
 try{
  const type=await db.caseType.update({where:{id},data:{name,description,requestPattern:pattern,active:q.body.active===undefined?current.active:!!q.body.active}});
  await log(q,'case_type_update',name);r.json(type);
 }catch(e:any){if(e?.code==='P2002')return r.status(409).json({error:'Case type name already exists'});throw e;}
}));
app.patch('/api/case-types/:id/status',can('manage_users'),W(async(q:any,r:any)=>{
 if(q.u.role.name!=='SUPER_ADMIN'&&q.u.role.name!=='ADMIN')return r.status(403).json({error:'Forbidden'});
 const id=Number(q.params.id);if(!Number.isInteger(id)||typeof q.body.active!=='boolean')return r.status(400).json({error:'Invalid case type status'});
 const type=await db.caseType.findUnique({where:{id}});
 if(!type)return r.status(404).json({error:'Case type not found'});
 const updated=await db.caseType.update({where:{id},data:{active:q.body.active}});
 await log(q,q.body.active?'case_type_activate':'case_type_deactivate',type.name);
 r.json(updated);
}));
app.delete('/api/case-types/:id',can('manage_users'),W(async(q:any,r:any)=>{
 if(q.u.role.name!=='SUPER_ADMIN'&&q.u.role.name!=='ADMIN')return r.status(403).json({error:'Forbidden'});
 const id=Number(q.params.id);if(!Number.isInteger(id))return r.status(400).json({error:'Invalid case type'});
 const type=await db.caseType.findUnique({where:{id},include:{_count:{select:{cases:true}}}});
 if(!type)return r.status(404).json({error:'Case type not found'});
 if(type._count.cases)return r.status(409).json({error:`Case type is used by ${type._count.cases} existing case(s) and cannot be deleted`});
 await db.caseType.delete({where:{id}});
 await log(q,'case_type_delete',type.name);
 r.status(204).send();
}));
app.get('/api/cases',can('case.read'),W(async(q:any,r:any)=>{
 const search=cleanText(String(q.query.q||'')),requestNumber=cleanText(String(q.query.requestNumber||''));
 const page=Math.max(1,+q.query.page||1),limit=Math.min(100,Math.max(10,+q.query.limit||25));
 const where:any={...caseScope(q),
  ...(search?{OR:[{fullName:{contains:search}},{remarks:{contains:search}}]}:{}),
  ...(requestNumber?{requestNumber:{contains:requestNumber}}:{}),
  ...(q.query.caseTypeId?{caseTypeId:+q.query.caseTypeId}:{}),
  ...(q.query.status?{status:String(q.query.status)}:{}),
  ...(q.query.sex?{sex:String(q.query.sex)}:{}),
  ...(q.query.region?{region:String(q.query.region)}:{}),
  ...(q.query.zone?{zone:String(q.query.zone)}:{})
 };
 const [total,rows]=await Promise.all([db.caseRegister.count({where}),db.caseRegister.findMany({where,include:{caseType:true,user:{select:{id:true,fullName:true}},branch:true},orderBy:{id:'desc'},skip:(page-1)*limit,take:limit})]);
 r.json({total,page,limit,pages:Math.max(1,Math.ceil(total/limit)),rows});
}));
app.post('/api/cases',can('case.create'),W(async(q:any,r:any)=>{
 const parsed=caseSchema.safeParse(q.body);if(!parsed.success)return r.status(400).json({error:parsed.error.issues[0]?.message||'Invalid case data'});
 const b=parsed.data,type=await db.caseType.findUnique({where:{id:b.caseTypeId}});
 if(!type||!type.active)return r.status(400).json({error:'Invalid or inactive case type'});
 if(!new RegExp(type.requestPattern).test(b.requestNumber))return r.status(400).json({error:'Request number format is invalid for this case type'});
 let doc:any={documentName:'',documentPath:'',documentMime:''};
 if(b.documentData){if(!q.perms.includes('case.upload'))return r.status(403).json({error:'Forbidden: case.upload'});const saved=saveCaseDocument(b.documentName||'',b.documentData);doc={documentName:saved.name,documentPath:saved.filename,documentMime:saved.mime};}
 const s=stamp();
 try{
  const {documentData:_documentData,documentName:_documentName,...core}=b;
  const created=await db.caseRegister.create({data:{...core,remarks:b.remarks,...doc,createdAtGC:s.atGC,createdAtEC:s.atEC,updatedAtGC:s.atGC,updatedAtEC:s.atEC,userId:q.u.id,branchId:q.u.branchId}});
  await caseAudit(q,created.id,'CREATE',{},created);await log(q,'case_create',String(created.id));r.status(201).json(created);
 }catch(e:any){if(e?.code==='P2002')return r.status(409).json({error:'Duplicate request number for this case type'});throw e;}
}));
app.get('/api/cases/:id',can('case.read'),W(async(q:any,r:any)=>{
 const id=+q.params.id,row=await db.caseRegister.findFirst({where:{id,...caseScope(q)},include:{caseType:true,user:{select:{id:true,fullName:true}},branch:true,audits:{include:{user:{select:{id:true,fullName:true}}},orderBy:{id:'desc'}}}});
 if(!row)return r.status(404).json({error:'Case not found'});
 r.json(row);
}));
app.post('/api/cases/:id/request',can('case.update'),W(async(q:any,r:any)=>{
 const id=+q.params.id,row=await db.caseRegister.findFirst({where:{id,...caseScope(q)}});
 if(!row)return r.status(404).json({error:'Case not found'});
 const type=q.body?.type;
 const reason=cleanText(String(q.body?.reason||''));if(!reason)return r.status(400).json({error:'Reason is required'});
 if(type==='CANCEL'){
  const request=await db.approvalRequest.create({data:{recordId:id,type:'CASE_CANCEL',payload:JSON.stringify({before:row,changes:{status:'Cancelled'}}),reason,requestedBy:q.u.id,branchId:row.branchId}});
  await log(q,'request_CASE_CANCEL','approval:'+request.id);return r.json({ok:true,approvalId:request.id});
 }
 if(type!=='EDIT')return r.status(400).json({error:'Invalid request type'});
 const parsed=caseSchema.partial().safeParse(q.body?.changes);if(!parsed.success)return r.status(400).json({error:'Invalid edit values'});
 const changes:any={};for(const [key,value] of Object.entries(parsed.data)){if(JSON.stringify((row as any)[key])!==JSON.stringify(value))changes[key]=value;}
 if(!Object.keys(changes).length)return r.status(400).json({error:'No changes supplied'});
 if(changes.caseTypeId||changes.requestNumber){
  const targetType=await db.caseType.findUnique({where:{id:changes.caseTypeId||row.caseTypeId}});
  const targetNumber=changes.requestNumber||row.requestNumber;
  if(!targetType||!new RegExp(targetType.requestPattern).test(targetNumber))return r.status(400).json({error:'Request number format is invalid for this case type'});
  if(await db.caseRegister.findFirst({where:{caseTypeId:targetType.id,requestNumber:targetNumber,id:{not:id}}}))return r.status(409).json({error:'Duplicate request number for this case type'});
 }
 if(changes.documentData){if(!q.perms.includes('case.upload'))return r.status(403).json({error:'Forbidden: case.upload'});const saved=saveCaseDocument(changes.documentName||row.documentName,changes.documentData);changes.documentName=saved.name;changes.documentPath=saved.filename;changes.documentMime=saved.mime;delete changes.documentData;}
 const before:any={};for(const key of Object.keys(changes))before[key]=(row as any)[key];
 const request=await db.approvalRequest.create({data:{recordId:id,type:'CASE_EDIT',payload:JSON.stringify({before,changes}),reason,requestedBy:q.u.id,branchId:row.branchId}});
 await log(q,'request_CASE_EDIT','approval:'+request.id);r.json({ok:true,approvalId:request.id});
}));
app.get('/api/cases/:id/document',can('case.read'),W(async(q:any,r:any)=>{
 const row=await db.caseRegister.findFirst({where:{id:+q.params.id,...caseScope(q)}});
 if(!row||!row.documentPath)return r.status(404).json({error:'Document not found'});
 const full=path.resolve(uploadDir,row.documentPath);if(path.dirname(full)!==uploadDir)return r.status(404).json({error:'Document not found'});
 if(!fs.existsSync(full))return r.status(404).json({error:'Document not found'});
 r.setHeader('Content-Type',row.documentMime||'application/octet-stream');r.setHeader('Content-Disposition','inline; filename="'+row.documentName.replace(/["\r\n]/g,'')+'"');r.setHeader('Cache-Control','private, no-store');fs.createReadStream(full).pipe(r);
}));
// Case report and export
app.get('/api/case-report',can('case.report'),W(async(q:any,r:any)=>{
 const period=String(q.query.period||'monthly'),daily={daily:1,weekly:7,monthly:30,annual:365}[period as 'daily']||30;
 const from=q.query.from?new Date(String(q.query.from)+'T00:00:00'):new Date(Date.now()-daily*864e5);
 const to=q.query.to?new Date(String(q.query.to)+'T23:59:59'):new Date();
 if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||from>to)return r.status(400).json({error:'Invalid report date range'});
 const where:any={...caseScope(q),createdAt:{gte:from,lte:to}};
 if(q.query.caseTypeId)where.caseTypeId=+q.query.caseTypeId;
 if(q.query.sex)where.sex=String(q.query.sex);
 if(q.query.region)where.region=String(q.query.region);
 if(q.query.zone)where.zone=String(q.query.zone);
 if(q.query.status)where.status=String(q.query.status);
 if(q.query.requestNumber)where.requestNumber={contains:String(q.query.requestNumber)};
 const rows=await db.caseRegister.findMany({where,include:{caseType:true,user:true,branch:true},orderBy:{createdAt:'desc'}});
 const detail=rows.map(x=>({'Full Name':x.fullName,'Request Number':x.requestNumber,Sex:x.sex,Region:x.region,Zone:x.zone,'Case Type':x.caseType.name,Status:x.status,'Date G.C.':x.createdAtGC,'Date E.C.':x.createdAtEC}));
 const group=String(q.query.groupBy||'caseType');
 const keyMap:any={caseType:'Case Type',sex:'Sex',region:'Region',zone:'Zone',status:'Status',requestNumber:'Request Number'};
 const key=keyMap[group]||'Case Type';
 const counts=new Map<string,number>();detail.forEach(x=>{const k=String((x as any)[key]||'-');counts.set(k,(counts.get(k)||0)+1)});
 const summary=[...counts.entries()].sort((a,b)=>b[1]-a[1]).map(([name,count])=>[name,count,detail.length?+(count/detail.length*100).toFixed(2):0]);
 const gen=stamp(),title='Immigration and Citizenship Service - Case Register Report';
 const format=String(q.query.format||'json');
 await log(q,'case_report_'+format,`${rows.length} rows`);
 if(format==='xlsx'){
  const safe=(v:any)=>{const s=String(v??'');return /^[=+\-@\t\r]/.test(s)?`'${s}`:s};
  const wb=new ExcelJS.Workbook();
  const summarySheet=wb.addWorksheet('Summary');
  summarySheet.addRows([[title],[ 'Branch',q.u.branch.name],[ 'Generated',gen.atGC+' G.C. | '+gen.atEC+' E.C.'],['Generated by',q.u.fullName],['Date range',from.toISOString()+' to '+to.toISOString()],[],[key,'Count','Percentage'],...summary.map(x=>x.map(safe))]);
  const detailSheet=wb.addWorksheet('Case Detail');
  const cols=Object.keys(detail[0]||{});
  detailSheet.addRow(cols);
  detail.map(x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,safe(v)]))).forEach(x=>detailSheet.addRow(cols.map(c=>x[c]??'')));
  r.setHeader('Content-Disposition','attachment; filename=case-register-report.xlsx');r.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return r.send(await wb.xlsx.writeBuffer());
 }
 if(format==='docx'){
  const cell=(s:any)=>new TableCell({children:[new Paragraph(String(s))]}),table=(headers:string[],data:any[][])=>new Table({rows:[new TableRow({children:headers.map(cell)}),...data.map(row=>new TableRow({children:row.map(cell)}))]});
  const cols=Object.keys(detail[0]||{'Full Name':'','Request Number':'',Sex:'',Region:'',Zone:'','Case Type':'',Status:'','Date G.C.':''});
  const doc=new Document({sections:[{children:[new Paragraph({text:'Immigration and Citizenship Service',heading:HeadingLevel.TITLE}),new Paragraph({text:title,heading:HeadingLevel.HEADING_1}),new Paragraph(`Branch: ${q.u.branch.name}`),new Paragraph(`Generated by: ${q.u.fullName}`),new Paragraph(`Date range: ${from.toISOString()} to ${to.toISOString()} | Generated: ${gen.atGC} G.C. | ${gen.atEC} E.C.`),new Paragraph({text:'Summary',heading:HeadingLevel.HEADING_2}),table([key,'Count','Percentage'],summary.map(x=>[x[0],String(x[1]),x[2]+'%'])),new Paragraph({text:'Detailed List',heading:HeadingLevel.HEADING_2}),table(cols,detail.map(x=>cols.map(c=>(x as any)[c])))]}]});
  r.setHeader('Content-Disposition','attachment; filename=case-register-report.docx');return r.send(await Packer.toBuffer(doc));
 }
 if(format==='pdf'){
  const d=new jsPDF({orientation:'landscape'});d.setFillColor(15,41,66);d.rect(0,0,300,24,'F');d.setTextColor(255);d.setFontSize(13);d.text(title,10,14);d.setTextColor(0);d.setFontSize(9);d.text(`Branch: ${q.u.branch.name} | Generated by: ${q.u.fullName}`,10,31);d.text(`Date range: ${from.toISOString()} to ${to.toISOString()}`,10,37);
  d.autoTable({startY:42,head:[[key,'Count','Percentage']],body:summary.map(x=>[x[0],String(x[1]),x[2]+'%']),headStyles:{fillColor:[15,41,66]}});
  d.autoTable({head:[Object.keys(detail[0]||{})],body:detail.map(x=>Object.keys(detail[0]||{}).map(c=>String((x as any)[c]??''))),styles:{fontSize:6},headStyles:{fillColor:[15,41,66]}});
  r.setHeader('Content-Disposition','attachment; filename=case-register-report.pdf');return r.send(Buffer.from(d.output('arraybuffer')));
 }
 r.json({title,branch:q.u.branch.name,generated:gen,total:detail.length,summary:summary.map(([name,count,percentage])=>({name,count,percentage})),rows:detail});
}));
// --- approvals (EDIT: approve_edit; CANCEL: Admin co-approves, Super Admin gives final approval)
app.get('/api/approvals',W(async(q:any,r:any)=>{if(!q.perms.includes('approve_edit')&&!q.perms.includes('approve_cancel')&&!q.perms.includes('case.update')&&!q.perms.includes('manage_users'))return r.status(403).json({error:'Forbidden'});
 const where:any=wide(q.u)?{}:{branchId:q.u.branchId};if(q.u.role.name!=='SUPER_ADMIN')where.type={in:['EDIT','CANCEL','LOST_STATUS','CASE_EDIT','CASE_CANCEL','USER_CHANGE','USER_DELETE','PASSWORD_CHANGE','PASSWORD_RESET']};
 r.json(await db.approvalRequest.findMany({where,orderBy:{id:'desc'}}));}));
app.post('/api/approvals/:id/decide',W(async(q:any,r:any)=>{const a=await db.approvalRequest.findUnique({where:{id:+q.params.id}});if(!a||!['PENDING','ADMIN_APPROVED'].includes(a.status))return r.status(400).json({error:'Not pending'});
 if(!wide(q.u)&&a.branchId!==q.u.branchId)return r.status(404).json({error:'Request not found'});
 const sup=q.u.role.name==='SUPER_ADMIN';
 if(a.type==='LOST_STATUS'){if(!sup)return r.status(403).json({error:'SuperAdmin approval required'});}
 else if(a.type==='CASE_EDIT'||a.type==='CASE_CANCEL'){if(!q.perms.includes('case.update'))return r.status(403).json({error:'Forbidden'});}
 else if(['USER_CHANGE','USER_DELETE','PASSWORD_CHANGE','PASSWORD_RESET'].includes(a.type)){if(!q.perms.includes('manage_users')&&q.u.role.name!=='SUPER_ADMIN')return r.status(403).json({error:'Forbidden'});}
 else{const need=a.type==='EDIT'?'approve_edit':a.type==='CANCEL'?'approve_cancel':null;if(!need)return r.status(400).json({error:'Invalid request type'});if(!q.perms.includes(need))return r.status(403).json({error:'Forbidden'});}
 if(!['approve','reject'].includes(q.body.decision))return r.status(400).json({error:'Invalid decision'});
 const payload=parseJsonObject(a.payload),changes=parseJsonObject(payload.changes,{});
 const ok=q.body.decision==='approve';
 if(ok&&a.type==='LOST_STATUS'&&changes.status==='TAKEN'&&(!q.body.ownershipConfirmed||!changes.handoverPhoto))return r.status(400).json({error:'Verify the claimant photo and confirm ownership before approving collection'});
 const now=new Date(),s=stamp(now);let st=ok?'APPROVED':'REJECTED';
 if(['USER_CHANGE','USER_DELETE','PASSWORD_CHANGE','PASSWORD_RESET'].includes(a.type)&&ok&&q.u.role.name==='ADMIN')st='ADMIN_APPROVED';
 if(['USER_CHANGE','USER_DELETE','PASSWORD_CHANGE','PASSWORD_RESET'].includes(a.type)&&!ok)st='REJECTED';
 if(a.type==='CANCEL'&&ok){
  if(sup&&a.status==='PENDING')return r.status(409).json({error:'The Admin approval step must complete before final approval'});
  if(!sup&&a.status==='PENDING')st='ADMIN_APPROVED';
  if(!sup&&a.status==='ADMIN_APPROVED')return r.status(409).json({error:'Final approval is restricted to Super Admin'});
 }
 if(st==='APPROVED'){
  if(a.type==='USER_CHANGE'){
   await db.user.update({where:{id:a.recordId},data:{...changes,passwordVersion:{increment:1}}});
   await db.refreshSession.updateMany({where:{userId:a.recordId,revokedAt:null},data:{revokedAt:new Date()}});
   await log(q,'user_change_approved',String(a.recordId));
  }
  else if(a.type==='USER_DELETE'){
   await db.refreshSession.updateMany({where:{userId:a.recordId,revokedAt:null},data:{revokedAt:new Date()}});
    await db.user.update({where:{id:a.recordId},data:{suspended:true,deletedAt:new Date(),failedAttempts:0,lockedUntil:null}});
   await log(q,'user_delete_approved',String(a.recordId));
  }
  else if(a.type==='PASSWORD_CHANGE'||a.type==='PASSWORD_RESET'){
   const passwordHash=a.type==='PASSWORD_CHANGE'?payload.newPasswordHash:bcrypt.hashSync(crypto.randomBytes(12).toString('base64url')+'A1!',12);
   await db.user.update({where:{id:a.recordId},data:{password:passwordHash,passwordVersion:{increment:1},passwordUpdatedAt:new Date(),passwordMustChange:a.type==='PASSWORD_RESET',failedAttempts:0,lockedUntil:null}});
   await db.refreshSession.updateMany({where:{userId:a.recordId,revokedAt:null},data:{revokedAt:new Date()}});
   await log(q,a.type==='PASSWORD_RESET'?'password_reset_approved':'password_change_approved',String(a.recordId));
  }
  else if(a.type==='CASE_EDIT'){
   const beforeCase=await db.caseRegister.findUnique({where:{id:a.recordId}});
   if(!beforeCase)return r.status(404).json({error:'Case not found'});
   const s=stamp(),updated=await db.caseRegister.update({where:{id:a.recordId},data:{...changes,updatedAtGC:s.atGC,updatedAtEC:s.atEC}});
   await caseAudit(q,a.recordId,'UPDATE',payload.before,updated);await log(q,'case_update',String(a.recordId));
  }
  else if(a.type==='CASE_CANCEL'){
   const beforeCase=await db.caseRegister.findUnique({where:{id:a.recordId}});
   if(!beforeCase)return r.status(404).json({error:'Case not found'});
   const s=stamp(),closed=await db.caseRegister.update({where:{id:a.recordId},data:{status:'Closed',remarks:`[Approved cancellation] ${beforeCase.remarks}`.slice(0,5000),updatedAtGC:s.atGC,updatedAtEC:s.atEC}});
   await caseAudit(q,a.recordId,'DELETE',beforeCase,closed);
   await log(q,'case_delete',String(a.recordId));
  }
  else if(a.type==='EDIT')await db.backedCustomer.update({where:{id:a.recordId},data:{...changes,status:'EDIT_APPROVED'}});
  else if(a.type==='CANCEL')await db.backedCustomer.update({where:{id:a.recordId},data:{status:'CANCELLED'}});
  else if(a.type==='LOST_STATUS'){const collected=changes.status==='TAKEN',capturedAt=collected?new Date(changes.handoverCapturedAt):null;if(collected&&(!capturedAt||Number.isNaN(capturedAt.getTime())))return r.status(400).json({error:'Invalid handover capture time'});
   const result=await db.lostItem.updateMany({where:{id:a.recordId},data:{status:changes.status,claimant:changes.claimant,takenAtGC:collected?s.atGC:'',takenAtEC:collected?s.atEC:'',handoverPhoto:collected?changes.handoverPhoto:'',handoverCapturedAt:capturedAt,collectedAt:collected?now:null,ownershipConfirmedBy:collected?q.u.fullName:'',ownershipConfirmedAt:collected?now:null}});
   if(!result.count)return r.status(404).json({error:'Lost item not found'});}
 }
 await db.approvalRequest.update({where:{id:a.id},data:{status:st,approvedBy:q.u.fullName,approvalAtGC:s.atGC}});
 if(st==='REJECTED'&&(a.type==='EDIT'||a.type==='CANCEL'))await db.backedCustomer.update({where:{id:a.recordId},data:{status:'SUBMITTED'}});
 await log(q,'decision_'+st,'approval:'+a.id);r.json({status:st});}));
app.get('/api/audit',W(async(q:any,r:any)=>{if(q.u.role.name!=='SUPER_ADMIN'&&!q.perms.includes('manage_users')&&!q.perms.includes('approve_edit'))return r.status(403).json({error:'Forbidden'});
 const paged=q.query.page!==undefined||q.query.pageSize!==undefined||q.query.search!==undefined||q.query.action!==undefined||q.query.module!==undefined;
 const logsAll=await db.auditLog.findMany({orderBy:{id:'desc'},take:paged?5000:300});
 let logs:any[]=logsAll as any[];
 if(paged){
  const search=String(q.query.search||'').trim().toLowerCase();
  const action=String(q.query.action||'all');
  const module=String(q.query.module||'all');
  const userId=q.query.userId?Number(q.query.userId):null;
  const from=String(q.query.from||'');
  const to=String(q.query.to||'');
  const userIds=[...new Set(logs.map((x:any)=>x.userId))];
  const usersForFilter=userIds.length?await db.user.findMany({where:{id:{in:userIds}},include:{role:true,branch:true}}):[];
  const enrichedFilter=new Map(usersForFilter.map((u:any)=>[u.id,u]));
  const actionCategory=(value:string)=>{
   if(/login|logout/.test(value))return 'login';
   if(/create|request_|_create/.test(value))return 'create';
   if(/delete|cancel/.test(value))return 'delete';
   if(/approve|decision/.test(value))return 'approve';
   if(/update|change|activate|deactivate/.test(value))return 'update';
   if(/export|report/.test(value))return 'export';
   return 'update';
  };
  const moduleOf=(value:string)=>{
   if(/backed/.test(value))return 'Backed Customers';
   if(/lost/.test(value))return 'Lost & Found';
   if(/case/.test(value))return 'Case Register';
   if(/role/.test(value))return 'Roles';
   if(/user/.test(value))return 'Users';
   if(/login|logout/.test(value))return 'Authentication';
   return 'System';
  };
  logs=logs.filter((x:any)=>{
   const u=enrichedFilter.get(x.userId);
   const category=actionCategory(x.action);
   const searchable=[x.action,x.detail,x.ip,u?.fullName,u?.username,u?.role?.name,u?.branch?.name].join(' ').toLowerCase();
   return (!search||searchable.includes(search))
    &&(!userId||x.userId===userId)
    &&(action==='all'||category===action)
    &&(module==='all'||moduleOf(x.action)===module)
    &&(!from||String(x.atGC).slice(0,10)>=from)
    &&(!to||String(x.atGC).slice(0,10)<=to);
  });
  const page=Math.max(1,Number(q.query.page)||1);
  const pageSize=Math.min(100,Math.max(1,Number(q.query.pageSize)||25));
  const total=logs.length;
  logs=logs.slice((page-1)*pageSize,page*pageSize);
  const resultLogs=logs;
  const userIds2=[...new Set(resultLogs.map((x:any)=>x.userId))];
  const approvalIds=[...new Set(resultLogs.map((x:any)=>{const m=String(x.detail).match(/^approval:(\d+)$/);return m?+m[1]:null}).filter((x:any)=>x!==null))];
  const [users,requests]=await Promise.all([
   userIds2.length?db.user.findMany({where:{id:{in:userIds2}},select:{id:true,fullName:true,username:true,role:{select:{name:true}},branch:{select:{name:true}}}}):[],
   approvalIds.length?db.approvalRequest.findMany({where:{id:{in:approvalIds}}}):[]
  ]);
  const userById=new Map((users as any[]).map((u:any)=>[u.id,{fullName:u.fullName,username:u.username,role:u.role.name,branch:u.branch.name}]));
  const requestById=new Map((requests as any[]).map((a:any)=>[a.id,{id:a.id,type:a.type,recordId:a.recordId,reason:a.reason,status:a.status,payload:parseJsonObject(a.payload)}]));
  return r.json({logs:resultLogs.map((x:any)=>{const m=String(x.detail).match(/^approval:(\d+)$/);const approvalId=m?+m[1]:null;const approval=approvalId?requestById.get(approvalId)||null:null;return {...x,user:userById.get(x.userId)||null,approval}}),total,page,pageSize,pages:Math.max(1,Math.ceil(total/pageSize))});
 }
 logs=logsAll as any[];
 const userIds=[...new Set(logs.map((x:any)=>x.userId))],approvalIds=[...new Set(logs.map((x:any)=>{const m=String(x.detail).match(/^approval:(\d+)$/);return m?+m[1]:x.action.startsWith('decision_')&&/^\d+$/.test(String(x.detail))?+x.detail:null}).filter((x:any)=>x!==null))];
 const [users,requests]=await Promise.all([
  userIds.length?db.user.findMany({where:{id:{in:userIds}},select:{id:true,fullName:true,username:true,role:{select:{name:true}},branch:{select:{name:true}}}}):[],
  approvalIds.length?db.approvalRequest.findMany({where:{id:{in:approvalIds}}}):[]
 ]);
 const userById=new Map((users as any[]).map((u:any)=>[u.id,{fullName:u.fullName,username:u.username,role:u.role.name,branch:u.branch.name}]));
 const requestById=new Map((requests as any[]).map((a:any)=>[a.id,{id:a.id,type:a.type,recordId:a.recordId,reason:a.reason,status:a.status,payload:parseJsonObject(a.payload)}]));
 r.json(logs.map((x:any)=>{const m=String(x.detail).match(/^approval:(\d+)$/),approvalId=m?+m[1]:x.action.startsWith('decision_')&&/^\d+$/.test(String(x.detail))?+x.detail:null;
  const approval=approvalId?requestById.get(approvalId)||null:null;
  if(q.u.role.name!=='SUPER_ADMIN'&&approval?.payload?.changes?.handoverPhoto)approval.payload.changes.handoverPhoto='[Restricted]';
  return {...x,user:userById.get(x.userId)||null,approval};
 }));
}));
// --- reports + exports
app.get('/api/report',can('export'),W(async(q:any,r:any)=>{const {mod='backed',period='monthly',from,to,groupBy='branch',format='json'}=q.query as any;
 const D:any={daily:1,weekly:7,biweekly:14,monthly:30,quarterly:91,semiannual:182,annual:365};
 const f=from?new Date(from):new Date(Date.now()-(D[period]||30)*864e5),t=to?new Date(to+'T23:59:59'):new Date();
 const own=q.u.role.name==='LF_OFFICER'?{userId:q.u.id}:{};const w={createdAt:{gte:f,lte:t},...scope(q),...own};
 const rows:any[]=mod==='lost'?(await db.lostItem.findMany({where:w,include:{user:true,branch:true}})).map(x=>({ID:x.id,Name:`${x.firstName} ${x.middleName} ${x.lastName}`,Type:x.itemType,'Item No':x.itemNo,Status:x.status,Claimant:x.claimant,'Collected At (UTC)':x.collectedAt?.toISOString()||'','Collection Date G.C.':x.takenAtGC,'Collection Date E.C.':x.takenAtEC,Region:x.region,Zone:x.zone,Woreda:x.woreda,Kebele:x.kebele,Branch:x.branch.name,Officer:x.user.fullName,'Date G.C.':x.registeredDateGC,'Date E.C.':x.registeredDateEC}))
 :(await db.backedCustomer.findMany({where:w,include:{user:true,branch:true}})).map(x=>({ID:x.id,Name:`${x.firstName} ${x.middleName} ${x.lastName}`,Age:x.age,Reason:x.reasons,Status:x.status,Region:x.region,Zone:x.zone,Woreda:x.woreda,Kebele:x.kebele,Branch:x.branch.name,Officer:x.user.fullName,'Date G.C.':x.createdAtGC,'Date E.C.':x.createdAtEC}));
 const key:any={reason:'Reason',type:'Type',region:'Region',zone:'Zone',woreda:'Woreda',kebele:'Kebele',branch:'Branch',officer:'Officer',status:'Status'}[groupBy]||'Branch';
 const g:any={};rows.forEach(x=>{const k=x[key]||'-';g[k]=(g[k]||0)+1});const sum=Object.entries(g).sort((a:any,b:any)=>b[1]-a[1]);
 const title=`ICS ${mod==='lost'?'Lost & Found':'Backed Customers'} Report`,gen=stamp().atGC+' G.C. | '+stamp().atEC+' E.C.';
 await log(q,'report_'+format,mod);
 if(format==='xlsx'){const safe=(v:any)=>{const s=String(v??'');return /^[=+\-@\t\r]/.test(s)?`'${s}`:s};const wb=new ExcelJS.Workbook();const summarySheet=wb.addWorksheet('Summary');summarySheet.addRows([[title],['Generated',gen],[],[key,'Count'],...sum.map(x=>x.map(safe))]);const detailSheet=wb.addWorksheet('Raw Data');const cols=Object.keys(rows[0]||{ID:1});detailSheet.addRow(cols);rows.forEach(x=>detailSheet.addRow(cols.map(c=>safe(x[c]))));
  r.setHeader('Content-Disposition','attachment; filename=report.xlsx');r.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return r.send(await wb.xlsx.writeBuffer());}
 if(format==='docx'){const cell=(s:any)=>new TableCell({children:[new Paragraph(String(s))]});const tb=(h:string[],d:any[][])=>new Table({rows:[new TableRow({children:h.map(cell)}),...d.map(x=>new TableRow({children:x.map(cell)}))]});
  const cols=Object.keys(rows[0]||{ID:1});const doc=new Document({sections:[{children:[new Paragraph({text:'Immigration and Citizenship Service',heading:HeadingLevel.TITLE}),new Paragraph({text:title,heading:HeadingLevel.HEADING_1}),new Paragraph('Generated: '+gen+' | Total: '+rows.length),new Paragraph({text:'Summary by '+key,heading:HeadingLevel.HEADING_2}),tb([key,'Count'],sum as any),new Paragraph({text:'Records',heading:HeadingLevel.HEADING_2}),tb(cols,rows.map(x=>cols.map(c=>x[c]))),new Paragraph(''),new Paragraph('Prepared By: ____________    Approved By: ____________')]}]});
  r.setHeader('Content-Disposition','attachment; filename=report.docx');return r.send(await Packer.toBuffer(doc));}
 if(format==='pdf'){const d=new jsPDF({orientation:'landscape'});d.setFillColor(15,41,66);d.rect(0,0,300,22,'F');d.setTextColor(255);d.setFontSize(14);d.text('Immigration and Citizenship Service (ICS) - '+title,10,14);d.setTextColor(0);d.setFontSize(9);d.text('Generated: '+gen+'   Total records: '+rows.length,10,30);
  d.autoTable({startY:34,head:[[key,'Count']],body:sum.map(x=>[x[0],String(x[1])]),headStyles:{fillColor:[15,41,66]}});const cols=Object.keys(rows[0]||{ID:1});
  d.autoTable({head:[cols],body:rows.map(x=>cols.map(c=>String(x[c]))),styles:{fontSize:6},headStyles:{fillColor:[15,41,66]}});d.setFontSize(9);d.text('Prepared By: ____________        Approved By: ____________',10,d.internal.pageSize.height-10);
  r.setHeader('Content-Disposition','attachment; filename=report.pdf');return r.send(Buffer.from(d.output('arraybuffer')));}
 r.json({title,generated:gen,total:rows.length,groupBy:key,summary:sum,rows});}));
const port=Number(process.env.PORT)||4000;
app.listen(port,'0.0.0.0',()=>console.log(`ICS API on :${port}`));
