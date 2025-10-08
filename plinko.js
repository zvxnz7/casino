/* -------------------------------------------------
   Casino Plinko — Responsive fit + no center force
   Bigger peg spacing, smaller pegs & ball, buckets pay on contact, multi-drop.
   Uses your app.js Firebase init. Include app.js BEFORE this file.
--------------------------------------------------- */

/* ===== Firestore MONEY adapter (guarded) ===== */
(function(){
  function disableUI(reason){
    const drop = document.getElementById('drop');
    const auto = document.getElementById('auto');
    const msg  = document.getElementById('msg');
    if (drop) drop.disabled = true;
    if (auto) auto.disabled = true;
    if (msg)  { msg.textContent = reason; msg.style.color = '#ff6b6b'; }
    window.MONEY = {
      async getBalance(){ throw new Error(reason); },
      async debit(){ throw new Error(reason); },
      async credit(){ throw new Error(reason); }
    };
  }
  try {
    if (!window.firebase || !firebase.apps) return disableUI('Load Firebase SDKs first.');
    if (!firebase.apps.length) return disableUI('Initialize Firebase in app.js before plinko.js.');
    const USERNAME = localStorage.getItem('username');
    if (!USERNAME) return disableUI('Log in first.');

    const db = firebase.firestore();
    let refCache = null;
    async function userRef(){
      if (refCache) return refCache;
      const q = await db.collection('users').where('username','==',USERNAME).limit(1).get();
      if (q.empty) throw new Error('Username not found.');
      refCache = q.docs[0].ref; return refCache;
    }
    const r2 = n => Math.round(n*100)/100;

    async function getBalance(){ const d = await (await userRef()).get(); return Number((d.data()||{}).money ?? 0); }
    async function debit(amount){
      amount = Number(amount); if (!(amount>0)) throw new Error('Invalid bet');
      const R = await userRef(); await db.runTransaction(async tx=>{
        const s = await tx.get(R); const cur = Number((s.data()||{}).money ?? 0);
        if (cur < amount) throw new Error('Insufficient funds.');
        tx.update(R, { money: r2(cur-amount) });
      });
    }
    async function credit(amount){
      amount = Number(amount); if (!(amount>=0)) throw new Error('Invalid payout');
      const R = await userRef(); await db.runTransaction(async tx=>{
        const s = await tx.get(R); const cur = Number((s.data()||{}).money ?? 0);
        tx.update(R, { money: r2(cur+amount) });
      });
    }
    window.MONEY = { getBalance, debit, credit };
  } catch(e){ console.error(e); disableUI(e?.message||'Wallet unavailable.'); }
})();

/* -------------------------------------------------
   DOM
--------------------------------------------------- */
const canvas   = document.getElementById('plinko');
const ctx      = canvas.getContext('2d', { alpha: true });
const balanceEl= document.getElementById('balance');
const betEl    = document.getElementById('bet');
const rowsEl   = document.getElementById('rows');
const rowsValEl= document.getElementById('rowsVal');
const riskEl   = document.getElementById('risk');
const rtpEl    = document.getElementById('rtp');
const rtpValEl = document.getElementById('rtpVal');
const dropBtn  = document.getElementById('drop');
const autoBtn  = document.getElementById('auto');
const legendEl = document.getElementById('legend');
const recentEl = document.getElementById('recent');
const msgEl    = document.getElementById('msg');
const chips    = [...document.querySelectorAll('.chip')];

/* -------------------------------------------------
   Config
--------------------------------------------------- */
let rows = Number(rowsEl.value);

// spacing (bigger gaps) — computed per screen with a boost factor
let spacing = 50;                 // will be recomputed
const SPACING_BOOST = 1.12;       // >1 makes rows farther apart
const MIN_SPACING   = 38;         // increased
const MAX_SPACING   = 72;

const SIDE_PAD = 20;
const TOP_Y    = 70;              // start a bit higher

// smaller pegs & ball
const pegRadius  = 4;
const ballRadius = 5;

// physics (no center force)
let gravity       = 0.42;
let restitution   = 0.18;
let air           = 0.992;
let pegTangent    = 0.86;
let wallDamping   = 0.66;
let maxSpeed      = 9.2;

const wall = { left: 6, right: 6, top: 6, bottom: 26 };

