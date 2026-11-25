// Gregorian -> Ethiopian converter (JDN based, seconds, Amharic month names). Ethiopian clock = G.C. hour + 6.
export const AM=['መስከረም','ጥቅምት','ኅዳር','ታኅሣሥ','ጥር','የካቲት','መጋቢት','ሚያዝያ','ግንቦት','ሰኔ','ሐምሌ','ነሐሴ','ጳጉሜ'];
const p=(n:number)=>String(n).padStart(2,'0');
export function toEC(d=new Date()){const y=d.getFullYear(),m=d.getMonth()+1,dd=d.getDate(),a=Math.floor((14-m)/12),y2=y+4800-a,m2=m+12*a-3;
 const j=dd+Math.floor((153*m2+2)/5)+365*y2+Math.floor(y2/4)-Math.floor(y2/100)+Math.floor(y2/400)-32045;
 const e=j-1723856,r=e%1461,n=r%365+365*Math.floor(r/1460);
 const ey=4*Math.floor(e/1461)+Math.floor(r/365)-Math.floor(r/1460),em=Math.floor(n/30)+1,ed=n%30+1;
 let h=(d.getHours()+6)%12;if(h===0)h=12;
 return {iso:`${ey}-${p(em)}-${p(ed)} ${p(h)}:${p(d.getMinutes())}:${p(d.getSeconds())}`,monthAm:AM[em-1],year:ey,month:em,day:ed};}
export const toGC=(d=new Date())=>`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
export const stamp=(d=new Date())=>({atGC:toGC(d),atEC:toEC(d).iso});
