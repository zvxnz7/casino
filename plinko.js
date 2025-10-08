/* -------------------------------------------------
   Casino Plinko — Buckets on contact + multi-drop
   Uses firebase via your existing app.js (already initialized).
   Include app.js BEFORE this file.
--------------------------------------------------- */

/* ===== Safe MONEY adapter (unchanged) ===== */
(function(){
  function disableUI(reason){
    const drop = document.getElementById('drop');
    const auto = document.getElementById('auto');
    const msg = document.getElementById('msg');
    if (drop) drop.disabled = true;
    if (auto) auto.disabled = true;
    if (msg) { msg.textContent = reason; msg.style.color = '#ff6b6b'; }
    window.MONEY = {
      async getBalance(){ throw new Error(reason); },
      async debit(){ throw new Error(reason); },
      async credit(){ throw new Error(reason); }
    };
  }

  try{
    if (!window.firebase || !firebase.apps) {
      disableUI('Firebase SDK not loaded. Load Firebase SDKs before scripts.');
      return;
    }
    if (!firebase.apps.length) {
      disableUI('Firebase not initialized. Include app.js before plinko.js.');
      return;
    }
    const USERNAME = localStorage.getItem('username');
    if (!USERNAME) { disableUI('No username found. Log in first.'); return; }

    const db = firebase.firestore();
    let userDocRef = null;
    async function getUserDocRef(){
      if (userDocRef) return userDocRef;
      const snap = await db.collection('users').where('username','==',USERNAME).limit(1).get();
      if (snap.empty) throw new Error('Username not found.');
      userDocRef = snap.docs[0].ref;
      return userDocRef;
    }
    const r2 = (n)=> Math.round(n*100)/100;

    async function getBalance(){
      const ref = await getUserDocRef();
      const doc = await ref.get();
      return Number((doc.data()||{}).money ?? 0);
    }
    async function debit(amount){
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
    async function credit(amount){
      amount = Number(amount);
      if (!(amount >= 0)) throw new Error('Invalid payout.');
      const ref = await getUserDocRef();
      await db.runTransaction(async tx=>{
        const snap = await tx.get(ref);
        const cur = Number((snap.data()||{}).money ?? 0);
        tx.update(ref, { money: r2(cur + amount) });
      });
    }

    window.MONEY = { getBalance, debit, credit };
  }catch(e){
    console.error(e);
    disableUI(e?.message || 'Wallet unavailable.');
  }
})();

/* -------------------------------------------------
   Plinko core (with bucket contact payout)
--------------------------------------------------- */
const canvas = document.getElementById('plinko');
const ctx = canvas.getContext('2d', { alpha: true });

const balanceEl = document.getElementById('balance');
const betEl = document.getElementById('bet');
const rowsEl = document.getElementById('rows');
const rowsValEl = document.getElementById('rowsVal');
const riskEl = document.getElementById('risk');
const rtpEl = document.getElementById('rtp');
const rtpValEl = document.getElementById('rtpVal');
const dropBtn = document.getElementById('drop');
const autoBtn = document.getElementById('auto');
const legendEl = document.getElementById('legend');
const recentEl = document.getElementById('recent');
const msgEl = document.getElementById('msg');
const chips = [...document.querySelectorAll('.chip')];

/* ---------- Config ---------- */
let rows = Number(rowsEl.value);

// dynamic spacing & pads
let spacing = 42;
const MIN_SPACING = 32;
const MAX_SPACING = 56;
const SIDE_PAD = 24;
const TOP_Y = 90;

let pegRadius = 5;
let ballRadius = 6;

// toned physics
let gravity = 0.30;
let restitution = 0.26;     // softer peg bounce
let friction = 0.986;

const wall = { left: 6, right: 6, top: 6, bottom: 26 };

// bucket/catch layout
let catchTop = 0;
let buckets = [];           // {x,y,w,h,index,color}
let slots = [];             // slot centers (for alignment)
const BUCKET_H = 52;        // visual bucket height
const BUCKET_TOP_GAP = 14;  // small gap above buckets

// game state
let pegs = [];
let balls = [];
let multipliers = [];
const MAX_CONCURRENT = 24;  // cap for perf

/* ---------- RNG ---------- */
function rngBool(){
  const u = new Uint32Array(1);
  crypto.getRandomValues(u);
  return (u[0] & 1) === 1;
}

/* ---------- Combinatorics & multipliers ---------- */
function nCk(n,k){
  if(k<0||k>n) return 0;
  if(k===0||k===n) return 1;
  k = Math.min(k, n-k);
  let num=1, den=1;
  for(let i=1;i<=k;i++){ num *= (n-(k-i)); den *= i; }
  return num/den;
}
function generateMultipliers(n, risk, rtpPct){
  const probs = Array.from({length:n+1},(_,k)=> nCk(n,k)/Math.pow(2,n));
  const center = n/2;
  const beta = risk==='high'?0.95 : risk==='medium'?0.60 : 0.32;
  const shape = probs.map((_,k)=> Math.exp(beta*Math.abs(k-center)));
  const rtp = rtpPct/100;
  const shapeEV = shape.reduce((s,sk,k)=> s + probs[k]*sk, 0);
  const c = rtp / shapeEV;
  return shape.map(sk => +(Math.max(0.01, c*sk).toFixed(sk*c>=10 ? 2 : 3)));
}

/* ---------- Spacing & layout ---------- */
function computeSpacing(){
  const nRows = Number(rowsEl.value);
  const nCols = nRows + 1;
  const usableW = canvas.width - 2*SIDE_PAD;
  const sX = usableW / nCols;

  const catchH = BUCKET_H + BUCKET_TOP_GAP;
  const usableH = canvas.height - TOP_Y - (catchH + wall.bottom);
  const sY = usableH / nRows;

  spacing = Math.max(MIN_SPACING, Math.min(MAX_SPACING, Math.floor(Math.min(sX, sY))));
}

function setupBoard(){
  computeSpacing();
  rows = Number(rowsEl.value);

  // pegs
  pegs.length = 0;
  for (let r = 0; r < rows; r++){
    const count = r + 1;
    const boardW = canvas.width - 2*SIDE_PAD;
    const offsetX = SIDE_PAD + (boardW - count * spacing) / 2 + spacing/2;
    const y = TOP_Y + r*spacing;
    for (let i=0;i<count;i++){
      pegs.push({ x: offsetX + i*spacing, y });
    }
  }

  // slots (centers under last row)
  const count = rows + 1;
  const boardW = canvas.width - 2*SIDE_PAD;
  const offsetX = SIDE_PAD + (boardW - count * spacing) / 2 + spacing/2;
  slots = Array.from({length:count}, (_,i)=> offsetX + i*spacing);

  // buckets aligned to slots
  const bucketTop = canvas.height - wall.bottom - BUCKET_H;
  const leftBoundary = slots[0] - spacing/2;
  buckets = [];
  for (let i=0;i<slots.length;i++){
    const left = (i===0) ? leftBoundary : (slots[i-1] + slots[i]) / 2;
    const right = (i===slots.length-1) ? (slots[i] + spacing/2) : (slots[i] + slots[i+1]) / 2;
    const w = right - left;
    buckets.push({
      x: left, y: bucketTop, w, h: BUCKET_H, index: i,
      color: bucketColor(i, slots.length) // color by position
    });
  }

  // multipliers + legend boxes (above buckets)
  buildLegend();
}

function bucketColor(i, n){
  // edge = red, center = yellow/orange
  const center = (n-1)/2;
  const d = Math.abs(i - center) / center; // 0..1
  // simple gradient from red -> orange -> yellow
  if (d > 0.8) return '#ff4d4d';
  if (d > 0.6) return '#ff6a33';
  if (d > 0.4) return '#ff8622';
  if (d > 0.2) return '#ff9f1a';
  return '#ffb51a';
}

/* ---------- Legend (DOM) ---------- */
function buildLegend(){
  multipliers = generateMultipliers(rows, riskEl.value, Number(rtpEl.value));
  legendEl.innerHTML = '';
  multipliers.forEach((m,i)=>{
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.style.background = 'var(--panel)';
    cell.innerHTML = `<strong>${m}×</strong><span>Bin ${i}</span>`;
    legendEl.appendChild(cell);
  });
}

/* ---------- Money / UI ---------- */
async function refreshBalance(){
  try{ const bal = await window.MONEY.getBalance(); balanceEl.textContent = Number(bal).toFixed(2); }
  catch(e){ balanceEl.textContent='ERR'; console.error(e); }
}
function setMsg(text, isError=true){ msgEl.textContent = text||''; msgEl.style.color = isError?'var(--bad)':'var(--ok)'; }
function addRecent(bin, mult, bet, win){
  const li = document.createElement('li');
  li.innerHTML = `<span>Bin ${bin}</span><span class="mult">${mult}×</span><strong class="${win>0?'win':'loss'}">${win>0?`+${win.toFixed(2)}`:`-${bet.toFixed(2)}`}</strong>`;
  recentEl.prepend(li);
  while (recentEl.children.length > 20) recentEl.removeChild(recentEl.lastChild);
}

/* ---------- Physics ---------- */
function spawnBall(bet){
  if (balls.length >= MAX_CONCURRENT) return;
  balls.push({ x: canvas.width/2, y: 28, vx: 0, vy: 0, r: ballRadius, bet });
}

function updateBall(b){
  // gravity & drag
  b.vy += gravity;
  b.vx *= friction; b.vy *= friction;

  // integrate
  b.x += b.vx; b.y += b.vy;

  // walls
  if (b.x - b.r < wall.left){ b.x = wall.left + b.r; b.vx *= -restitution; }
  if (b.x + b.r > canvas.width - wall.right){ b.x = canvas.width - wall.right - b.r; b.vx *= -restitution; }
  if (b.y - b.r < wall.top){ b.y = wall.top + b.r; b.vy *= -restitution; }

  // pegs (only nearby rows for perf)
  const pegWindow = spacing + 8;
  for (let p of pegs){
    if (Math.abs(b.y - p.y) > pegWindow) continue;
    const dx = b.x - p.x, dy = b.y - p.y;
    const min = b.r + pegRadius;
    const d2 = dx*dx + dy*dy;
    if (d2 < min*min){
      const d = Math.sqrt(d2) || 1e-4;
      const nx = dx/d, ny = dy/d;
      const overlap = min - d + 0.2;
      b.x += nx * overlap; b.y += ny * overlap;
      const vn = b.vx*nx + b.vy*ny;
      b.vx = b.vx - (1+restitution)*vn*nx;
      b.vy = b.vy - (1+restitution)*vn*ny;
      b.vx += rngBool() ? 0.5 : -0.5; // tiny unbiased nudge
    }
  }

  // ---- Bucket contact payout (instant) ----
  // If the ball's bottom touches the bucket tops, immediately assign bin and remove ball.
  const bucketTopY = canvas.height - wall.bottom - BUCKET_H - BUCKET_TOP_GAP;
  if (b.y + b.r >= bucketTopY){
    // find bucket by x
    for (const bucket of buckets){
      if (b.x >= bucket.x && b.x <= bucket.x + bucket.w){
        // settle immediately
        onBallBucket(b, bucket.index);
        // mark this ball for removal by moving it off-screen
        b.y = 1e9;
        break;
      }
    }
  }
}

/* ---------- Rendering ---------- */
function renderBoard(){
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // background rails & walls
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#000';
  ctx.fillRect(0,0,wall.left,canvas.height);
  ctx.fillRect(canvas.width-wall.right,0,wall.right,canvas.height);
  ctx.fillRect(0,0,canvas.width,wall.top);
  ctx.globalAlpha = 1;

  // draw buckets (orange boxes)
  buckets.forEach((b,i)=>{
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // label multiplier
    ctx.fillStyle = '#001018';
    ctx.font = 'bold 12px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.textAlign = 'center';
    ctx.fillText(`${multipliers[i]}x`, b.x + b.w/2, b.y + b.h/2 + 4);
  });

  // floor bar
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, canvas.height - wall.bottom, canvas.width, wall.bottom);
  ctx.globalAlpha = 1;

  // pegs
  ctx.fillStyle = '#d8dcff';
  pegs.forEach(p => { ctx.beginPath(); ctx.arc(p.x,p.y,pegRadius,0,Math.PI*2); ctx.fill(); });

  // balls
  ctx.fillStyle = '#ff6b6b';
  balls.forEach(b => { ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill(); });
}