// buckets
const BUCKET_H        = 56;
const GAP_TO_BUCKETS  = 24;       // distance from last peg row to bucket top (lifted)
const BUCKET_LABEL_OFF= 4;

let pegs    = [];
let slots   = [];
let buckets = [];
let balls   = [];
let multipliers = [];
const MAX_CONCURRENT = 36;

/* RNG */
function rngBool(){ const u = new Uint32Array(1); crypto.getRandomValues(u); return (u[0]&1)===1; }

/* -------------------------------------------------
   Math for multipliers
--------------------------------------------------- */
function nCk(n,k){ if(k<0||k>n)return 0; if(k===0||k===n)return 1; k=Math.min(k,n-k); let num=1,den=1; for(let i=1;i<=k;i++){ num*= (n-(k-i)); den*=i; } return num/den; }
function generateMultipliers(n, risk, rtpPct){
  const probs = Array.from({length:n+1},(_,k)=> nCk(n,k)/Math.pow(2,n));
  const center = n/2;
  const beta = risk==='high'?0.95:risk==='medium'?0.62:0.35;
  const shape = probs.map((_,k)=> Math.pow(1.0 + Math.abs(k-center), beta));
  const rtp = rtpPct/100;
  const shapeEV = shape.reduce((s,sk,k)=> s + probs[k]*sk, 0);
  const c = rtp / shapeEV;
  return shape.map(sk => +Math.max(0.01, c*sk).toFixed(sk*c>=10?2:3));
}

/* -------------------------------------------------
   Responsive canvas sizing (fits PC & mobile)
--------------------------------------------------- */
function sizeCanvasToViewport(){
  // Width: fit container and viewport
  const containerW = (document.querySelector('.left')?.clientWidth || window.innerWidth) - 24;
  const maxW = Math.min(containerW, window.innerWidth - 16);
  const targetW = Math.max(360, Math.floor(maxW));

  // Height: fit viewport height minus UI (header + controls)
  const reserved = window.innerWidth < 980 ? 240 : 260; // space for right panel or below controls
  const maxH = Math.max(480, Math.min(window.innerHeight - reserved, 860));
  const targetH = Math.floor(maxH);

  canvas.width  = targetW;
  canvas.height = targetH;
}

/* -------------------------------------------------
   Layout (recomputed every resize/setting change)
--------------------------------------------------- */
function computeSpacing(){
  const n = Number(rowsEl.value);
  const cols = n + 1;

  const usableW = canvas.width - 2*SIDE_PAD;
  const sX = (usableW / cols);

  // height: ensure we can fit rows + gap + buckets + bottom
  const usableH = canvas.height - TOP_Y - (GAP_TO_BUCKETS + BUCKET_H + wall.bottom);
  const sY = (usableH / n);

  let s = Math.min(sX, sY);
  s = Math.max(MIN_SPACING, Math.min(MAX_SPACING, s * SPACING_BOOST));
  spacing = Math.floor(s);
}

function setupBoard(){
  rows = Number(rowsEl.value);
  computeSpacing();

  // pegs
  pegs.length = 0;
  for (let r=0;r<rows;r++){
    const count = r+1;
    const boardW = canvas.width - 2*SIDE_PAD;
    const offsetX = SIDE_PAD + (boardW - count*spacing)/2 + spacing/2;
    const y = TOP_Y + r*spacing;
    for (let i=0;i<count;i++){
      pegs.push({ x: offsetX + i*spacing, y });
    }
  }

  // slots (centers)
  const count = rows + 1;
  const boardW = canvas.width - 2*SIDE_PAD;
  const offsetX = SIDE_PAD + (boardW - count*spacing)/2 + spacing/2;
  slots = Array.from({length:count}, (_,i)=> offsetX + i*spacing);

  // buckets aligned to slots, lifted up
  const bucketTop = Math.min(
    canvas.height - wall.bottom - BUCKET_H - 4,
    TOP_Y + rows*spacing + GAP_TO_BUCKETS
  );
  buckets.length = 0;
  for (let i=0;i<slots.length;i++){
    const left  = (i===0) ? (slots[i] - spacing/2) : (slots[i-1] + slots[i])/2;
    const right = (i===slots.length-1) ? (slots[i] + spacing/2) : (slots[i] + slots[i+1])/2;
    const w = right - left;
    buckets.push({ x:left, y:bucketTop, w, h:BUCKET_H, index:i, color:bucketColor(i, slots.length) });
  }

  buildLegend();
}

