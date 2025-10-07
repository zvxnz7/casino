// ======= HARD REQUIREMENT: use the host's money methods =======
// Expects these to exist on window.MONEY (no mock here):
//   - async getBalance(): number
//   - async debit(amount:number, meta?:object)
//   - async credit(amount:number, meta?:object)

const canvas = document.getElementById('plinko');
const ctx = canvas.getContext('2d', { alpha: true });

// UI
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
const chips = [...document.querySelectorAll('.chip')];
const msgEl = document.getElementById('msg');
const recentEl = document.getElementById('recent');

// ----- State -----
let rows = Number(rowsEl.value);
let spacing = 42;
let pegRadius = 5;
let ballRadius = 6;
let gravity = 0.28;       // px/frame^2
let restitution = 0.45;   // bounce damping
let friction = 0.995;     // air drag
let wall = { left: 6, right: 6, top: 6, bottom: 26 };

let pegs = [];
let slots = [];           // x positions for bins (rows+1)
let balls = [];
let running = true;
let busy = false;
let autoplay = 0;
let multipliers = [];

// cryptographic unbiased 50/50 for nudges
function rngBool() {
  const u32 = new Uint32Array(1);
  crypto.getRandomValues(u32);
  return (u32[0] & 1) === 1;
}

// ===== Geometry / Layout =====
function setupBoard() {
  rows = Number(rowsEl.value);
  pegs.length = 0;

  const firstY = 90;
  for (let r = 0; r < rows; r++) {
    const count = r + 1;
    const offsetX = (canvas.width - count * spacing) / 2 + spacing / 2;
    const y = firstY + r * spacing;
    for (let i = 0; i < count; i++) {
      const x = offsetX + i * spacing;
      pegs.push({ x, y });
    }
  }

  // landing slots between last peg line and floor
  const count = rows + 1;
  const offsetX = (canvas.width - count * spacing) / 2 + spacing / 2;
  slots = Array.from({ length: count }, (_, i) => offsetX + i * spacing);

  buildLegend();
}

function resizeCanvas() {
  // responsive width, locked aspect feel
  const container = document.querySelector('.left').clientWidth - 28;
  const desired = Math.min(560, container);
  const aspect = 760 / 560;
  canvas.width = Math.max(420, Math.floor(desired));
  canvas.height = Math.floor(canvas.width * aspect);
  setupBoard();
}

window.addEventListener('resize', resizeCanvas);

// ===== RTP / Multipliers =====
// C(n,k) / 2^n probabilities; we normalize shaped multipliers so EV ≈ RTP
function nCk(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let num = 1, den = 1;
  for (let i = 1; i <= k; i++) { num *= (n - (k - i)); den *= i; }
  return num / den;
}
function generateMultipliers(n, risk, rtpPct) {
  const probs = Array.from({ length: n + 1 }, (_, k) => nCk(n, k) / Math.pow(2, n));
  const center = n / 2;
  const beta = risk === 'high' ? 0.95 : risk === 'medium' ? 0.60 : 0.32;
  const shape = probs.map((_, k) => Math.exp(beta * Math.abs(k - center))); // >1 at edges
  const rtp = rtpPct / 100;
  const shapeEV = shape.reduce((s, sk, k) => s + probs[k] * sk, 0);
  const c = rtp / shapeEV;
  return shape.map(sk => +(Math.max(0.01, c * sk).toFixed(sk * c >= 10 ? 2 : 3)));
}
function buildLegend() {
  const risk = riskEl.value;
  const rtp = Number(rtpEl.value);
  multipliers = generateMultipliers(rows, risk, rtp);

  legendEl.innerHTML = '';
  multipliers.forEach((m, i) => {
    const node = document.createElement('div');
    node.className = 'cell';
    node.innerHTML = `<strong>${m}×</strong><span>Bin ${i}</span>`;
    legendEl.appendChild(node);
  });
}

// ===== Money / UI =====
async function refreshBalance() {
  try {
    const bal = await window.MONEY.getBalance();
    balanceEl.textContent = Number(bal).toFixed(2);
  } catch (e) {
    balanceEl.textContent = 'ERR';
    console.error(e);
  }
}
function setMsg(text, isError = true) {
  msgEl.textContent = text || '';
  msgEl.style.color = isError ? 'var(--bad)' : 'var(--ok)';
}
function addRecent(bin, mult, bet, win) {
  const li = document.createElement('li');
  li.innerHTML = `
    <span>Bin ${bin}</span>
    <span class="mult">${mult}×</span>
    <strong class="${win > 0 ? 'win' : 'loss'}">${win > 0 ? `+${win.toFixed(2)}` : `-${bet.toFixed(2)}`}</strong>
  `;
  recentEl.prepend(li);
  while (recentEl.children.length > 20) recentEl.removeChild(recentEl.lastChild);
}

// ===== Physics =====
function spawnBall(bet) {
  const x = canvas.width / 2;
  balls.push({
    x, y: 30,
    vx: 0, vy: 0,
    r: ballRadius,
    bet,
    settled: false,
    pegCooldown: 0 // small cooldown to avoid rapid re-hit
  });
}