/* ---------- Loop ---------- */
function loop(){
  balls.forEach(updateBall);
  // remove any ball moved off-screen
  balls = balls.filter(b => b.y < 1e8);
  renderBoard();
  requestAnimationFrame(loop);
}

/* ---------- Payout on bucket contact ---------- */
async function onBallBucket(ball, binIndex){
  try{
    const mult = multipliers[binIndex] ?? 0;
    const win = +(ball.bet * mult).toFixed(2);
    if (win > 0){
      await window.MONEY.credit(win, { game:'plinko', type:'payout', bet: ball.bet, multiplier: mult, rows, risk: riskEl.value });
    }
    addRecent(binIndex, mult, ball.bet, win);
  }catch(e){
    console.error(e);
    setMsg(e.message || 'Payout error.');
  }finally{
    // no busy flag — multi-drop supported
    await refreshBalance();
  }
}

/* ---------- Drop logic (supports multi) ---------- */
async function startRound(count = 1){
  setMsg('');
  const bet = Number(betEl.value);
  if (!Number.isFinite(bet) || bet <= 0) return setMsg('Enter a valid bet.');

  // clamp count to avoid overdrawing
  count = Math.max(1, Math.min(count, MAX_CONCURRENT - balls.length));
  if (count <= 0) return;

  try{
    // debit total upfront (casino pattern for multi-shot)
    await window.MONEY.debit(bet * count, { game:'plinko', type:'bet', bet, count, rows: Number(rowsEl.value), risk: riskEl.value });
    setupBoard(); // ensure geometry is current
    for (let i=0;i<count;i++){
      // small horizontal randomization so simultaneous balls don't stack
      const jitter = (Math.random() - 0.5) * spacing * 0.6;
      balls.push({ x: canvas.width/2 + jitter, y: 28, vx: 0, vy: 0, r: ballRadius, bet });
    }
    await refreshBalance();
  }catch(e){
    setMsg(e.message || 'Bet rejected.');
  }
}