function bucketColor(i, n){
  const center = (n-1)/2; const d = Math.abs(i-center)/center;
  if (d<=0.35) return '#FFC73A';
  if (d<=0.70) return '#FF9E2E';
  return '#FF4D4D';
}

/* -------------------------------------------------
   UI helpers
--------------------------------------------------- */
async function refreshBalance(){ try{ balanceEl.textContent = (await window.MONEY.getBalance()).toFixed(2); }catch(e){ balanceEl.textContent='ERR'; } }
function setMsg(t,isErr=true){ msgEl.textContent=t||''; msgEl.style.color=isErr?'var(--bad)':'var(--ok)'; }
function addRecent(bin, mult, bet, win){
  const li = document.createElement('li');
  li.innerHTML = `<span>Bin ${bin}</span><span class="mult">${mult}×</span><strong class="${win>0?'win':'loss'}">${win>0?`+${win.toFixed(2)}`:`-${bet.toFixed(2)}`}</strong>`;
  recentEl.prepend(li); while (recentEl.children.length>24) recentEl.removeChild(recentEl.lastChild);
}

/* -------------------------------------------------
   Physics step (no center force; bigger gaps; smaller collisions)
--------------------------------------------------- */
function spawnBall(bet, jitter=0){
  if (balls.length >= MAX_CONCURRENT) return;
  balls.push({ x: canvas.width/2 + jitter, y: 24, vx: 0, vy: 0, r: ballRadius, bet });
}

function updateBall(b){
  // gravity
  b.vy += gravity;

  // integrate with drag & cap
  b.vx *= air; b.vy *= air;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > maxSpeed){ const s = maxSpeed/sp; b.vx*=s; b.vy*=s; }
  b.x += b.vx; b.y += b.vy;

  // walls
  if (b.x - b.r < wall.left){ b.x = wall.left + b.r; b.vx *= -restitution*wallDamping; }
  if (b.x + b.r > canvas.width - wall.right){ b.x = canvas.width - wall.right - b.r; b.vx *= -restitution*wallDamping; }
  if (b.y - b.r < wall.top){ b.y = wall.top + b.r; b.vy *= -restitution; }

  // pegs (with tangential damping, smaller random nudge)
  const near = spacing + 8;
  for (const p of pegs){
    if (Math.abs(b.y - p.y) > near) continue;
    const dx=b.x-p.x, dy=b.y-p.y, min=b.r+pegRadius, d2=dx*dx+dy*dy;
    if (d2 < min*min){
      const d = Math.sqrt(d2)||1e-4, nx=dx/d, ny=dy/d;
      const overlap = min - d + 0.20;
      b.x += nx*overlap; b.y += ny*overlap;

      const vn = b.vx*nx + b.vy*ny;
      const vt = b.vx*(-ny) + b.vy*(nx);
      const newVn = -vn * restitution;
      const newVt = vt * pegTangent;
      b.vx = newVn*nx + newVt*(-ny);
      b.vy = newVn*ny + newVt*( nx);

      // tiny unbiased nudge (smaller because pegs are smaller)
      b.vx += (rngBool()? 0.18 : -0.18);
    }
  }

  // bucket contact — pay & remove on contact line just above bucket top
  const contactY = buckets.length ? (buckets[0].y - 6) : (canvas.height - wall.bottom - BUCKET_H - 6);
  if (b.y + b.r >= contactY){
    for (const k of buckets){
      if (b.x >= k.x && b.x <= k.x + k.w){
        onBallBucket(b, k.index);
        b.y = 1e9;
        break;
      }
    }
  }
}

