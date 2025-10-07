/* -------------------------------------------------
   Casino Plinko — Physics version
   Integrates with your Firestore money system.
   Requires firebase + your app.js already loaded.
--------------------------------------------------- */

// MONEY adapter built on your Firestore schema
(function(){
  const db = firebase.firestore();
  const USERNAME = localStorage.getItem('username');
  let userDocRef = null;

  async function getUserDocRef(){
    if (userDocRef) return userDocRef;
    const snap = await db.collection('users').where('username','==',USERNAME).limit(1).get();
    if (snap.empty) throw new Error('Username not found.');
    userDocRef = snap.docs[0].ref;
    return userDocRef;
  }

  function r2(n){ return Math.round(n*100)/100; }

  async function readBalance(){
    const ref = await getUserDocRef();
    const doc = await ref.get();
    const data = doc.data() || {};
    return Number(data.money ?? 0);
  }

  async function debit(amount, meta={}){
    amount = Number(amount);
    if (!(amount > 0)) throw new Error('Invalid bet amount.');
    const ref = await getUserDocRef();
    await db.runTransaction(async tx=>{
      const snap = await tx.get(ref);
      const cur = Number((snap.data()||{}).money ?? 0);
      if (cur < amount) throw new Error('Insufficient funds.');
      tx.update(ref, { money: r2(cur - amount) });
    });
  }

  async function credit(amount, meta={}){
    amount = Number(amount);
    if (!(amount >= 0)) throw new Error('Invalid credit.');
    const ref = await getUserDocRef();
    await db.runTransaction(async tx=>{
      const snap = await tx.get(ref);
      const cur = Number((snap.data()||{}).money ?? 0);
      tx.update(ref, { money: r2(cur + amount) });
    });
  }

  window.MONEY = { getBalance: readBalance, debit, credit };
})();

// -----------------------------------------------------
// Plinko core
// -----------------------------------------------------
const canvas = document.getElementById('plinko');
const ctx = canvas.getContext('2d');

const balanceEl = document.getElementById('balance');
const betEl = document.getElementById('bet');
const dropBtn = document.getElementById('drop');
const autoBtn = document.getElementById('auto');
const rowsEl = document.getElementById('rows');
const rowsValEl = document.getElementById('rowsVal');
const riskEl = document.getElementById('risk');
const rtpEl = document.getElementById('rtp');
const rtpValEl = document.getElementById('rtpVal');
const legendEl = document.getElementById('legend');
const recentEl = document.getElementById('recent');
const msgEl = document.getElementById('msg');
const chips = [...document.querySelectorAll('.chip')];

let rows = Number(rowsEl.value);
let spacing = 42;
let pegRadius = 5;
let ballRadius = 6;
let gravity = 0.28;
let restitution = 0.45;
let friction = 0.995;
let wall = { left: 6, right: 6, top: 6, bottom: 26 };

let pegs = [], slots = [], balls = [];
let multipliers = [];
let busy = false, autoplay = 0;

function rngBool(){
  const u = new Uint32Array(1);
  crypto.getRandomValues(u);
  return (u[0] & 1) === 1;
}

// Geometry setup
function setupBoard(){
  rows = Number(rowsEl.value);
  pegs = [];
  const firstY = 90;
  for (let r = 0; r < rows; r++){
    const count = r + 1;
    const offsetX = (canvas.width - count * spacing) / 2 + spacing / 2;
    const y = firstY + r * spacing;
    for (let i = 0; i < count; i++){
      pegs.push({ x: offsetX + i * spacing, y });
    }
  }
  const count = rows + 1;
  const offsetX = (canvas.width - count * spacing) / 2 + spacing / 2;
  slots = Array.from({length: count}, (_,i)=> offsetX + i*spacing);
  buildLegend();
}

function resizeCanvas(){
  const container = document.querySelector('.left').clientWidth - 28;
  const desired = Math.min(560, container);
  const aspect = 760/560;
  canvas.width = Math.max(420, Math.floor(desired));
  canvas.height = Math.floor(canvas.width * aspect);
  setupBoard();
}
window.addEventListener('resize', resizeCanvas);

// RTP / multipliers
function nCk(n,k){
  if(k<0||k>n) return 0;
  if(k===0||k===n) return 1;
  k=Math.min(k,n-k);
  let num=1,den=1;
  for(let i=1;i<=k;i++){num*=n-(k-i);den*=i;}
  return num/den;
}
function generateMultipliers(n, risk, rtpPct){
  const probs = Array.from({length:n+1},(_,k)=> nCk(n,k)/Math.pow(2,n));
  const center = n/2;
  const beta = risk==='high'?0.95:risk==='medium'?0.6:0.32;
  const shape = probs.map((_,k)=>Math.exp(beta*Math.abs(k-center)));
  const rtp = rtpPct/100;
  const shapeEV = shape.reduce((s,sk,k)=>s+probs[k]*sk,0);
  const c = rtp/shapeEV;
  return shape.map(sk=> +(Math.max(0.01,c*sk).toFixed(3)));
}
function buildLegend(){
  multipliers = generateMultipliers(Number(rowsEl.value), riskEl.value, Number(rtpEl.value));
  legendEl.innerHTML = '';
  multipliers.forEach((m,i)=>{
    const div = document.createElement('div');
    div.className = 'cell';
    div.innerHTML = `<strong>${m}×</strong><span>${i}</span>`;
    legendEl.appendChild(div);
  });
}

