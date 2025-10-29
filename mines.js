/* ==========================================================
   Mines — images fixed via inline SVGs; adjustable mines; color-coded feed
========================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyCbSyocu6e8t7UTLJ4VBwULgBxt38ggw1k",
  authDomain: "casino777-7.firebaseapp.com",
  projectId: "casino777-7",
  storageBucket: "casino777-7.appspot.com",
  messagingSenderId: "824259346500",
  appId: "1:824259346500:web:1ace23689863864cc23c11",
  measurementId: "G-LHMDCMRY9E"
};
if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
const db = firebase.firestore();

const backBTN       = document.getElementById('backBtn');
const cells         = [...document.querySelectorAll('[data-cell]')];
const betButton     = document.getElementById('betButton');
const betAmountEl   = document.getElementById('betAmount');
const moneyAmountEl = document.getElementById('moneyAmount');
const multiplierEl  = document.getElementById('multiplier');
const msgEl         = document.getElementById('msg');
const feedEl        = document.getElementById('feed');

const minesRange    = document.getElementById('minesRange');
const minesNum      = document.getElementById('minesNum');

const GRID = 25; // 5x5
let username   = localStorage.getItem('username') || null;
let wallet     = 0;
let inRound    = false;
let betAmount  = 0;
let mines      = Number(minesRange.value) || 5;
let bombMask   = new Array(GRID).fill(0);
let revealedSafe = 0;
let multiplier = 1;

const RTP = 0.97; // house return target

/* ---------- Inline SVGs so icons ALWAYS display ---------- */
const BOMB_SVG = `data:image/svg+xml;utf8,
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
  <defs><radialGradient id='g' cx='30' cy='30' r='28'>
    <stop offset='0' stop-color='%23555'/>
    <stop offset='1' stop-color='%23111'/>
  </radialGradient></defs>
  <circle cx='30' cy='36' r='22' fill='url(%23g)'/>
  <rect x='36' y='10' width='14' height='8' rx='2' fill='%23333'/>
  <path d='M50 12c6-8 10-4 6 4' stroke='%23ff6b6b' stroke-width='3' fill='none' stroke-linecap='round'/>
</svg>`.replace(/\n|\s{2,}/g,'');
const GEM_SVG = `data:image/svg+xml;utf8,
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
  <polygon points='32,6 6,24 18,58 46,58 58,24' fill='%2325d2b7' />
  <polyline points='32,6 32,58' stroke='white' stroke-width='2' fill='none' opacity='.6'/>
  <polyline points='6,24 58,24' stroke='white' stroke-width='2' fill='none' opacity='.4'/>
</svg>`.replace(/\n|\s{2,}/g,'');

/* ---------- Helpers ---------- */
const fmt = v => {
  const n = Number(v)||0;
  if (n >= 1e9) return (Math.floor(n/1e7)/100).toFixed(2)+'B';
  if (n >= 1e6) return (Math.floor(n/1e4)/100).toFixed(2)+'M';
  if (n >= 1e3) return (Math.floor(n/10)/100).toFixed(2)+'K';
  return n.toFixed(2);
};
const setMsg = t => msgEl.textContent = t || '';

/* ---------- Firestore Wallet ---------- */
async function userRef(){
  const q = await db.collection('users').where('username','==',username).limit(1).get();
  if (q.empty) throw new Error('Username not found.');
  return q.docs[0].ref;
}
async function refreshMoney(){
  const ref = await userRef();
  const snap = await ref.get();
  wallet = Number((snap.data()||{}).money ?? 0);
  moneyAmountEl.textContent = fmt(wallet);
}
async function debit(amount){
  const ref = await userRef();
  await db.runTransaction(async tx=>{
    const s = await tx.get(ref);
    const cur = Number((s.data()||{}).money ?? 0);
    if (cur < amount) throw new Error('Insufficient funds.');
    tx.update(ref, { money: +(cur - amount).toFixed(2) });
  });
}
async function credit(amount){
  const ref = await userRef();
  await db.runTransaction(async tx=>{
    const s = await tx.get(ref);
    const cur = Number((s.data()||{}).money ?? 0);
    tx.update(ref, { money: +(cur + amount).toFixed(2) });
  });
}

/* ---------- Mines Control ---------- */
function setMinesUI(v){
  v = Math.max(1, Math.min(24, Number(v)||5));
  minesRange.value = v;
  minesNum.value   = v;
  mines = v;
}
function lockMinesControls(locked){
  minesRange.disabled = locked;
  minesNum.disabled   = locked;
  minesRange.style.opacity = locked ? .5 : 1;
  minesNum.style.opacity   = locked ? .5 : 1;
}
minesRange.addEventListener('input', () => { if (!inRound) setMinesUI(minesRange.value); });
minesNum.addEventListener('input',   () => { if (!inRound) setMinesUI(minesNum.value); });