/* -------------------------------------------------
   Render
--------------------------------------------------- */
function roundRect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
function renderBoard(){
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // soft inner walls
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#000';
  ctx.fillRect(0,0,wall.left,canvas.height);
  ctx.fillRect(canvas.width-wall.right,0,wall.right,canvas.height);
  ctx.fillRect(0,0,canvas.width,wall.top);
  ctx.globalAlpha = 1;

  // buckets
  buckets.forEach((b,i)=>{
    ctx.fillStyle = b.color;
    roundRect(b.x,b.y,b.w,b.h,8); ctx.fill();
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#fff'; ctx.fillRect(b.x,b.y,b.w,2); ctx.globalAlpha = 1;
    ctx.fillStyle = '#09131a'; ctx.font = 'bold 12px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.textAlign = 'center'; ctx.fillText(`${multipliers[i]}×`, b.x + b.w/2, b.y + b.h/2 + BUCKET_LABEL_OFF);
  });

  // pegs
  ctx.fillStyle = 'rgba(216,220,255,0.95)';
  pegs.forEach(p => { ctx.beginPath(); ctx.arc(p.x,p.y,pegRadius,0,Math.PI*2); ctx.fill(); });

  // balls
  balls.forEach(b => {
    const g = ctx.createRadialGradient(b.x-2,b.y-2,1,b.x,b.y,b.r+1);
    g.addColorStop(0,'#ffd1d1'); g.addColorStop(1,'#ff6b6b');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill();
  });

  // bottom bar
  ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
  ctx.fillRect(0, canvas.height - wall.bottom, canvas.width, wall.bottom); ctx.globalAlpha = 1;
}

/* -------------------------------------------------
   Loop
--------------------------------------------------- */
function loop(){
  balls.forEach(updateBall);
  balls = balls.filter(b => b.y < 1e8);
  renderBoard();
  requestAnimationFrame(loop);
}

/* -------------------------------------------------
   Outcomes
--------------------------------------------------- */
async function onBallBucket(ball, binIndex){
  try{
    const mult = multipliers[binIndex] ?? 0;
    const win = +(ball.bet * mult).toFixed(2);
    if (win > 0){
      await window.MONEY.credit(win, { game:'plinko', type:'payout', bet: ball.bet, multiplier: mult, rows: Number(rowsEl.value), risk: riskEl.value });
    }
    addRecent(binIndex, mult, ball.bet, win);
  }catch(e){ console.error(e); setMsg(e.message || 'Payout error.'); }
  finally{ try{ await refreshBalance(); }catch{} }
}

/* -------------------------------------------------
   Drop (multi supported)
--------------------------------------------------- */
async function startRound(count=1){
  setMsg('');
  const bet = Number(betEl.value);
  if (!Number.isFinite(bet) || bet<=0) return setMsg('Enter a valid bet.');
  count = Math.max(1, Math.min(count, MAX_CONCURRENT - balls.length));
  if (count<=0) return;

  try{
    await window.MONEY.debit(bet * count, { game:'plinko', type:'bet', bet, count, rows:Number(rowsEl.value), risk:riskEl.value });
    setupBoard();
    for (let i=0;i<count;i++){
      const jitter = (Math.random()-0.5) * spacing * 0.8;
      spawnBall(bet, jitter);
    }
    await refreshBalance();
  }catch(e){ setMsg(e.message || 'Bet rejected.'); }
}

/* -------------------------------------------------
   Legend
--------------------------------------------------- */
function buildLegend(){
  multipliers = generateMultipliers(Number(rowsEl.value), riskEl.value, Number(rtpEl.value));
  legendEl.innerHTML = '';
  multipliers.forEach((m,i)=>{
    const el = document.createElement('div');
    el.className = 'cell';
    el.innerHTML = `<strong>${m}×</strong><span>${i}</span>`;
    legendEl.appendChild(el);
  });
}

/* -------------------------------------------------
   Events + responsive sizing
--------------------------------------------------- */
dropBtn.addEventListener('click', () => startRound(1));
autoBtn.addEventListener('click', () => startRound(10));
chips.forEach(c => c.addEventListener('click', () => {
  betEl.value = (Number(betEl.value || 0) + Number(c.dataset.plus)).toFixed(2);
}));
rowsEl.addEventListener('input', () => { rowsValEl.textContent = rowsEl.value; setupBoard(); });
riskEl.addEventListener('change', buildLegend);
rtpEl.addEventListener('input', () => { rtpValEl.textContent = `${rtpEl.value}%`; buildLegend(); });

let resizeRAF;
function doResize(){ sizeCanvasToViewport(); setupBoard(); }
function onResize(){ if (resizeRAF) cancelAnimationFrame(resizeRAF); resizeRAF = requestAnimationFrame(doResize); }
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);

/* -------------------------------------------------
   Init
--------------------------------------------------- */
(async function init(){
  sizeCanvasToViewport(); // fits screen (PC + mobile)
  setupBoard();
  buildLegend();
  try{ await refreshBalance(); }catch{}
  loop();
})();
