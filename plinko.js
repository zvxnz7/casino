/* -------------------------------------------------
   Casino Plinko — Physics + Firestore money
   Uses firebase & your existing app.js (already initializes Firebase).
   Keep app.js and this file separate; include app.js BEFORE this file.
--------------------------------------------------- */

/* ===== Safe MONEY adapter (prevents “unresponsive” if Firebase/username missing) ===== */
(function(){
  function disableUI(reason){
    const drop = document.getElementById('drop');
    const auto = document.getElementById('auto');
    const msg = document.getElementById('msg');
    if (drop) drop.disabled = true;
    if (auto) auto.disabled = true;
    if (msg) { msg.textContent = reason; msg.style.color = '#ff6b6b'; }
    // stubs to avoid undefined errors
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
    if (!USERNAME) {
      disableUI('No username found. Log in first.');
      return;
    }

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
   Plinko core
--------------------------------------------------- */
const canvas = document.getElementById('plinko');
if (!canvas) console.error('Plinko canvas not found on this page.');
const ctx = canvas?.getContext('2d', { alpha: true });

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

// ===== Board / Physics Config (softened) =====
let rows = Number(rowsEl.value);
let spacing = 42;
let pegRadius = 5;
let ballRadius = 6;
let gravity = 0.30;          // slightly stronger pull
let restitution = 0.28;      // softer peg bounces
let friction = 0.985;        // more air drag
const floorFriction = 0.90;  // grippy floor
const dividerRestitution = 0.15; // very soft rail bounce
let wall = { left: 6, right: 6, top: 6, bottom: 26 };

// Catch area / slot dividers
let catchTop = 0;             // y-start of catch area
let slotHalfGap = 0;          // half distance between slot centers
let dividers = [];            // vertical rails
const dividerHalfW = 2;       // rail half-width (px)
const catchDepthPx = 90;      // catch area height

let pegs = [];
let slots = [];               // x positions for bins (rows+1)
let balls = [];
let multipliers = [];
let busy = false;
let autoplay = 0;

// ===== RNG =====
function rngBool(){
  const u = new Uint32Array(1);
  crypto.getRandomValues(u);
  return (u[0] & 1) === 1;
}

/* ---------- Layout ---------- */
function setupBoard(){
  rows = Number(rowsEl.value);
  pegs.length = 0;
  const firstY = 90;

  for (let r = 0; r < rows; r++){
    const count = r + 1;
    const offsetX = (canvas.width - count * spacing) / 2 + spacing / 2;
    const y = firstY + r * spacing;
    for (let i = 0; i < count; i++){
      pegs.push({ x: offsetX + i * spacing, y });
    }
  }

  // landing slots
  const count = rows + 1;
  const offsetX = (canvas.width - count * spacing) / 2 + spacing / 2;
  slots = Array.from({length: count}, (_,i)=> offsetX + i*spacing);

  // catch area and rails between slots
  catchTop = canvas.height - wall.bottom - catchDepthPx;
  slotHalfGap = spacing / 2;
  dividers = [];
  for (let i = 0; i < slots.length - 1; i++) {
    const mid = (slots[i] + slots[i + 1]) / 2;
    dividers.push({ x: mid, y0: catchTop, y1: canvas.height - wall.bottom });
  }

  buildLegend();
}

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

/* ---------- RTP / Multipliers ---------- */
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
  const shape = probs.map((_,k)=> Math.exp(beta*Math.abs(k-center))); // emphasize edges with risk
  const rtp = rtpPct / 100;
  const shapeEV = shape.reduce((s,sk,k)=> s + probs[k]*sk, 0);
  const c = rtp / shapeEV;
  return shape.map(sk => +(Math.max(0.01, c*sk).toFixed(sk*c>=10 ? 2 : 3)));
}
function buildLegend(){
  multipliers = generateMultipliers(Number(rowsEl.value), riskEl.value, Number(rtpEl.value));
  legendEl.innerHTML = '';
  multipliers.forEach((m,i)=>{
    const node = document.createElement('div');
    node.className = 'cell';
    node.innerHTML = `<strong>${m}×</strong><span>Bin ${i}</span>`;
    legendEl.appendChild(node);
  });
}

/* ---------- Money / UI ---------- */
async function refreshBalance(){
  try{
    const bal = await window.MONEY.getBalance();
    balanceEl.textContent = Number(bal).toFixed(2);
  }catch(e){
    balanceEl.textContent = 'ERR';
    console.error(e);
  }
}
function setMsg(text, isError = true){
  msgEl.textContent = text || '';
  msgEl.style.color = isError ? 'var(--bad)' : 'var(--ok)';
}
function addRecent(bin, mult, bet, win){
  const li = document.createElement('li');
  li.innerHTML = `
    <span>Bin ${bin}</span>
    <span class="mult">${mult}×</span>
    <strong class="${win>0?'win':'loss'}">${win>0?`+${win.toFixed(2)}`:`-${bet.toFixed(2)}`}</strong>
  `;
  recentEl.prepend(li);
  while (recentEl.children.length > 20) recentEl.removeChild(recentEl.lastChild);
}
function moneyReady(){
  return window.MONEY
    && typeof window.MONEY.getBalance==='function'
    && typeof window.MONEY.debit==='function'
    && typeof window.MONEY.credit==='function';
}

/* ---------- Physics ---------- */
function spawnBall(bet){
  balls.push({ x: canvas.width/2, y: 30, vx: 0, vy: 0, r: ballRadius, bet, settled: false });
}

function updateBall(b){
  // gravity & drag
  b.vy += gravity;
  b.vx *= friction;
  b.vy *= friction;

  // integrate
  b.x += b.vx;
  b.y += b.vy;

  // walls
  if (b.x - b.r < wall.left){ b.x = wall.left + b.r; b.vx *= -restitution; }
  if (b.x + b.r > canvas.width - wall.right){ b.x = canvas.width - wall.right - b.r; b.vx *= -restitution; }
  if (b.y - b.r < wall.top){ b.y = wall.top + b.r; b.vy *= -restitution; }

  // peg collisions (limit checks to nearby vertical window for perf)
  const pegWindow = spacing + 8;
  for (let p of pegs){
    if (Math.abs(b.y - p.y) > pegWindow) continue;
    const dx = b.x - p.x, dy = b.y - p.y, min = b.r + pegRadius, d2 = dx*dx + dy*dy;
    if (d2 < min*min){
      const d = Math.sqrt(d2) || 1e-4, nx = dx/d, ny = dy/d;
      const overlap = min - d + 0.2;
      b.x += nx * overlap; b.y += ny * overlap;
      const vn = b.vx*nx + b.vy*ny;
      b.vx = b.vx - (1+restitution)*vn*nx;
      b.vy = b.vy - (1+restitution)*vn*ny;

      // slight unbiased nudge to break symmetry
      b.vx += rngBool() ? 0.55 : -0.55;
    }
  }

  // --- Slot box dividers (only active in catch area) ---
  if (b.y + b.r > catchTop) {
    for (const d of dividers) {
      // AABB vertical wall range check
      if (b.y + b.r < d.y0 || b.y - b.r > d.y1) continue;
      const dx = b.x - d.x;
      const overlap = (dividerHalfW + b.r) - Math.abs(dx);
      if (overlap > 0) {
        const side = dx < 0 ? -1 : 1; // -1 means left side of divider
        b.x += side * overlap;
        b.vx = -b.vx * dividerRestitution;
        // extra damping in catch zone to settle faster
        b.vx *= 0.9;
        b.vy *= 0.9;
      }
    }

    // gentle spring toward the center of the nearest slot (doesn't cross rails)
    const nearest = slots.reduce((best, x) => {
      const d = Math.abs(x - b.x);
      return d < best.d ? { d, x } : best;
    }, { d: Infinity, x: slots[0] });
    const k = 0.02;
    b.vx += k * (nearest.x - b.x);
  }

  // floor & settle
  const floorY = canvas.height - wall.bottom;
  if (b.y + b.r >= floorY){
    b.y = floorY - b.r;
    b.vx *= floorFriction;
    b.vy = 0;

    // stricter settle thresholds inside catch area
    const nearCenterThreshold = 0.06;                 // velocity threshold
    const snapThresholdPx = slotHalfGap * 0.55;       // must be close to slot center

    // find nearest slot
    let nearestIdx = 0, best = Infinity;
    for (let i = 0; i < slots.length; i++) {
      const d = Math.abs(slots[i] - b.x);
      if (d < best) { best = d; nearestIdx = i; }
    }

    if (Math.abs(b.vx) < nearCenterThreshold && best < snapThresholdPx) {
      b.x = slots[nearestIdx];       // snap into slot center
      b.settled = true;
      onBallSettled(b, nearestIdx);
    }
  }
}

function renderBoard(){
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // walls
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#000';
  ctx.fillRect(0,0,wall.left,canvas.height);
  ctx.fillRect(canvas.width-wall.right,0,wall.right,canvas.height);
  ctx.fillRect(0,0,canvas.width,wall.top);
  ctx.fillRect(0,canvas.height-wall.bottom,canvas.width,wall.bottom);
  ctx.globalAlpha = 1;

  // slot markers
  ctx.fillStyle = '#7c5cff';
  slots.forEach(x => ctx.fillRect(x-1, canvas.height-wall.bottom, 2, wall.bottom));

  // vertical divider rails in catch area
  ctx.fillStyle = 'rgba(124,92,255,0.85)';
  dividers.forEach(d => {
    ctx.fillRect(d.x - dividerHalfW, d.y0, dividerHalfW * 2, d.y1 - d.y0);
  });

  // pegs
  ctx.fillStyle = '#d8dcff';
  pegs.forEach(p => { ctx.beginPath(); ctx.arc(p.x,p.y,pegRadius,0,Math.PI*2); ctx.fill(); });

  // balls
  ctx.fillStyle = '#ff6b6b';
  balls.forEach(b => { ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill(); });
}

function loop(){
  balls.forEach(updateBall);
  balls = balls.filter(b => !b.settled);
  renderBoard();
  requestAnimationFrame(loop);
}

/* ---------- Game flow ---------- */
async function onBallSettled(ball, bin){
  try{
    const mult = multipliers[bin] ?? 0;
    const win = +(ball.bet * mult).toFixed(2);
    if (win > 0){
      await window.MONEY.credit(win, { game:'plinko', type:'payout', bet: ball.bet, multiplier: mult, rows: Number(rowsEl.value), risk: riskEl.value });
    }
    addRecent(bin, mult, ball.bet, win);
  }catch(e){
    console.error(e);
    setMsg(e.message || 'Payout error.');
  }finally{
    await refreshBalance();
    busy = false;
    if (autoplay > 0){
      autoplay--;
      if (autoplay === 0) autoBtn.classList.remove('active');
      setTimeout(()=> startRound(), 220);
    }
  }
}
async function startRound(){
  if (busy) return;
  setMsg('');
  const bet = Number(betEl.value);
  if (!Number.isFinite(bet) || bet <= 0) return setMsg('Enter a valid bet.');

  try{
    busy = true;
    await window.MONEY.debit(bet, { game:'plinko', type:'bet', bet, rows: Number(rowsEl.value), risk: riskEl.value });
    setupBoard();
    spawnBall(bet);
    await refreshBalance();
  }catch(e){
    busy = false;
    setMsg(e.message || 'Bet rejected.');
  }
}

/* ---------- Events ---------- */
dropBtn.addEventListener('click', () => startRound());
autoBtn.addEventListener('click', () => {
  if (busy || autoplay > 0) return;
  autoplay = 10;
  autoBtn.classList.add('active');
  startRound();
});
chips.forEach(c => c.addEventListener('click', () => {
  betEl.value = (Number(betEl.value || 0) + Number(c.dataset.plus)).toFixed(2);
}));
rowsEl.addEventListener('input', () => { rowsValEl.textContent = rowsEl.value; setupBoard(); });
riskEl.addEventListener('change', buildLegend);
rtpEl.addEventListener('input', () => { rtpValEl.textContent = `${rtpEl.value}%`; buildLegend(); });

/* ---------- Init ---------- */
(async function init(){
  if (!moneyReady()){
    console.warn('MONEY not ready; UI disabled until login/SDK present.');
  }
  resizeCanvas();
  buildLegend();
  if (moneyReady()) await refreshBalance();
  loop();
})();
