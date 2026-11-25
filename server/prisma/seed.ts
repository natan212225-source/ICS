import { PrismaClient } from '@prisma/client'; import bcrypt from 'bcryptjs';
import { serializePermissions } from '../src/permissions';
const db=new PrismaClient();
const bootstrapPassword=process.env.BOOTSTRAP_ADMIN_PASSWORD;
if(!bootstrapPassword)throw new Error('BOOTSTRAP_ADMIN_PASSWORD is required for administrator bootstrap');
if(bootstrapPassword.length<14)throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain at least 14 characters');
const R:Record<string, string[]>={
SUPER_ADMIN:['create_backed','create_lost','read','update','approve_edit','approve_cancel','export','manage_users','case.create','case.read','case.update','case.report','case.upload'],
ADMIN:['read','update','approve_edit','approve_cancel','export','case.create','case.read','case.update','case.report','case.upload'],
VERIFIER:['create_backed','read','export'],
LF_OFFICER:['create_lost','read','update','export'],
'System Case Register Officer':['case.create','case.read','case.update','case.report','case.upload']
};
const hq=await db.branch.upsert({where:{code:'HQ'},update:{},create:{name:'Head Office',code:'HQ',region:'Addis Ababa',isHead:true}});
await db.branch.upsert({where:{code:'AA01'},update:{},create:{name:'Addis Ababa Branch 1',code:'AA01',region:'Addis Ababa'}});
for(const n in R)await db.role.upsert({
 where:{name:n},
 update:{permissions:serializePermissions(R[n]),description:n==='SUPER_ADMIN'?'System administrator with complete access':n==='ADMIN'?'Administrator with approval and management access':n==='System Case Register Officer'?'Creates and manages case register records':'System role',isSystem:true},
 create:{name:n,description:n==='SUPER_ADMIN'?'System administrator with complete access':n==='ADMIN'?'Administrator with approval and management access':n==='System Case Register Officer'?'Creates and manages case register records':'System role',permissions:serializePermissions(R[n]),isSystem:true}
});
const sa=await db.role.findUnique({where:{name:'SUPER_ADMIN'}});
await db.user.upsert({where:{username:'admin'},update:{password:bcrypt.hashSync(bootstrapPassword,12),failedAttempts:0,lockedUntil:null},create:{username:'admin',fullName:'Super Admin',password:bcrypt.hashSync(bootstrapPassword,12),roleId:sa!.id,branchId:hq.id}});
const CASE_TYPES=[
 'Perso stuck','Document ordered stuck','Existence of key value','Perso fail','Approved files with their hitlist (after approval)',
 'Watchlist adjudication','Legacy data adjudication (customer had a passport before and applies as new ordinary)',
 'Watchlist adjudication where application is needed physically at Gotera',
 'Merge cases related to biometrics (authorization when officers lose the customer\'s file)',
 'Applicants who took their own file due to misunderstanding','Application type change (fraudulent, e-pass 2)','Data sync issue','Upload documents (when required)'
];
for(const name of CASE_TYPES) await db.caseType.upsert({where:{name},update:{active:true},create:{name,description:''}});
console.log('Seeded the configured bootstrap administrator.');
await db.$disconnect();
