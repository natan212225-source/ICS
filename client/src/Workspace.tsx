import {useEffect,useMemo,useRef,useState} from 'react';
import {
 Activity,ArrowDownToLine,ArrowRight,ArrowUpRight,BadgeCheck,Bell,Building2,
 CalendarDays,Check,CheckCircle2,ChevronDown,ChevronLeft,ChevronRight,Clock3,
 Download,FileClock,FileText,Filter,MapPin,MoreHorizontal,Package,Search,
 ShieldCheck,TrendingUp,Users,X
} from 'lucide-react';
import {api} from './api';

const demoReasons=[['Expired Kebele ID',34],['Document mismatch',27],['Lost their ID',22],['Nationality issue',18],['Other requests',12]];
const demoRegions=[['Addis Ababa',42],['Oromia',25],['Amhara',18],['SNNPR',10],['Other',5]];
const demoBranches=[
 {name:'Addis Ababa Branch 1',region:'Addis Ababa',backed:84,lost:32,rate:76},
 {name:'Bole Sub-city Office',region:'Addis Ababa',backed:68,lost:25,rate:72},
 {name:'Bahir Dar Branch',region:'Amhara',backed:52,lost:19,rate:68},
 {name:'Adama Branch',region:'Oromia',backed:47,lost:21,rate:81}
];
const demoOfficers=[
 {name:'Abebe Tesfaye',branch:'Addis Ababa Branch 1',count:42,initials:'AT'},
 {name:'Hana Bekele',branch:'Bole Sub-city Office',count:36,initials:'HB'},
 {name:'Dawit Alemu',branch:'Bahir Dar Branch',count:29,initials:'DA'}
];
const demoApprovals=[
 {id:214,type:'EDIT',recordId:108,status:'PENDING',reason:'Correcting a digit in the request number.',payload:{before:{requestNumber:'BC-2024-0184'},changes:{requestNumber:'BC-2024-0189'}}},
 {id:213,type:'LOST_STATUS',recordId:76,status:'PENDING',reason:'Claimant presented the original kebele identification card.',payload:{before:{status:'NOT_TAKEN'},changes:{status:'TAKEN',claimant:'Mekdes Girma'}}},
 {id:212,type:'CANCEL',recordId:92,status:'PENDING',reason:'Duplicate registration submitted in error.',payload:{before:{status:'SUBMITTED'},changes:{status:'CANCELLED'}}}
];
const sampleTrend=[12,15,11,18,16,20,19,23,17,22,25,21,27,22,25,28,24,32,27,31,34,29,36,32,38,34,39,42,37,45];
const avatarTones=['tone-blue','tone-green','tone-violet','tone-amber'];

const labelRole=(role:string)=>({
 SUPER_ADMIN:'Super Admin',ADMIN:'Administrator',VERIFIER:'Special Document Verifier',LF_OFFICER:'Lost & Found Officer'
} as Record<string,string>)[role]||role;
const splitReason=(value:any)=>String(value||'').split(',').map((x:string)=>x.trim()).filter(Boolean);
const withinToday=(value:any)=>{const date=value?new Date(value):null;return !!date&&!Number.isNaN(date.getTime())&&date.toDateString()===new Date().toDateString()};
const shortValue=(key:string,value:any)=>{
 if(key==='photo'||key==='handoverPhoto')return value?'Photo attached':'No photo';
 if(key==='attachments'){try{return `${(Array.isArray(value)?value:JSON.parse(value||'[]')).length} file(s)`}catch{return 'Documents updated'}}
 return String(value??'—');
};