// Money + UI
async function refreshBalance(){
  try{
    const b = await window.MONEY.getBalance();
    balanceEl.textContent = Number(b).toFixed(2);
  }catch(e){ balanceEl.textContent='ERR'; console.error(e);}
}
function setMsg(t,isError=true){ msgEl.textContent=t||''; msgEl.style.color=isError?'#ff6b6b':'#2dd4bf';}
function addRecent(bin,mult,bet,win){
  const li = document.createElement('li');
  li.innerHTML = `<span>Bin ${bin}</span><span class="mult">${mult}×</span><strong class="${win>0?'win':'loss'}">${win>0?`+${win.toFixed(2)}`:`-${bet.toFixed(2)}`}</strong>`;
  recentEl.prepend(li);
  while(recentEl.children.length>20) recentEl.removeChild(recentEl.lastChild);
}

// Physics
function spawnBall(bet){
  balls.push({x:canvas.width/2,y:30,vx:0,vy:0,r:ballRadius,bet,settled:false});
}
function updateBall(b){
  b.vy += gravity; b.vx*=friction; b.vy*=friction;
  b.x += b.vx; b.y += b.vy;
  // walls
  if(b.x-b.r<wall.left){b.x=wall.left+b.r;b.vx*=-restitution;}
  if(b.x+b.r>canvas.width-wall.right){b.x=canvas.width-wall.right-b.r;b.vx*=-restitution;}
  if(b.y-b.r<wall.top){b.y=wall.top+b.r;b.vy*=-restitution;}
  // peg collisions
  const pegWindow = spacing+8;
  for(let p of pegs){
    if(Math.abs(b.y-p.y)>pegWindow) continue;
    const dx=b.x-p.x,dy=b.y-p.y,d2=dx*dx+dy*dy,min=b.r+pegRadius;
    if(d2<min*min){
      const d=Math.sqrt(d2)||1e-4,nx=dx/d,ny=dy/d;
      const overlap=min-d+0.2;
      b.x+=nx*overlap;b.y+=ny*overlap;
      const vn=b.vx*nx+b.vy*ny;
      b.vx=b.vx-(1+restitution)*vn*nx;
      b.vy=b.vy-(1+restitution)*vn*ny;
      b.vx += rngBool()?0.65:-0.65;
    }
  }
  // floor
  const floorY=canvas.height-wall.bottom;
  if(b.y+b.r>=floorY){
    b.y=floorY-b.r;
    b.vx*=0.94;b.vy=0;
    if(Math.abs(b.vx)<0.08){
      let nearest=0,best=Infinity;
      for(let i=0;i<slots.length;i++){
        const d=Math.abs(slots[i]-b.x);
        if(d<best){best=d;nearest=i;}
      }
      b.x=slots[nearest];
      b.settled=true;
      onBallSettled(b,nearest);
    }
  }
}
function renderBoard(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#000'; ctx.globalAlpha=0.25;
  ctx.fillRect(0,0,wall.left,canvas.height);
  ctx.fillRect(canvas.width-wall.right,0,wall.right,canvas.height);
  ctx.fillRect(0,0,canvas.width,wall.top);
  ctx.fillRect(0,canvas.height-wall.bottom,canvas.width,wall.bottom);
  ctx.globalAlpha=1;
  ctx.fillStyle='#7c5cff'; slots.forEach(x=>ctx.fillRect(x-1,canvas.height-wall.bottom,2,wall.bottom));
  ctx.fillStyle='#d8dcff'; pegs.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,pegRadius,0,Math.PI*2);ctx.fill();});
  ctx.fillStyle='#ff6b6b'; balls.forEach(b=>{ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.fill();});
}
function loop(){
  balls.forEach(updateBall);
  balls=balls.filter(b=>!b.settled);
  renderBoard();
  requestAnimationFrame(loop);
}

// Game flow
async function onBallSettled(ball,bin){
  try{
    const mult=multipliers[bin]??0;
    const win=+(ball.bet*mult).toFixed(2);
    if(win>0) await window.MONEY.credit(win,{game:'plinko',type:'payout',bet:ball.bet,multiplier:mult});
    addRecent(bin,mult,ball.bet,win);
  }catch(e){console.error(e);setMsg(e.message||'Payout error.');}
  finally{
    await refreshBalance(); busy=false;
    if(autoplay>0){autoplay--;if(autoplay===0)autoBtn.classList.remove('active');setTimeout(()=>startRound(),220);}
  }
}
async function startRound(){
  if(busy) return; setMsg('');
  const bet=Number(betEl.value);
  if(!Number.isFinite(bet)||bet<=0) return setMsg('Invalid bet.');
  try{
    busy=true;
    await window.MONEY.debit(bet,{game:'plinko',type:'bet',bet});
    setupBoard();
    spawnBall(bet);
    await refreshBalance();
  }catch(e){busy=false;setMsg(e.message||'Bet failed.');}
}

// Events
dropBtn.addEventListener('click',()=>startRound());
autoBtn.addEventListener('click',()=>{if(busy||autoplay>0)return;autoplay=10;autoBtn.classList.add('active');startRound();});
chips.forEach(c=>c.addEventListener('click',()=>{betEl.value=(Number(betEl.value||0)+Number(c.dataset.plus)).toFixed(2);}));
rowsEl.addEventListener('input',()=>{rowsValEl.textContent=rowsEl.value;setupBoard();});
riskEl.addEventListener('change',buildLegend);
rtpEl.addEventListener('input',()=>{rtpValEl.textContent=`${rtpEl.value}%`;buildLegend();});

// Init
(async function init(){
  resizeCanvas();
  buildLegend();
  await refreshBalance();
  loop();
})();