/* ---------- Game Core ---------- */
function resetBoard(){
  bombMask.fill(0);
  revealedSafe = 0;
  multiplier = 1;
  multiplierEl.textContent = '1';
  setMsg('');
  cells.forEach(c=>{
    c.className = 'cell';
    c.style.backgroundImage = '';
  });
}
function shuffleBombs(n){
  const idx = [...Array(GRID).keys()];
  for (let i=idx.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [idx[i],idx[j]] = [idx[j],idx[i]];
  }
  bombMask.fill(0);
  for (let i=0;i<n;i++) bombMask[idx[i]] = 1;
}
/* Multiplier: product of odds of staying safe for each pick, times RTP */
function calcMultiplier(safe, N=GRID, M=mines){
  if (safe <= 0) return 1;
  let prod = 1;
  for (let i=0;i<safe;i++){
    prod *= ( (N - i) / (N - M - i) );
  }
  return +(Math.max(1, prod * RTP)).toFixed(prod>=10 ? 2 : 3);
}
function revealAll(){
  cells.forEach((cell,i)=>{
    if (bombMask[i]){ cell.style.backgroundImage = `url("${BOMB_SVG}")`; cell.classList.add('red'); }
    else { cell.style.backgroundImage = `url("${GEM_SVG}")`; cell.classList.add('blue'); }
  });
}

/* ---------- Rounds ---------- */
async function onPlaceBet(){
  await refreshMoney();
  if (inRound) return;
  betAmount = Math.floor(Number(betAmountEl.value));
  if (!Number.isFinite(betAmount) || betAmount<=0) return setMsg('Invalid bet');
  if (betAmount > wallet) return setMsg('Insufficient funds');

  setMinesUI(minesRange.value); // capture UI value
  lockMinesControls(true);
  await debit(betAmount);
  await refreshMoney();

  resetBoard();
  shuffleBombs(mines);
  inRound = true;
  betButton.textContent = 'Cash out';
  setMsg(`Pick tiles — ${mines} mines`);
}
async function onCashOut(){
  if (!inRound) return;
  const payout = +(betAmount * multiplier).toFixed(2);
  await credit(payout);
  await refreshMoney();

  revealAll();
  inRound = false;
  betButton.textContent = 'Place bet';
  lockMinesControls(false);
  setMsg(`Cashed out +$${payout}`);
}

/* ---------- Clicks ---------- */
function onCellClick(e){
  if (!inRound) return;
  const cell = e.currentTarget;
  const idx  = cells.indexOf(cell);
  if (cell.classList.contains('win') || cell.classList.contains('red') || cell.classList.contains('blue')) return;

  if (bombMask[idx]){
    cell.style.backgroundImage = `url("${BOMB_SVG}")`;
    cell.classList.add('red','gameover');
    revealAll();
    inRound = false;
    betButton.textContent = 'Place bet';
    lockMinesControls(false);
    setMsg('💥 Boom!');
  } else {
    cell.style.backgroundImage = `url("${GEM_SVG}")`;
    cell.classList.add('win');
    revealedSafe++;
    multiplier = calcMultiplier(revealedSafe);
    multiplierEl.textContent = String(multiplier);
  }
}

/* ---------- Winners Feed (color-coded + non-scroll) ---------- */
const NAMES = [
  'NeonWolf','DriftRogue','LunaByte','RiftRunner','EchoFrost','Kairo','Blitz','Ash','NightOwl',
  'Vexa','Jetstream','Lilith','CrimsonFox','AstraNova','ZeroPhase','ToxicNeko','MintyMara','Valkyrie',
  'NovaApex','ArtemisGG','SolarMist','KitsuneQT','OrbitZed','ZenithX','ByteBlade','BlueNyx'
];
const rand   = (a,b)=>Math.random()*(b-a)+a;
const choice = a=>a[Math.floor(Math.random()*a.length)];
function tierForWin(amount){
  if (amount >= 150) return 'huge';
  if (amount >= 50)  return 'large';
  if (amount >= 15)  return 'medium';
  return 'small';
}
function fakeWinItem(){
  const name = choice(NAMES);
  const bet  = +(rand(0.5, 20)).toFixed(2);
  const mult = Math.random()<0.10 ? +(rand(5,12)).toFixed(2)
             : Math.random()<0.50 ? +(rand(2,5)).toFixed(2)
             : +(rand(1.1,2)).toFixed(2);
  const total = +(bet * mult).toFixed(2);
  const li = document.createElement('li');
  li.className = `feed-item ${tierForWin(total)}`;
  li.innerHTML = `<span class="who">${name}</span><span class="win">+$${total.toFixed(2)}</span>`;
  return li;
}
function startFeed(){
  for (let i=0;i<8;i++){
    const li = fakeWinItem(); feedEl.appendChild(li);
    requestAnimationFrame(()=> li.classList.add('show'));
  }
  setInterval(()=>{
    const li = fakeWinItem();
    feedEl.prepend(li);
    requestAnimationFrame(()=> li.classList.add('show'));
    while (feedEl.children.length > 35) feedEl.removeChild(feedEl.lastChild);
  }, Math.floor(rand(450, 900)));
}

/* ---------- Events ---------- */
backBTN.addEventListener('click', ()=> location.href = 'games.html');
cells.forEach(c => c.addEventListener('click', onCellClick));
betButton.addEventListener('click', () => {
  setMsg('');
  if (!inRound) onPlaceBet(); else onCashOut();
});

/* ---------- Init ---------- */
(async function init(){
  if (!username){ setMsg('Please log in first.'); return; }
  await refreshMoney();
  if (!betAmountEl.value) betAmountEl.value = Math.max(1, Math.floor(wallet * 0.01));
  setMinesUI(minesRange.value);     // sync slider/number
  startFeed();                      // start winners ticker
})();
