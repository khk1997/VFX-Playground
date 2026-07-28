'use strict';
const canvas=document.querySelector('#stage'),ctx=canvas.getContext('2d');
const isPreview=new URLSearchParams(location.search).has('preview'); if(isPreview) document.documentElement.classList.add('preview-mode');
const state={amount:isPreview?82:120,angle:45,speed:1,turbulence:.72,size:1,leaves:0,petalColor:'#efb0c2',leafColor:'#efb0c2',seamless:true,loopSec:6};
let w=0,h=0,dpr=1,petals=[],paused=false,last=performance.now(),time=0;
const rand=(a,b)=>a+Math.random()*(b-a);
function windVector(){const a=state.angle*Math.PI/180;return {x:Math.cos(a),y:Math.sin(a)};}
function spawnPoint(first=false){
  if(first)return {x:rand(-w*.15,w*1.05),y:rand(-h*.15,h*1.05)};
  const v=windVector(),span=Math.hypot(w,h),cross=rand(-span*.68,span*.68);
  return {x:w*.5-v.x*span*.72-v.y*cross,y:h*.5-v.y*span*.72+v.x*cross};
}
function makePetal(first=false){
  const z=Math.pow(Math.random(),.7);
  const pos=spawnPoint(first);
  const baseRot=rand(0,Math.PI*2),baseFlip=rand(0,Math.PI*2);
  return {x:pos.x,y:pos.y,z,s:rand(5.5,12)*(0.55+z*.8),drift:rand(.82,1.18),rot:baseRot,baseRot,spin:rand(-2.3,2.3),spinCycles:Math.floor(rand(1,5))*(Math.random()<.5?-1:1),flip:baseFlip,baseFlip,flipSpeed:rand(1.5,4),flipCycles:Math.floor(rand(2,7)),waveCycles:Math.floor(rand(1,4)),loopPhase:Math.random(),cross:rand(-1,1),phase:rand(0,Math.PI*2),hue:rand(-8,8),type:Math.random()*100<state.leaves?'leaf':'petal'};
}
function syncCount(first=false){while(petals.length<state.amount)petals.push(makePetal(first));if(petals.length>state.amount)petals.length=state.amount;}
function resize(){dpr=Math.min(devicePixelRatio||1,2);w=innerWidth;h=innerHeight;canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);if(!petals.length)syncCount(true);}
function reset(p){Object.assign(p,makePetal(false));}
function drawPetal(p){
  const flutter=Math.cos(p.flip); const scaleY=.16+.84*Math.abs(flutter); const s=p.s*state.size;
  const base=hexRgb(state.petalColor),light=shade(base,24+p.hue),middle=shade(base,p.hue),dark=shade(base,-24+p.hue),alpha=.38+.58*p.z;
  ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot);ctx.scale(1,scaleY);
  ctx.beginPath();ctx.moveTo(0,s*.66);ctx.bezierCurveTo(-s*.92,s*.12,-s*.7,-s*.72,0,-s);ctx.bezierCurveTo(s*.7,-s*.72,s*.92,s*.12,0,s*.66);ctx.closePath();
  const g=ctx.createLinearGradient(-s,-s,s,s);g.addColorStop(0,rgba(light,alpha));g.addColorStop(.58,rgba(middle,alpha));g.addColorStop(1,rgba(dark,alpha));ctx.fillStyle=g;ctx.fill();
  if(p.z>.5){ctx.strokeStyle=rgba(shade(base,-58),.12*p.z);ctx.lineWidth=.45;ctx.beginPath();ctx.moveTo(0,s*.55);ctx.quadraticCurveTo(-s*.06,-s*.15,0,-s*.82);ctx.stroke();}
  ctx.restore();
}
function drawLeaf(p){
  const flutter=Math.cos(p.flip),scaleY=.12+.88*Math.abs(flutter),s=p.s*state.size*1.22;
  const middle=hexRgb(state.leafColor),light=shade(middle,32),dark=shade(middle,-30),vein=shade(middle,46);
  ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot);ctx.scale(1,scaleY);
  ctx.beginPath();ctx.moveTo(0,s*.92);ctx.bezierCurveTo(-s*.88,s*.18,-s*.68,-s*.68,0,-s);ctx.bezierCurveTo(s*.74,-s*.58,s*.82,s*.22,0,s*.92);ctx.closePath();
  const g=ctx.createLinearGradient(-s,-s,s,s);g.addColorStop(0,rgba(light,.35+.52*p.z));g.addColorStop(.55,rgba(middle,.4+.5*p.z));g.addColorStop(1,rgba(dark,.42+.48*p.z));ctx.fillStyle=g;ctx.fill();
  ctx.strokeStyle=rgba(vein,.12+.18*p.z);ctx.lineWidth=.55;ctx.beginPath();ctx.moveTo(0,s*.76);ctx.lineTo(0,-s*.78);ctx.stroke();ctx.restore();
}
function hexRgb(hex){const n=parseInt(hex.slice(1),16);return {r:n>>16,g:n>>8&255,b:n&255};}
function shade(c,n){return {r:Math.max(0,Math.min(255,c.r+n)),g:Math.max(0,Math.min(255,c.g+n)),b:Math.max(0,Math.min(255,c.b+n))};}
function rgba(c,a){return `rgba(${c.r},${c.g},${c.b},${a})`;}
function background(){
  const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,'#24202b');g.addColorStop(.5,'#17151d');g.addColorStop(1,'#0c1016');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  const glow=ctx.createRadialGradient(w*.22,h*.15,0,w*.22,h*.15,Math.max(w,h)*.7);glow.addColorStop(0,'rgba(111,75,88,.18)');glow.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
}
function frame(now){
  requestAnimationFrame(frame);if(paused){last=now;return;}const dt=Math.min((now-last)/1000,.034);last=now;time+=dt;syncCount();background();
  petals.sort((a,b)=>a.z-b.z);
  const wind=windVector(),span=Math.hypot(w,h),TAU=Math.PI*2,loopPhase=(time%state.loopSec)/state.loopSec;
  for(const p of petals){
    if(state.seamless){const q=(loopPhase+p.loopPhase)%1,along=-span*.76+span*1.52*q,cross=p.cross*span*.61+Math.sin(TAU*q*p.waveCycles+p.phase)*28*state.turbulence;p.x=w*.5+wind.x*along-wind.y*cross;p.y=h*.5+wind.y*along+wind.x*cross;p.rot=p.baseRot+TAU*p.spinCycles*q;p.flip=p.baseFlip+TAU*p.flipCycles*q;}
    else {const gust=Math.sin(time*.9+p.phase)+Math.sin(time*2.1+p.phase*.7)*.35,base=(78+105*p.z)*state.speed*p.drift,cross=gust*24*state.turbulence;p.x+=(base*wind.x-cross*wind.y)*dt;p.y+=(base*wind.y+cross*wind.x)*dt;p.rot+=p.spin*dt*(.45+p.z);p.flip+=p.flipSpeed*dt;const along=(p.x-w*.5)*wind.x+(p.y-h*.5)*wind.y;if(along>span*.76)reset(p);}
    p.type==='leaf'?drawLeaf(p):drawPetal(p);
  }
}
addEventListener('resize',resize);resize();requestAnimationFrame(frame);
document.querySelector('#toggle').onclick=()=>document.querySelector('#panel').classList.toggle('hidden');
['amount','speed','turbulence','size'].forEach(k=>document.querySelector('#'+k).oninput=e=>state[k]=+e.target.value);
document.querySelector('#angle').oninput=e=>{state.angle=+e.target.value;document.querySelector('#angleLabel').textContent=`風向 ${state.angle}°`;};
document.querySelector('#leaves').oninput=e=>{state.leaves=+e.target.value;petals.forEach(p=>p.type=Math.random()*100<state.leaves?'leaf':'petal');};
document.querySelector('#petalColor').oninput=e=>state.petalColor=e.target.value;
document.querySelector('#leafColor').oninput=e=>state.leafColor=e.target.value;
document.querySelector('#loopSec').oninput=e=>{state.loopSec=+e.target.value;document.querySelector('#loopLabel').textContent=`循環 ${state.loopSec} 秒`;};
document.querySelector('#seamless').onchange=e=>{state.seamless=e.target.checked;document.querySelector('#speed').disabled=state.seamless;document.querySelector('#loopNote').textContent=state.seamless?'無縫模式下，循環秒數會取代風速決定移動速度。':'自然模式使用風速，軌跡會持續但不保證首尾同幀。';time=0;};
addEventListener('message',e=>{if(e.data==='vfx-pause')paused=true;if(e.data==='vfx-play'){paused=false;last=performance.now();}});document.addEventListener('visibilitychange',()=>paused=document.hidden);
