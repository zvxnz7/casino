/* -------------------------------------------------
   Casino Plinko — New physics + lifted buckets + wider layout
   Uses firebase via your existing app.js. Include app.js BEFORE this file.
--------------------------------------------------- */

/* ===== Firestore MONEY adapter with guards ===== */
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
  try {
    if (!window.firebase || !firebase.apps) return disableUI('Load Firebase SDKs first.');
    if (!firebase.apps.length) return disableUI('Initialize Firebase in app.js before plinko.js.');
    const USERNAME = localStorage.getItem('username');
    if (!USERNAME) return disableUI('Log in first (username missing).');

    const db = firebase.firestore();
    let userDocRef = null;
    async function ref(){
      if (userDocRef) return userDocRef;
      const q = await db.collection('users').where('username','==',USERNAME).limit(1).get();
      if (q.empty) throw new Error('Username not found.');
      userDocRef = q.docs[0].ref; return userDocRef;
    }
    const r2 = n => Math.round(n*100)/100;

    async function getBalance(){ const d = await (await ref()).get(); return Number((d.data()||{}).money ?? 0); }
    async function debit(amount){
      amount = Number(amount); if (!(amount>0)) throw new Error('Invalid bet');
      const R = await ref(); await db.runTransaction(async tx=>{
        const s = await tx.get(R); const cur = Number((s.data()||{}).money ?? 0);
        if (cur < amount) throw new Error('Insufficient funds.');
        tx.update(R, { money: r2(cur-amount) });
      });
    }
    async function credit(amount){
      amount = Number(amount); if (!(amount>=0)) throw new Error('Invalid payout');
      const R = await ref(); await db.runTransaction(async tx=>{
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

/* -------------------------------------------------
   Physics (redone)
--------------------------------------------------- */
// board sizing
const SIDE_PAD = 22;           // left/right inside canvas
const TOP_Y = 80;              // first row
const BUCKET_H = 56;           // bucket height
const GAP_TO_BUCKETS = 26;     // gap from last row to top of buckets (moved UP)
const LABEL_OFFSET = 16;       // multiplier text vertical offset inside bucket
const MAX_CANVAS_W = 860;      // wider

let rows = Number(rowsEl.value);
let spacing = 46;              // recalculated per layout
const MIN_SPACING = 34;
const MAX_SPACING = 60;

// balls/pegs
const pegRadius = 5;
const ballRadius = 6;

// new dynamics
let gravity = 0.44;            // faster drop
let restitution = 0.18;        // soft peg bounce
let air = 0.992;               // global drag (semi-implicit)
let pegTangent = 0.85;         // tangential damping on peg hit
let wallDamping = 0.62;        // extra damp on side walls
let maxSpeed = 9.5;            // cap for numerical stability
let centerPull = 0.004;        // gentle global pull to midline

const wall = { left: 6, right: 6, top: 6, bottom: 26 };

/* buckets & geometry */
let pegs = [];
let slots = [];                // slot centers
let buckets = [];              // {x,y,w,h,index,color}
let balls = [];
let multipliers = [];
const MAX_CONCURRENT = 36;

/* RNG */
function rngBool(){ const u = new Uint32Array(1); crypto.getRandomValues(u); return (u[0] & 1)===1; }

/* -------------------------------------------------
   Combinatorics / multipliers
--------------------------------------------------- */
function nCk(n,k){ if(k<0||k>n)return 0; if(k===0||k===n)return 1; k=Math.min(k,n-k);
  let num=1,den=1; for(let i=1;i<=k;i++){ num*= (n-(k-i)); den*=i; } return num/den; }
function generateMultipliers(n, risk, rtpPct){
  const probs = Array.from({length:n+1},(_,k)=> nCk(n,k)/Math.pow(2,n));
  const center = n/2;
  const beta = risk==='high'?0.95:risk==='medium'?0.62:0.35;   // redesigned curves
  const shape = probs.map((_,k)=> Math.pow(1.0 + Math.abs(k-center), beta));
  const rtp = rtpPct/100;
  const shapeEV = shape.reduce((s,sk,k)=> s + probs[k]*sk, 0);
  const c = rtp / shapeEV;
  return shape.map(sk => +Math.max(0.01, c*sk).toFixed(sk*c>=10?2:3));
}

/* -------------------------------------------------
   Layout (auto spacing, buckets moved up)
--------------------------------------------------- */
function computeSpacing(){
  const n = Number(rowsEl.value);
  const cols = n + 1;

  // width fit
  const usableW = canvas.width - 2*SIDE_PAD;
  const sX = usableW / cols;

  // height fit: top -> rows -> gap -> buckets -> bottom wall
  const bucketTop = TOP_Y + n*spacing + GAP_TO_BUCKETS;
  const catchH = BUCKET_H + GAP_TO_BUCKETS;
  const usableH = canvas.height - TOP_Y - (catchH + wall.bottom);
  const sY = usableH / n;

  spacing = Math.max(MIN_SPACING, Math.min(MAX_SPACING, Math.floor(Math.min(sX, sY || MAX_SPACING))));
}

function setupBoard(){
  rows = Number(rowsEl.value);
  computeSpacing();

  // pegs
  pegs.length = 0;
  for (let r=0; r<rows; r++){
    const count = r+1;
    const boardW = canvas.width - 2*SIDE_PAD;
    const offsetX = SIDE_PAD + (boardW - count*spacing)/2 + spacing/2;
    const y = TOP_Y + r*spacing;
    for (let i=0;i<count;i++) pegs.push({ x: offsetX + i*spacing, y });
  }

  // slots
  const count = rows + 1;
  const boardW = canvas.width - 2*SIDE_PAD;
  const offsetX = SIDE_PAD + (boardW - count*spacing)/2 + spacing/2;
  slots = Array.from({length:count}, (_,i)=> offsetX + i*spacing);

  // buckets aligned to slot centers, lifted up
  const bucketTop = Math.min(
    canvas.height - wall.bottom - BUCKET_H - 6,
    TOP_Y + rows*spacing + GAP_TO_BUCKETS
  );

  buckets.length = 0;
  for (let i=0;i<slots.length;i++){
    const left = (i===0) ? (slots[i] - spacing/2) : (slots[i-1] + slots[i])/2;
    const right = (i===slots.length-1) ? (slots[i] + spacing/2) : (slots[i] + slots[i+1])/2;
    const w = right - left;
    buckets.push({
      x:left, y:bucketTop, w, h:BUCKET_H, index:i, color:bucketColor(i, slots.length)
    });
  }

  buildLegend();
}

function bucketColor(i, n){
  const center = (n-1)/2; const d = Math.abs(i-center)/center;
  const stops = [
    {t:0.00, c:'#FFC73A'},  // center yellow
    {t:0.35, c:'#FF9E2E'},  // orange
    {t:0.70, c:'#FF6A3A'},  // deeper orange-red
    {t:1.00, c:'#FF4D4D'}   // edges red
  ];
  // simple piecewise
  if (d<=0.35) return stops[0].c;
  if (d<=0.70) return stops[1].c;
  if (d<=1.00) return stops[2].c;
  return stops[3].c;
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
   New physics step (semi-implicit, capped, center-seeking)
--------------------------------------------------- */
function spawnBall(bet, xJitter=0){
  if (balls.length >= MAX_CONCURRENT) return;
  balls.push({ x: canvas.width/2 + xJitter, y: 26, vx: 0, vy: 0, r: ballRadius, bet });
}

function updateBall(b){
  // add gravity + global center pull
  b.vy += gravity;
  b.vx += centerPull * ((canvas.width/2) - b.x);

  // integrate (semi-implicit)
  b.vx *= air; b.vy *= air;
  // speed cap
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > maxSpeed){ const s = maxSpeed / sp; b.vx *= s; b.vy *= s; }
  b.x += b.vx; b.y += b.vy;

  // walls with heavy side damping
  if (b.x - b.r < wall.left){ b.x = wall.left + b.r; b.vx *= -restitution*wallDamping; }
  if (b.x + b.r > canvas.width - wall.right){ b.x = canvas.width - wall.right - b.r; b.vx *= -restitution*wallDamping; }
  if (b.y - b.r < wall.top){ b.y = wall.top + b.r; b.vy *= -restitution; }

  // peg collisions with tangential damping + tiny unbiased nudge
  const near = spacing + 8;
  for (const p of pegs){
    if (Math.abs(b.y - p.y) > near) continue;
    const dx=b.x-p.x, dy=b.y-p.y, min=b.r+pegRadius, d2=dx*dx+dy*dy;
    if (d2 < min*min){
      const d = Math.sqrt(d2)||1e-4, nx=dx/d, ny=dy/d;
      // separate
      const overlap = min - d + 0.25;
      b.x += nx*overlap; b.y += ny*overlap;

      // resolve normal impulse
      const vn = b.vx*nx + b.vy*ny;
      const vt = b.vx*(-ny) + b.vy*(nx); // tangential
      // reflect normal with restitution; damp tangential
      const newVn = -vn * restitution;
      const newVt = vt * pegTangent;

      // back to x,y
      b.vx = newVn*nx + newVt*(-ny);
      b.vy = newVn*ny + newVt*( nx);

      // micro randomness (smaller)
      b.vx += (rngBool()? 0.22 : -0.22);
    }
  }

  // bucket contact: pay & remove immediately
  const contactY = TOP_Y + rows*spacing + Math.max(6, GAP_TO_BUCKETS - 6); // a bit higher
  if (b.y + b.r >= contactY){
    for (const k of buckets){
      if (b.x >= k.x && b.x <= k.x + k.w){
        onBallBucket(b, k.index);
        b.y = 1e9; // kill
        break;
      }
    }
  }
}

/* -------------------------------------------------
   Render (wider & cleaner)
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

  // soft inner border
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#000';
  ctx.fillRect(0,0,wall.left,canvas.height);
  ctx.fillRect(canvas.width-wall.right,0,wall.right,canvas.height);
  ctx.fillRect(0,0,canvas.width,wall.top);
  ctx.globalAlpha = 1;

  // buckets (rounded, lifted)
  for (let i=0;i<buckets.length;i++){
    const b = buckets[i];
    const color = b.color;
    // base
    ctx.fillStyle = color;
    roundRect(b.x, b.y, b.w, b.h, 8);
    ctx.fill();
    // glow top line
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(b.x, b.y, b.w, 2);
    ctx.globalAlpha = 1;

    // label
    ctx.fillStyle = '#09131a';
    ctx.font = 'bold 12px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.textAlign = 'center';
    ctx.fillText(`${multipliers[i]}×`, b.x + b.w/2, b.y + b.h/2 + 4);
  }

  // pegs with subtle shadow
  ctx.fillStyle = 'rgba(216,220,255,0.95)';
  pegs.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x,p.y,pegRadius,0,Math.PI*2);
    ctx.fill();
  });

  // balls (radial-ish look)
  balls.forEach(b => {
    const g = ctx.createRadialGradient(b.x-2,b.y-2,1,b.x,b.y,b.r+1);
    g.addColorStop(0,'#ffd1d1');
    g.addColorStop(1,'#ff6b6b');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x,b.y,b.r,0,Math.PI*2);
    ctx.fill();
  });

  // bottom bar
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, canvas.height - wall.bottom, canvas.width, wall.bottom);
  ctx.globalAlpha = 1;
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
      await window.MONEY.credit(win, { game:'plinko', type:'payout', bet: ball.bet, multiplier: mult, rows, risk: riskEl.value });
    }
    addRecent(binIndex, mult, ball.bet, win);
  }catch(e){ console.error(e); setMsg(e.message || 'Payout error.'); }
  finally{ try{ await refreshBalance(); }catch{} }
}

/* -------------------------------------------------
   Drop logic (multi)
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
    // spread launch across width & a few frames so they don't merge
    for (let i=0;i<count;i++){
      const jitter = (Math.random()-0.5) * spacing * 0.7;
      spawnBall(bet, jitter);
    }
    await refreshBalance();
  }catch(e){ setMsg(e.message || 'Bet rejected.'); }
}

/* -------------------------------------------------
   Legend + multipliers
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
   Events / responsive
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
function resizeCanvas(){
  const container = (document.querySelector('.left')?.clientWidth || MAX_CANVAS_W) - 32;
  const desired = Math.min(MAX_CANVAS_W, container);
  const aspect = 700 / 860; // keep it wide
  canvas.width = Math.max(640, Math.floor(desired));
  canvas.height = Math.floor(canvas.width * aspect);
  setupBoard();
}
window.addEventListener('resize', () => {
  if (resizeRAF) cancelAnimationFrame(resizeRAF);
  resizeRAF = requestAnimationFrame(resizeCanvas);
});

/* -------------------------------------------------
   Init
--------------------------------------------------- */
(async function init(){
  resizeCanvas();            // also calls setupBoard()
  buildLegend();
  try { await refreshBalance(); } catch {}
  loop();
})();
