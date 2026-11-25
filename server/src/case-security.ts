export const hasPermission=(permissions:string[],required:string)=>permissions.includes(required);

export const caseBranchScope=(user:any)=>user.role?.name==='SUPER_ADMIN'||user.branch?.isHead?{}:{branchId:user.branchId};

export const duplicateCaseKey=(caseTypeId:number,requestNumber:string)=>`${caseTypeId}:${requestNumber.trim().toUpperCase()}`;

export const sanitizeCaseText=(value:string)=>value.replace(/[\u0000-\u001F\u007F]/g,'').replace(/<[^>]*>/g,'').trim();

export const safeSpreadsheetText=(value:any)=>{
 const text=String(value??'');
 return /^[=+\-@\t\r]/.test(text)?`'${text}`:text;
};

export const documentMagicMatches=(mime:string,bytes:Buffer)=>{
 if(bytes.length<4)return false;
 if(mime==='application/pdf')return bytes.subarray(0,4).toString('ascii')==='%PDF';
 if(mime==='image/jpeg')return bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
 return false;
};