function updateBall(b) {
  // gravity & drag
  b.vy += gravity;
  b.vx *= friction;
  b.vy *= friction;

  // movement
  b.x += b.vx;
  b.y += b.vy;

  // walls
  if (b.x - b.r < wall.left) {
    b.x = wall.left + b.r; b.vx *= -restitution;
  }
  if (b.x + b.r > canvas.width - wall.right) {
    b.x = canvas.width - wall.right - b.r; b.vx *= -restitution;
  }
  if (b.y - b.r < wall.top) {
    b.y = wall.top + b.r; b.vy *= -restitution;
  }

  // peg collisions (circle-circle)
  // limit checks to nearby rows for perf: only pegs within vertical window
  const pegWindow = spacing + 8;
  for (let i = 0; i < pegs.length; i++) {
    const p = pegs[i];
    if (Math.abs(b.y - p.y) > pegWindow) continue;

    const dx = b.x - p.x;
    const dy = b.y - p.y;
    const dist2 = dx*dx + dy*dy;
    const min = b.r + pegRadius;

    if (dist2 < min*min) {
      const dist = Math.sqrt(dist2) || 0.0001;
      const nx = dx / dist, ny = dy / dist; // collision normal

      // separate
      const overlap = (min - dist) + 0.2;
      b.x += nx * overlap;
      b.y += ny * overlap;

      // reflect velocity
      const vn = b.vx * nx + b.vy * ny;
      const vxr = b.vx - (1 + restitution) * vn * nx;
      const vyr = b.vy - (1 + restitution) * vn * ny;
      b.vx = vxr;
      b.vy = vyr;

      // add a tiny left/right nudge to enforce a fair bifurcation
      // (doesn't bias distribution; just breaks symmetry)
      const nudge = 0.65;
      b.vx += rngBool() ? nudge : -nudge;

      // cooldown to prevent multi-hit with same peg
      b.pegCooldown = 2;
    }
  }
  if (b.pegCooldown > 0) b.pegCooldown--;

  // floor / slots
  const floorY = canvas.height - wall.bottom;
  if (b.y + b.r >= floorY) {
    // settle if slow enough or sufficiently below pegs
    b.y = floorY - b.r;

    // slow horizontal friction on floor
    b.vx *= 0.94;
    b.vy = 0;

    // if velocity is tiny, finalize to nearest slot
    if (Math.abs(b.vx) < 0.08) {
      // snap to the closest slot center
      let nearest = 0, best = Infinity;
      for (let i = 0; i < slots.length; i++) {
        const d = Math.abs(slots[i] - b.x);
        if (d < best) { best = d; nearest = i; }
      }
      b.x = slots[nearest];
      b.settled = true;
      onBallSettled(b, nearest);
    }
  }
}

function renderBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // walls & top bar
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, wall.left, canvas.height);
  ctx.fillRect(canvas.width - wall.right, 0, wall.right, canvas.height);
  ctx.fillRect(0, 0, canvas.width, wall.top);

  // slots baseline
  ctx.globalAlpha = 0.25;
  ctx.fillRect(0, canvas.height - wall.bottom, canvas.width, wall.bottom);
  ctx.globalAlpha = 1;

  // slot markers
  ctx.fillStyle = '#7c5cff';
  slots.forEach(x => {
    ctx.fillRect(x - 1, canvas.height - wall.bottom, 2, wall.bottom);
  });

  // pegs
  ctx.fillStyle = '#d8dcff';
  pegs.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, pegRadius, 0, Math.PI * 2);
    ctx.fill();
  });

  // balls
  ctx.fillStyle = '#ff6b6b';
  balls.forEach(b => {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  });
}

function loop() {
  if (running) {
    balls.forEach(updateBall);
    // prune settled balls
    balls = balls.filter(b => !b.settled);
    renderBoard();
    requestAnimationFrame(loop);
  }
}

// ===== Game flow =====
async function onBallSettled(ball, binIndex) {
  try {
    const mult = multipliers[binIndex] ?? 0;
    const win = +(ball.bet * mult).toFixed(2);
    if (win > 0) {
      await window.MONEY.credit(win, {
        game: 'plinko', type: 'payout', bet: ball.bet, multiplier: mult, rows, risk: riskEl.value
      });
    }
    addRecent(binIndex, mult, ball.bet, win);
  } catch (e) {
    console.error(e);
    setMsg(e.message || 'Payout error.');
  } finally {
    await refreshBalance();
    busy = false;

    if (autoplay > 0) {
      autoplay--;
      if (autoplay === 0) autoBtn.classList.remove('active');
      setTimeout(() => { startRound(); }, 220);
    }
  }
}

async function startRound() {
  if (busy) return;
  setMsg('');
  const bet = Number(betEl.value);
  if (!Number.isFinite(bet) || bet <= 0) return setMsg('Enter a valid bet.');

  try {
    busy = true;
    // Debit first (casino style)
    await window.MONEY.debit(bet, { game:'plinko', type:'bet', bet, rows, risk:riskEl.value });

    // make sure board (rows / risk / rtp) is up to date
    setupBoard();

    spawnBall(bet);
    await refreshBalance();
  } catch (e) {
    busy = false;
    setMsg(e.message || 'Bet rejected.');
  }
}

// ===== Event wiring =====
dropBtn.addEventListener('click', () => startRound());
autoBtn.addEventListener('click', () => {
  if (busy || autoplay > 0) return;
  autoplay = 10;
  autoBtn.classList.add('active');
  startRound();
});
chips.forEach(b => b.addEventListener('click', () => {
  const inc = Number(b.dataset.plus);
  betEl.value = (Number(betEl.value || 0) + inc).toFixed(2);
}));

rowsEl.addEventListener('input', () => {
  rowsValEl.textContent = rowsEl.value;
  setupBoard();
});
riskEl.addEventListener('change', buildLegend);
rtpEl.addEventListener('input', () => {
  rtpValEl.textContent = `${rtpEl.value}%`;
  buildLegend();
});

// ===== Init =====
(async function init(){
  if (!window.MONEY || typeof window.MONEY.getBalance !== 'function' ||
      typeof window.MONEY.debit !== 'function' || typeof window.MONEY.credit !== 'function') {
    setMsg('Missing MONEY methods on window.MONEY (getBalance/debit/credit).');
  }
  resizeCanvas();
  buildLegend();
  await refreshBalance();
  loop();
})();
