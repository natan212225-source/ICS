let accessToken='';
let refreshPromise:Promise<string>|null=null;

const configuredApiUrl=(import.meta.env.VITE_API_URL||'https://ics-fullstack-r9pn.onrender.com').trim().replace(/\/+$/,'');
export const apiUrl=(path:string)=>`${configuredApiUrl}/api${path}`;

export const getToken=()=>accessToken;
export const setToken=(token:string)=>{accessToken=token};
export const clearToken=()=>{accessToken=''};

export async function api(path:string,options:any={}) {
 const request=async()=>{
  return fetch(apiUrl(path),{
   method:options.method||'GET',credentials:'include',
   headers:{'Content-Type':'application/json','X-ICS-CSRF':'1',...(accessToken?{Authorization:'Bearer '+accessToken}:{})},
   body:options.body&&JSON.stringify(options.body)
  });
 };
 let response:Response|undefined;
 try{
  response=await request();
 }catch{
  let lastError:any;
  for(let attempt=0;attempt<(!['POST','PUT','PATCH','DELETE'].includes(options.method||'GET')?2:0);attempt++){
   await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
   try{response=await request();break}catch(error){lastError=error}
  }
  if(!response)throw new Error(lastError?.message||'Network connection failed');
 }
 if(response.status===401&&!path.startsWith('/login')&&!path.startsWith('/refresh')&&!path.startsWith('/logout')){
  if(!refreshPromise){
   refreshPromise=(async()=>{
    const refresh=await fetch(apiUrl('/refresh'),{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-ICS-CSRF':'1'}});
    if(!refresh.ok)throw new Error('Session expired');
    const data=await refresh.json().catch(()=>({}));
    if(!data.token)throw new Error('Session expired');
    setToken(data.token);
    return data.token;
   })().finally(()=>{refreshPromise=null});
  }
  try{await refreshPromise;response=await request()}catch{clearToken()}
 }
 if(!['POST','PUT','PATCH','DELETE'].includes(options.method||'GET')&&[500,502,503,504].includes(response.status)){
  for(let attempt=0;attempt<2;attempt++){
   await new Promise(resolve=>setTimeout(resolve,300*(attempt+1)));
   response=await request().catch(()=>response);
   if(![500,502,503,504].includes(response.status))break;
  }
 }
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);
 return data;
}