/* ---------- Events ---------- */
dropBtn.addEventListener('click', () => startRound(1));
autoBtn.addEventListener('click', () => startRound(10)); // drop 10 simultaneously
chips.forEach(c => c.addEventListener('click', () => {
  betEl.value = (Number(betEl.value || 0) + Number(c.dataset.plus)).toFixed(2);
}));
rowsEl.addEventListener('input', () => { rowsValEl.textContent = rowsEl.value; setupBoard(); });
riskEl.addEventListener('change', buildLegend);
rtpEl.addEventListener('input', () => { rtpValEl.textContent = `${rtpEl.value}%`; buildLegend(); });

/* ---------- Responsive setup ---------- */
let resizeRAF;
function resizeCanvas(){
  const container = (document.querySelector('.left')?.clientWidth || 560) - 28;
  const desired = Math.min(560, container);
  const aspect = 760 / 560;
  canvas.width = Math.max(420, Math.floor(desired));
  canvas.height = Math.floor(canvas.width * aspect);
  setupBoard();
}
window.addEventListener('resize', () => {
  if (resizeRAF) cancelAnimationFrame(resizeRAF);
  resizeRAF = requestAnimationFrame(resizeCanvas);
});

/* ---------- Init ---------- */
(async function init(){
  // canvas size + geometry
  resizeCanvas();
  buildLegend();
  try { await refreshBalance(); } catch {}
  loop();
})();