function Sparkline({values,color='#1A4AA8'}:{values:number[];color?:string}){
 const max=Math.max(...values,1),min=Math.min(...values,0),range=max-min||1;
 const points=values.map((v,i)=>`${i*100/(values.length-1)},${28-(v-min)/range*24}`).join(' ');
 return <svg viewBox="0 0 100 32" className="sparkline" role="img" aria-label="Recent trend"><polyline points={points} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function MetricCard({title,value,delta,icon:Icon,color,trend,caption}:{title:string;value:string|number;delta:string;icon:any;color:string;trend:number[];caption:string}){
 return <article className="metric-card surface-card">
  <div className="metric-top"><span className={`metric-icon ${color}`}><Icon size={19}/></span><button aria-label={`${title} options`} className="icon-button"><MoreHorizontal size={18}/></button></div>
  <p className="metric-label">{title}</p><div className="metric-value-row"><strong>{value}</strong><span className="metric-delta"><TrendingUp size={13}/>{delta}</span></div>
  <div className="metric-bottom"><span>{caption}</span><Sparkline values={trend}/></div>
 </article>;
}

function SectionTitle({eyebrow,title,description,action}:{eyebrow?:string;title:string;description?:string;action?:any}){
 return <div className="section-title"><div>{eyebrow&&<span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{description&&<p>{description}</p>}</div>{action}</div>;
}

function Skeleton({count=3}:{count?:number}){
 return <div className="skeleton-grid" aria-label="Loading content">{Array.from({length:count},(_,i)=><div className="skeleton surface-card" key={i}><i/><i/><i/></div>)}</div>;
}

function TinyBarChart({values}:{values:[string,number][]}){
 const max=Math.max(...values.map(x=>x[1]),1);
 return <div className="bar-chart" role="img" aria-label="Backed customers by reason">
  {values.map(([label,value])=><div className="bar-row" key={label}><span title={label}>{label}</span><div className="bar-track"><i style={{width:`${Math.max(3,value/max*100)}%`}}/></div><b>{value}</b></div>)}
 </div>;
}

function DonutChart({values}:{values:[string,number][]}){
 const total=values.reduce((sum,item)=>sum+item[1],0)||1,circumference=2*Math.PI*39;
 let offset=0;
 const colors=['#1A4AA8','#19A78A','#E8B849','#8B75D7','#A9B6C7'];
 return <div className="donut-wrap">
  <svg viewBox="0 0 100 100" className="donut-chart" role="img" aria-label="Backed customers by region">
   <circle cx="50" cy="50" r="39" fill="none" stroke="var(--line)" strokeWidth="11"/>
   {values.map(([label,value],i)=>{const length=value/total*circumference,part=<circle key={label} cx="50" cy="50" r="39" fill="none" stroke={colors[i%colors.length]} strokeWidth="11" strokeDasharray={`${length} ${circumference-length}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)"/>;offset+=length;return part})}
   <text x="50" y="47" textAnchor="middle" className="donut-number">{total}</text><text x="50" y="61" textAnchor="middle" className="donut-caption">records</text>
  </svg>
  <div className="donut-legend">{values.map(([label,value],i)=><div key={label}><span><i style={{background:colors[i%colors.length]}}/>{label}</span><b>{Math.round(value/total*100)}%</b></div>)}</div>
 </div>;
}

function TrendChart({values}:{values:number[]}){
 const width=640,height=190,pad=12,max=Math.max(...values,1),min=0;
 const points=values.map((v,i)=>`${pad+i*(width-pad*2)/(values.length-1)},${height-pad-(v-min)/(max-min||1)*(height-pad*2)}`);
 const line=points.join(' '),area=`${pad},${height-pad} ${line} ${width-pad},${height-pad}`;
 return <div className="trend-chart">
  <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Daily registration volume for the last 30 days">
   <defs><linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#1A4AA8" stopOpacity=".2"/><stop offset="100%" stopColor="#1A4AA8" stopOpacity="0"/></linearGradient></defs>
   {[.25,.5,.75,1].map(y=><line key={y} x1={pad} x2={width-pad} y1={height-pad-(height-pad*2)*y} y2={height-pad-(height-pad*2)*y} className="chart-gridline"/>)}<polygon points={area} fill="url(#trendFill)"/><polyline points={line} fill="none" stroke="#1A4AA8" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>
  </svg><div className="chart-axis"><span>30 days ago</span><span>15 days ago</span><span>Today</span></div>
 </div>;
}

function RecoveryRing({value}:{value:number}){
 const radius=43,circ=2*Math.PI*radius;
 return <div className="recovery-ring"><svg viewBox="0 0 100 100" role="img" aria-label={`Recovery rate ${value}%`}><circle cx="50" cy="50" r={radius} className="ring-base"/><circle cx="50" cy="50" r={radius} className="ring-value" strokeDasharray={`${value/100*circ} ${circ}`} transform="rotate(-90 50 50)"/><text x="50" y="48" textAnchor="middle">{value}%</text><text x="50" y="63" textAnchor="middle" className="ring-small">recovered</text></svg><p><strong>Strong recovery performance</strong><span>Across reported found items</span></p></div>;
}

function ApprovalCard({request,onDecision,superAdmin}:{request:any;onDecision:(request:any,decision:string,confirmed?:boolean)=>void;superAdmin:boolean}){
 const [confirmed,setConfirmed]=useState(false);
 const payload=typeof request.payload==='string'?JSON.parse(request.payload):request.payload||{before:{},changes:{}};
 const collection=request.type==='LOST_STATUS'&&payload.changes?.status==='TAKEN';
 return <article className="approval-item">
  <div className="approval-id"><span>#{request.id}</span><span className="status-pill status-pending">{request.status||'PENDING'}</span><span className="approval-kind">{request.type==='LOST_STATUS'?'Lost item status':request.type==='EDIT'?'Record edit':'Cancellation'}</span></div>
  <p className="approval-reason">{request.reason||'No additional details supplied.'}</p>
  <div className="approval-diff">{Object.keys(payload.changes||{}).slice(0,2).map(key=><div key={key}><span>{key}</span><del>{shortValue(key,payload.before?.[key])}</del><ArrowRight size={13}/><ins>{shortValue(key,payload.changes[key])}</ins></div>)}</div>
  {collection&&<div className="dashboard-handover"><div>{payload.changes.handoverPhoto&&superAdmin?<img src={payload.changes.handoverPhoto} alt={`Claimant for record ${request.recordId}`}/>:<span>Photo review required</span>}</div><p>Claimant: <b>{payload.changes.claimant||'—'}</b>{superAdmin&&payload.changes.handoverPhoto&&<label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Confirm ownership</label>}</p></div>}
  <div className="approval-actions"><button className="button button-quiet" onClick={()=>onDecision(request,'reject')}>Reject</button><button className="button button-primary button-small" disabled={collection&&(!superAdmin||!confirmed||!payload.changes.handoverPhoto)} onClick={()=>onDecision(request,'approve',confirmed)}><Check size={14}/> Approve</button></div>
 </article>;
}

export function Dashboard({me,onNavigate,onToast}:{me:any;onNavigate:(page:string)=>void;onToast:(kind:string,message:string)=>void}){
 const [data,setData]=useState<any>({backed:[],lost:[],approvals:[]}),[state,setState]=useState('loading'),[error,setError]=useState('');
 const [search,setSearch]=useState('');
 const canApprove=me.perms.includes('approve_edit')||me.perms.includes('approve_cancel')||me.perms.includes('case.update')||me.perms.includes('manage_users')||me.role==='SUPER_ADMIN';
 useEffect(()=>{let active=true;setState('loading');Promise.all([
  me.perms.includes('read')?api('/backed'):Promise.resolve([]),
  me.perms.includes('read')?api('/lost'):Promise.resolve([]),
  canApprove?api('/approvals'):Promise.resolve([])
 ]).then(([backed,lost,approvals])=>{if(active){setData({backed,lost,approvals});setState('ready');setError('')}}).catch((e:any)=>{if(active){setError(e.message);setState('error')}});
  return()=>{active=false};
 },[me,canApprove]);
 const preview=state==='ready'&&data.backed.length+data.lost.length===0;
 const backedToday=data.backed.filter((x:any)=>withinToday(x.createdAt)).length;
 const pending=data.approvals.filter((x:any)=>['PENDING','ADMIN_APPROVED'].includes(x.status));
 const notTaken=data.lost.filter((x:any)=>x.status==='NOT_TAKEN').length,old=data.lost.filter((x:any)=>x.status==='OLD').length;
 const reasonValues=useMemo(()=>{const counts=new Map<string,number>();data.backed.forEach((r:any)=>splitReason(r.reasons).forEach((label:string)=>counts.set(label,(counts.get(label)||0)+1)));return counts.size?[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5) as [string,number][]:demoReasons as [string,number][]},[data.backed]);
 const regionValues=useMemo(()=>{const counts=new Map<string,number>();data.backed.forEach((r:any)=>{const label=r.region||'Other';counts.set(label,(counts.get(label)||0)+1)});return counts.size?[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5) as [string,number][]:demoRegions as [string,number][]},[data.backed]);
 const branchRows=useMemo(()=>{const counts=new Map<string,any>();[...data.backed,...data.lost].forEach((r:any)=>{const name=r.branch?.name||'Branch';if(!counts.has(name))counts.set(name,{name,region:r.region||'—',backed:0,lost:0,recovered:0});const entry=counts.get(name);if('requestNumber'in r){entry.backed++;}else{entry.lost++;if(r.status==='TAKEN')entry.recovered++}});return counts.size?[...counts.values()].sort((a,b)=>(b.backed+b.lost)-(a.backed+a.lost)).slice(0,4):demoBranches},[data.backed,data.lost]);
 const officers=useMemo(()=>{const counts=new Map<string,any>();data.lost.forEach((r:any)=>{const name=r.user?.fullName||'Officer';const current=counts.get(name)||{name,branch:r.branch?.name||'—',count:0};current.count++;counts.set(name,current)});return counts.size?[...counts.values()].sort((a,b)=>b.count-a.count).slice(0,3).map((x:any)=>({...x,initials:x.name.split(' ').map((part:string)=>part[0]).slice(0,2).join('')})):demoOfficers},[data.lost]);
 const trend=useMemo(()=>data.backed.length||data.lost.length?Array.from({length:30},(_,index)=>{const date=new Date();date.setDate(date.getDate()-(29-index));return [...data.backed,...data.lost].filter((r:any)=>{const created=new Date(r.createdAt);return !Number.isNaN(created.getTime())&&created.toDateString()===date.toDateString()}).length}):sampleTrend,[data.backed,data.lost]);
 const recovery=data.lost.length?Math.round(data.lost.filter((r:any)=>r.status==='TAKEN').length/data.lost.length*100):68;
 const handleDecision=async(request:any,decision:string,ownershipConfirmed=false)=>{if(preview){setData((previous:any)=>({...previous,approvals:previous.approvals.filter((item:any)=>item.id!==request.id)}));onToast('success',`Preview request #${request.id} ${decision==='approve'?'approved':'rejected'}.`);return}try{await api(`/approvals/${request.id}/decide`,{method:'POST',body:{decision,ownershipConfirmed}});setData((previous:any)=>({...previous,approvals:previous.approvals.filter((item:any)=>item.id!==request.id)}));onToast('success',`Request #${request.id} ${decision==='approve'?'approved':'rejected'}.`)}catch(e:any){onToast('error',e.message)}};
 const greeting=new Date().getHours()<12?'Good morning':new Date().getHours()<17?'Good afternoon':'Good evening';
 const submitSearch=(e:any)=>{e.preventDefault();if(search.trim())onNavigate(`search:${search.trim()}`)};
 if(state==='loading')return <div className="workspace-content"><div className="dashboard-heading"><div><span className="eyebrow">OVERVIEW</span><div className="skeleton-line skeleton-heading"/></div></div><Skeleton count={4}/><div className="dashboard-grid"><div className="surface-card skeleton skeleton-panel"/><div className="surface-card skeleton skeleton-panel"/></div></div>;
 if(state==='error')return <div className="workspace-content"><section className="state-card state-error"><ShieldCheck size={26}/><h2>Dashboard unavailable</h2><p>{error}</p><button className="button button-primary" onClick={()=>window.location.reload()}>Reload dashboard</button></section></div>;
 return <div className="workspace-content">
  <div className="dashboard-heading"><div><span className="eyebrow">OVERVIEW · {new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</span><h1>{greeting}, {me.fullName.split(' ')[0]}</h1><p>Here’s the latest activity across your service area.</p></div><div className="heading-actions">{preview&&<span className="preview-label"><i/> Sample preview</span>}<button className="button button-quiet" onClick={()=>window.location.reload()}><Activity size={15}/> Refresh</button></div></div>
  <div className="metric-grid">
   <MetricCard title="Backed customers today" value={preview?'28':backedToday} delta="+12.8%" icon={Users} color="blue" trend={[12,16,14,19,17,23,28]} caption="vs. previous day"/>
   <MetricCard title="Pending approvals" value={preview?pending.length||7:pending.length} delta={preview?'-2.4%':'Live'} icon={FileClock} color="amber" trend={[22,18,20,17,14,12,10]} caption="Awaiting review"/>
   <MetricCard title="Lost & found · not taken" value={preview?'86':notTaken} delta="+4.2%" icon={Package} color="green" trend={[10,12,11,15,18,16,20]} caption="Across all branches"/>
   <MetricCard title="Over 6 months old" value={preview?'14':old} delta="-8.1%" icon={Clock3} color="red" trend={[27,24,26,21,19,17,14]} caption="Requires follow-up"/>
  </div>
  <div className="dashboard-grid dashboard-grid-charts">
   <section className="surface-card chart-card"><div className="card-heading"><div><h2>Backed customers by reason</h2><p>Most frequent request categories</p></div><button className="select-compact" aria-label="Chart range">Last 30 days <ChevronDown size={14}/></button></div><TinyBarChart values={reasonValues}/></section>
   <section className="surface-card chart-card"><div className="card-heading"><div><h2>Regional distribution</h2><p>Records by region</p></div><button className="icon-button" aria-label="Regional chart options"><MoreHorizontal size={18}/></button></div><DonutChart values={regionValues}/></section>
  </div>
  <div className="dashboard-grid dashboard-grid-trend">
   <section className="surface-card chart-card"><div className="card-heading"><div><h2>Service volume</h2><p>Backed customer and Lost & Found activity</p></div><div className="chart-key"><span><i/> Backed</span><span><i/> Lost & Found</span></div></div><TrendChart values={trend}/></section>
   <section className="surface-card chart-card recovery-card"><div className="card-heading"><div><h2>Recovery rate</h2><p>Items returned to their owners</p></div><button className="icon-button" aria-label="Recovery chart options"><MoreHorizontal size={18}/></button></div><RecoveryRing value={recovery}/><div className="recovery-foot"><span><i/> {preview?'42':' '+data.lost.filter((r:any)=>r.status==='TAKEN').length} recovered</span><span>{preview?'20':' '+notTaken} in progress</span></div></section>
  </div>
  <div className="dashboard-grid dashboard-grid-bottom">
   <section className="surface-card table-card"><div className="card-heading"><div><h2>Branch performance</h2><p>Service activity by location</p></div><button className="text-action" onClick={()=>onNavigate('admin')}>View branches <ArrowRight size={14}/></button></div><div className="table-scroll"><table className="modern-table"><thead><tr><th>BRANCH</th><th>BACKED</th><th>LOST & FOUND</th><th>RECOVERY</th><th>ACTIVITY</th></tr></thead><tbody>{branchRows.map((row:any,index:number)=><tr key={row.name}><td><div className="branch-cell"><span className="branch-icon"><Building2 size={16}/></span><span><b>{row.name}</b><small>{row.region}</small></span></div></td><td>{row.backed}</td><td>{row.lost}</td><td><span className="recovery-label">{preview?row.rate:row.lost?Math.round(row.recovered/row.lost*100):0}%</span></td><td><Sparkline values={[12,14,11,17,16,20].map(v=>v-index)}/></td></tr>)}</tbody></table></div></section>
   <section className="surface-card activity-card"><div className="card-heading"><div><h2>Officer activity</h2><p>Top contributors this month</p></div><button className="icon-button" aria-label="Officer activity options"><MoreHorizontal size={18}/></button></div>{officers.map((person:any,index:number)=><div className="officer-row" key={person.name}><span className={`avatar-circle ${avatarTones[index%avatarTones.length]}`}>{person.initials}</span><div className="officer-info"><b>{person.name}</b><small>{person.branch}</small></div><strong>{person.count}<small> records</small></strong></div>)}</section>
  </div>
  <section className="surface-card approvals-panel"><div className="card-heading"><div><h2>Approval queue <span className="count-badge">{preview?pending.length||7:pending.length}</span></h2><p>Requests requiring your attention</p></div><button className="text-action" onClick={()=>onNavigate('approvals')}>Open approvals <ArrowRight size={14}/></button></div>
   {(preview?demoApprovals:pending).slice(0,3).map(request=><ApprovalCard key={request.id} request={request} onDecision={handleDecision} superAdmin={me.role==='SUPER_ADMIN'}/>)}{!preview&&!pending.length&&<div className="empty-inline"><CheckCircle2 size={18}/>You’re all caught up. No requests need review.</div>}
  </section>
  <section className="quick-links"><button onClick={()=>onNavigate('backed')}><span className="quick-icon quick-blue"><Users size={18}/></span><span><b>Register backed customer</b><small>Start a new customer record</small></span><ArrowRight size={16}/></button><button onClick={()=>onNavigate('lost')}><span className="quick-icon quick-green"><Package size={18}/></span><span><b>Register found item</b><small>Log property received at your branch</small></span><ArrowRight size={16}/></button><form onSubmit={submitSearch}><span className="quick-icon quick-amber"><Search size={18}/></span><input aria-label="Search all records" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a record by name, phone or ID"/><button aria-label="Search"><ArrowRight size={16}/></button></form></section>
 </div>;
}

const actionCategory=(action:string)=>{
 const value=String(action||'').toLowerCase();
 if(value.includes('login'))return 'login';
 if(value.includes('create'))return 'create';
 if(value.includes('edit'))return 'edit';
 if(value.includes('cancel'))return 'cancel';
 if(value.includes('decision')||value.includes('approve'))return 'approve';
 if(value.includes('report')||value.includes('export'))return 'export';
 return 'system';
};
const actionLabel=(action:string)=>({
 login:'Signed in',backed_create:'Created backed customer',lost_create:'Registered found item',
 request_EDIT:'Requested record edit',request_CANCEL:'Requested cancellation',request_LOST_STATUS:'Requested item status change',
 decision_APPROVED:'Approved request',decision_ADMIN_APPROVED:'Co-approved request',decision_REJECTED:'Rejected request',
 user_create:'Created user',user_suspend:'Suspended user',branch_create:'Created branch'
} as Record<string,string>)[action]||String(action||'Activity').replace(/_/g,' ');
const downloadFile=(name:string,content:string,type:string)=>{const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();URL.revokeObjectURL(url)};
const csvCell=(value:any)=>`"${String(value??'').replace(/"/g,'""')}"`;

function AuditDiff({approval}:{approval:any}){
 const payload=approval?.payload;
 if(!payload)return <div className="audit-json"><p>No before/after diff was captured for this activity.</p><pre>{JSON.stringify({activity:'Audit event',approval:approval||null},null,2)}</pre></div>;
 const changes=payload.changes||{};
 return <div className="audit-diff-wrap"><div className="diff-caption"><span>BEFORE</span><span>REQUESTED CHANGE</span></div>{Object.keys(changes).map(key=><div className="audit-diff-row" key={key}><b>{key}</b><code>{shortValue(key,payload.before?.[key])}</code><ArrowRight size={14}/><code className="diff-new">{shortValue(key,changes[key])}</code></div>)}<details className="audit-json-toggle"><summary>View JSON payload</summary><pre>{JSON.stringify(payload,null,2)}</pre></details></div>;
}

function AuditEntry({entry,expanded,onToggle}:{entry:any;expanded:boolean;onToggle:()=>void}){
 const category=actionCategory(entry.action),actor=entry.user?.fullName||`User ${entry.userId}`;
 const Icon=category==='approve'?BadgeCheck:category==='login'?ShieldCheck:category==='export'?ArrowDownToLine:category==='create'?Users:FileText;
 return <article className="timeline-entry">
  <div className={`timeline-icon timeline-${category}`}><Icon size={16}/></div><div className="timeline-content">
   <div className="timeline-main"><span className={`avatar-circle ${avatarTones[entry.userId%avatarTones.length]}`}>{actor.split(' ').map((x:string)=>x[0]).slice(0,2).join('')}</span><div className="timeline-copy"><div><b>{actor}</b> <span>{actionLabel(entry.action).toLowerCase()}</span>{entry.approval&&<b> #{entry.approval.id}</b>}</div><p>{entry.approval?.reason||entry.detail||'—'}</p><div className="timeline-meta"><span><Building2 size={12}/>{entry.user?.branch||'—'}</span><span><MapPin size={12}/>{entry.ip||'IP unavailable'}</span><span><span className={`action-chip chip-${category}`}>{category}</span></span></div></div><div className="timeline-time"><b>{entry.atGC}</b><span>{entry.atEC} E.C.</span></div></div>
   <button className="diff-toggle" aria-expanded={expanded} onClick={onToggle}>{expanded?'Hide event details':'View event details'}<ChevronDown size={14}/></button>{expanded&&<AuditDiff approval={entry.approval}/>}
  </div>
 </article>;
}

export function AuditTrail(){
 const [logs,setLogs]=useState<any[]>([]),[state,setState]=useState('loading'),[error,setError]=useState(''),[expanded,setExpanded]=useState<number|null>(null),[view,setView]=useState<'timeline'|'table'>('table'),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(25),[total,setTotal]=useState(0),[pages,setPages]=useState(1),[newCount,setNewCount]=useState(0);
 const [filters,setFilters]=useState<any>({search:'',user:'',role:'',branch:'',action:'all',module:'all',calendar:'gc',from:'',to:''});
 const newest=useRef<number|null>(null);
 useEffect(()=>{let active=true;const load=async()=>{try{
  const params=new URLSearchParams({page:String(page),pageSize:String(pageSize),search:filters.search,action:filters.action,module:filters.module||'all'});
  if(filters.user)params.set('userId',filters.user);
  if(filters.from)params.set('from',filters.from);
  if(filters.to)params.set('to',filters.to);
  const data=await api('/audit?'+params.toString());
  if(!active)return;
  const next=Array.isArray(data)?data:(data.logs||[]);
  if(newest.current!==null){const count=next.filter((item:any)=>item.id>newest.current!).length;if(count)setNewCount((value:number)=>value+count)}
  if(next.length)newest.current=Math.max(...next.map((item:any)=>item.id));
  setLogs(next);setTotal(Array.isArray(data)?next.length:(data.total||0));setPages(Array.isArray(data)?Math.max(1,Math.ceil(next.length/pageSize)):(data.pages||1));setState('ready');setError('');
 }catch(e:any){if(active){setError(e.message);setState('error')}}};load();const timer=setInterval(load,30000);return()=>{active=false;clearInterval(timer)}},[page,pageSize,filters]);
 const filtered=logs;
 const visible=logs;
 const users=[...new Map(logs.map((x:any)=>[String(x.userId),{id:x.userId,name:x.user?.fullName||`User ${x.userId}`}])).values()] as any[];
 const roles=[...new Set(logs.map((x:any)=>x.user?.role).filter(Boolean))] as string[],branches=[...new Set(logs.map((x:any)=>x.user?.branch).filter(Boolean))] as string[];
 const updateFilter=(key:string,value:string)=>{setFilters((current:any)=>({...current,[key]:value}));setPage(1)};
 const exportRows=()=>filtered.map((entry:any)=>[entry.atGC,entry.atEC,entry.user?.fullName||`User ${entry.userId}`,entry.user?.role,entry.user?.branch,actionLabel(entry.action),entry.detail,entry.ip]);
 const exportExcel=()=>downloadFile('ICS-audit-trail.csv',[['G.C. timestamp','E.C. timestamp','User','Role','Branch','Action','Details','IP address'],...exportRows()].map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
 const exportWord=()=>{const rows=exportRows().map(row=>`<tr>${row.map(cell=>`<td>${String(cell??'').replace(/[&<>"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]!))}</td>`).join('')}</tr>`).join('');downloadFile('ICS-audit-trail.doc',`<html><meta charset="utf-8"><h1>ICS Consolidated Audit Trail</h1><table border="1"><thead><tr><th>G.C.</th><th>E.C.</th><th>User</th><th>Role</th><th>Branch</th><th>Action</th><th>Details</th><th>IP</th></tr></thead><tbody>${rows}</tbody></table></html>`,'application/msword')};
 const exportPdf=()=>window.print();
 if(state==='loading')return <div className="workspace-content"><SectionTitle eyebrow="GOVERNANCE" title="Consolidated audit trail" description="A complete, attributable record of activity across your service area."/><Skeleton count={3}/></div>;
 if(state==='error')return <div className="workspace-content"><SectionTitle eyebrow="GOVERNANCE" title="Consolidated audit trail"/><section className="state-card state-error"><ShieldCheck size={26}/><h2>Audit trail unavailable</h2><p>{error}</p><button className="button button-primary" onClick={()=>window.location.reload()}>Retry</button></section></div>;
 return <div className="workspace-content audit-page">
  <SectionTitle eyebrow="GOVERNANCE & COMPLIANCE" title="Consolidated audit trail" description="Trace user actions, approvals, and record changes across every branch." action={<div className="audit-export no-print"><button className="button button-quiet" onClick={exportPdf}><FileText size={15}/> PDF</button><button className="button button-quiet" onClick={exportWord}><Download size={15}/> Word</button><button className="button button-quiet" onClick={exportExcel}><Download size={15}/> Excel</button></div>}/>
  <div className="audit-summary surface-card"><div><span className="audit-summary-icon"><FileClock size={17}/></span><span><b>{logs.length.toLocaleString()}</b><small>Recent audit events</small></span></div><div><span className="audit-live-dot"/><span><b>Live monitoring</b><small>Last synced just now · 30 sec refresh</small></span></div><button className="new-activity-button" onClick={()=>{setNewCount(0);setPage(1)}}>{newCount?`${newCount} new activities`:'All activity up to date'}<ArrowUpRight size={14}/></button></div>
  <div className="audit-filter-card surface-card no-print">
   <div className="audit-search"><Search size={17}/><input aria-label="Search audit activity" placeholder="Search users, actions, branches or IPs…" value={filters.search} onChange={e=>updateFilter('search',e.target.value)}/>{filters.search&&<button aria-label="Clear search" onClick={()=>updateFilter('search','')}><X size={14}/></button>}</div>
   <div className="audit-filter-grid">
    <label>User<select value={filters.user} onChange={e=>updateFilter('user',e.target.value)}><option value="">All users</option>{users.map((u:any)=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
    <label>Role<select value={filters.role} onChange={e=>updateFilter('role',e.target.value)}><option value="">All roles</option>{roles.map(role=><option key={role} value={role}>{labelRole(role)}</option>)}</select></label>
    <label>Branch<select value={filters.branch} onChange={e=>updateFilter('branch',e.target.value)}><option value="">All branches</option>{branches.map(branch=><option key={branch}>{branch}</option>)}</select></label>
    <label>Action<select value={filters.action} onChange={e=>updateFilter('action',e.target.value)}>{[['all','All actions'],['login','Login'],['create','Create'],['edit','Edit'],['approve','Approve'],['cancel','Cancel'],['export','Export']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label>Module<select value={filters.module} onChange={e=>updateFilter('module',e.target.value)}>{['all','Authentication','Users','Roles','Case Register','Backed Customers','Lost & Found','System'].map(value=><option key={value} value={value}>{value==='all'?'All modules':value}</option>)}</select></label>
   </div>
   <div className="audit-date-row"><div className="calendar-toggle" role="group" aria-label="Calendar system"><button className={filters.calendar==='gc'?'active':''} onClick={()=>updateFilter('calendar','gc')}>G.C.</button><button className={filters.calendar==='ec'?'active':''} onClick={()=>updateFilter('calendar','ec')}>E.C.</button></div><label>{filters.calendar==='gc'?'G.C.':'E.C.'} from<input type={filters.calendar==='gc'?'date':'text'} placeholder="YYYY-MM-DD" value={filters.from} onChange={e=>updateFilter('from',e.target.value)}/></label><label>To<input type={filters.calendar==='gc'?'date':'text'} placeholder="YYYY-MM-DD" value={filters.to} onChange={e=>updateFilter('to',e.target.value)}/></label><button className="clear-filters" onClick={()=>{setFilters({search:'',user:'',role:'',branch:'',action:'all',module:'all',calendar:'gc',from:'',to:''});setPage(1)}}><Filter size={14}/>Clear filters</button></div>
  </div>
  <div className="audit-view-row no-print"><div><b>{filtered.length.toLocaleString()}</b> matching events</div><div className="view-switch"><button className={view==='timeline'?'selected':''} onClick={()=>setView('timeline')}><Activity size={15}/> Timeline</button><button className={view==='table'?'selected':''} onClick={()=>setView('table')}><FileText size={15}/> Table</button></div></div>
  {state==='ready'&&!filtered.length?<section className="state-card"><FileClock size={26}/><h2>{total?'No matching activity':'No audit events yet'}</h2><p>{total?'Try changing your filters or date range.':'New sign-ins, approvals, and record updates will appear here.'}</p>{total>0&&<button className="button button-quiet" onClick={()=>{setFilters({search:'',user:'',role:'',branch:'',action:'all',module:'all',calendar:'gc',from:'',to:''});setPage(1)}}>Clear filters</button>}</section>
  :view==='timeline'?<section className="timeline-list">{visible.map((entry:any)=><AuditEntry key={entry.id} entry={entry} expanded={expanded===entry.id} onToggle={()=>setExpanded(expanded===entry.id?null:entry.id)}/>)}</section>
  :<section className="surface-card audit-table-card"><div className="table-scroll"><table className="modern-table audit-table"><thead><tr><th>Date / Time</th><th>User</th><th>Role</th><th>Action</th><th>Module</th><th>Details</th><th/></tr></thead><tbody>{visible.map((entry:any)=>{const module=/(backed)/.test(entry.action)?'Backed Customers':/(lost)/.test(entry.action)?'Lost & Found':/(case)/.test(entry.action)?'Case Register':/(role)/.test(entry.action)?'Roles':/(user)/.test(entry.action)?'Users':/(login|logout)/.test(entry.action)?'Authentication':'System';return <tr key={entry.id}><td><b>{entry.atGC}</b><small>{entry.atEC} E.C.</small></td><td><b>{entry.user?.fullName||`User ${entry.userId}`}</b><small>{entry.ip||'IP unavailable'}</small></td><td>{labelRole(entry.user?.role||'')}</td><td><span className={`action-chip chip-${actionCategory(entry.action)}`}>{actionLabel(entry.action)}</span></td><td>{module}</td><td>{entry.approval?.reason||entry.detail||'—'}</td><td><button className="icon-button" aria-label={`View details for event ${entry.id}`} onClick={()=>setExpanded(expanded===entry.id?null:entry.id)}><ChevronDown size={16}/></button></td></tr>})}</tbody></table></div>{expanded!==null&&<div className="table-expanded"><AuditDiff approval={logs.find((item:any)=>item.id===expanded)?.approval}/></div>}</section>}
  {total>0&&<div className="pagination no-print"><span>Showing {((page-1)*pageSize)+1}–{Math.min(page*pageSize,total)} of {total}</span><label>Rows<select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1)}}><option value={12}>12</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label><div><button aria-label="Previous page" disabled={page<=1} onClick={()=>setPage(value=>Math.max(1,value-1))}><ChevronLeft size={16}/></button><span>Page {page} of {pages}</span><button aria-label="Next page" disabled={page>=pages} onClick={()=>setPage(value=>Math.min(pages,value+1))}><ChevronRight size={16}/></button></div></div>}
 </div>;
}

export function SearchResults({query,onNavigate}:{query:string;onNavigate:(page:string)=>void}){
 const [rows,setRows]=useState<any[]>([]),[state,setState]=useState('loading'),[error,setError]=useState('');
 useEffect(()=>{let active=true;Promise.allSettled([api('/backed?'+new URLSearchParams({q:query,requestNumber:query}).toString()),api('/lost?q='+encodeURIComponent(query))]).then(results=>{if(!active)return;const backed=results[0].status==='fulfilled'?results[0].value.map((x:any)=>({...x,kind:'Backed Customer'})):[];const lost=results[1].status==='fulfilled'?results[1].value.map((x:any)=>({...x,kind:'Lost & Found'})):[];setRows([...backed,...lost]);if(results.every(x=>x.status==='rejected')){setError('Search could not reach either records service.');setState('error')}else setState('ready')});return()=>{active=false}},[query]);
 return <div className="workspace-content"><SectionTitle eyebrow="GLOBAL SEARCH" title={`Results for “${query}”`} description="Search across backed customer and Lost & Found records."/><div className="search-results surface-card">{state==='loading'?<Skeleton count={3}/>:state==='error'?<div className="state-card state-error"><Search size={24}/><h2>Search unavailable</h2><p>{error}</p></div>:!rows.length?<div className="state-card"><Search size={24}/><h2>No records found</h2><p>Try a different name, phone number, request number, or item ID.</p></div>:rows.map((row:any)=><button className="search-result-row" key={`${row.kind}-${row.id}`} onClick={()=>onNavigate(row.kind==='Lost & Found'?'lost':'backed')}><span className={`search-result-icon ${row.kind==='Lost & Found'?'quick-green':'quick-blue'}`}>{row.kind==='Lost & Found'?<Package size={18}/>:<Users size={18}/>}</span><span><b>{row.firstName} {row.middleName} {row.lastName}</b><small>{row.kind} · {row.requestNumber||row.itemNo||`Record #${row.id}`} · {row.branch?.name||'Branch not available'}</small></span><span className="status-pill status-blue">{row.status}</span><ArrowRight size={16}/></button>)}</div></div>;
}
