/* ==========================================================
   Mines — adjustable mines + winners feed + responsive UI
   - Uses localStorage.username
   - Firestore transactions for wallet
   - Fair-ish multipliers derived from combinatorics with RTP
========================================================== */

/* ---------- Firebase init ---------- */
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

/* ---------- DOM ---------- */
const backBTN = document.getElementById('backBtn');
const cells = [...document.querySelectorAll('[data-cell]')];
const betButton = document.getElementById('betButton');
const betAmountEl = document.getElementById('betAmount');
const moneyAmountEl = document.getElementById('moneyAmount');
const multiplierEl = document.getElementById('multiplier');
const msgEl = document.getElementById('msg');
const minesInput = document.getElementById('minesInput');
const minesVal = document.getElementById('minesVal');
const feedEl = document.getElementById('feed');

/* ---------- State ---------- */
const GRID = 25; // 5x5 fixed grid
let username = localStorage.getItem('username') || null;

let wallet = 0;
let inRound = false;
let betAmount = 0;
let mines = Number(minesInput.value) || 5;
let bombMask = new Array(GRID).fill(0);
let revealedSafe = 0;
let multiplier = 1;

// RTP (house edge) — tune 94..99 (%)
const RTP = 0.97;

/* ---------- Helpers ---------- */
const fmt = v => {
  const n = Number(v)||0;
  if (n >= 1e9) return (Math.floor(n/1e7)/100).toFixed(2).replace(/\.00$/,'')+'B';
  if (n >= 1e6) return (Math.floor(n/1e4)/100).toFixed(2).replace(/\.00$/,'')+'M';
  if (n >= 1e3) return (Math.floor(n/10)/100).toFixed(2).replace(/\.00$/,'')+'K';
  return n.toFixed(2);
};
function setMsg(t){ msgEl.textContent = t || ''; }

/* ---------- Firestore wallet ---------- */
async function userRef(){
  if (!username) throw new Error('No username (log in first)');
  const q = await db.collection('users').where('username','==',username).limit(1).get();
  if (q.empty) throw new Error('Username not found.');
  return q.docs[0].ref;
}
async function refreshMoney(){
  try{
    const ref = await userRef();
    const snap = await ref.get();
    wallet = Number((snap.data()||{}).money ?? 0);
    moneyAmountEl.textContent = fmt(wallet);
  }catch(e){ setMsg(e.message || 'Wallet error'); }
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

/* ---------- Game core ---------- */
function resetBoard(){
  bombMask = new Array(GRID).fill(0);
  revealedSafe = 0;
  multiplier = 1;
  multiplierEl.textContent = '1';
  setMsg('');
  cells.forEach(c=>{
    c.classList.remove('win','red','blue','gameover');
    c.style.backgroundImage = '';
  });
}
function shuffleBombs(nBombs){
  const idx = [...Array(GRID).keys()];
  for (let i=idx.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [idx[i],idx[j]] = [idx[j],idx[i]];
  }
  bombMask.fill(0);
  for (let i=0;i<nBombs;i++) bombMask[idx[i]] = 1;
}

/* Fair-ish multiplier:
   After s safe picks with M mines on N cells:
   payout multiplier (100% RTP) = Π_{i=0..s-1} ( (N - i) / (N - M - i) )
   We then multiply by RTP (<1).
*/
function calcMultiplier(safeOpens, totalCells=GRID, mineCount=mines){
  if (safeOpens <= 0) return 1;
  let prod = 1;
  for (let i=0;i<safeOpens;i++){
    prod *= ( (totalCells - i) / (totalCells - mineCount - i) );
  }
  const m = Math.max(1, prod * RTP);
  return +m.toFixed(m>=10 ? 2 : 3);
}

function revealAll(){
  cells.forEach((cell, i)=>{
    if (bombMask[i] === 1){ cell.style.backgroundImage = "url('bomb.png')"; cell.classList.add('red'); }
    else { cell.style.backgroundImage = "url('gem.png')"; cell.classList.add('blue'); }
  });
}

/* ---------- Round flow ---------- */
async function onPlaceBet(){
  try{
    await refreshMoney();
    if (inRound) return;
    betAmount = Math.floor(Number(betAmountEl.value));
    if (!Number.isFinite(betAmount) || betAmount<=0) return setMsg('Enter a valid bet');
    if (betAmount > wallet) return setMsg('Insufficient funds');

    // lock mines at round start
    mines = Math.max(1, Math.min(24, Number(minesInput.value)||5));
    minesInput.disabled = true;

    await debit(betAmount);
    await refreshMoney();

    resetBoard();
    shuffleBombs(mines);
    inRound = true;
    betButton.textContent = 'Cash out';
    setMsg(`Pick tiles! Mines: ${mines}`);
  }catch(e){
    setMsg(e.message || 'Bet failed');
  }
}
async function onCashOut(){
  try{
    if (!inRound) return;
    const payout = +(betAmount * multiplier).toFixed(2);
    await credit(payout);
    await refreshMoney();

    revealAll();
    inRound = false;
    betButton.textContent = 'Place bet';
    minesInput.disabled = false;
    setMsg(`Cashed out: +$${payout.toFixed(2)}`);
  }catch(e){
    setMsg(e.message || 'Cashout failed');
  }
}

/* ---------- Click handling ---------- */
function onCellClick(e){
  if (!inRound) return;
  const cell = e.currentTarget;
  const idx = cells.indexOf(cell);
  if (idx < 0) return;
  // ignore already revealed
  if (cell.classList.contains('win') || cell.classList.contains('red') || cell.classList.contains('blue')) return;

  if (bombMask[idx] === 1){
    // BOOM — round ends, no payout
    cell.style.backgroundImage = "url('bomb.png')";
    cell.classList.add('red','gameover');
    revealAll();
    inRound = false;
    betButton.textContent = 'Place bet';
    minesInput.disabled = false;
    setMsg('Boom! Better luck next round.');
  } else {
    // Safe
    cell.style.backgroundImage = "url('gem.png')";
    cell.classList.add('win');
    revealedSafe++;
    multiplier = calcMultiplier(revealedSafe, GRID, mines);
    multiplierEl.textContent = String(multiplier);
  }
}

/* ---------- Winners feed (fake) ---------- */
const NAMES = [
  'NeonWolf','Pixie','Orbit','Luna','Ghost','Riley','Kade','Nova','Vera','Kai',
  'Blitz','Ash','Zed','Echo','Milo','Nika','Ivy','Lex','Rune','Skye'
];
function rand(min,max){ return Math.random()*(max-min)+min; }
function choice(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function fakeWinItem(){
  const name = choice(NAMES);
  const m = Math.random()<0.3 ? +(rand(3,8)).toFixed(2) : +(rand(1.2,3)).toFixed(2);
  const amt = +(rand(2,50)).toFixed(2);
  const total = +(amt*m).toFixed(2);
  const bombs = Math.floor(rand(2,18));
  const li = document.createElement('li');
  li.innerHTML = `<span class="who">${name}</span><span class="win">+$${total.toFixed(2)}</span>`;
  li.title = `Mines: ${bombs} • ${m}x`;
  return li;
}
function startFeed(){
  // seed a few
  for(let i=0;i<6;i++){ feedEl.appendChild(fakeWinItem()); }
  setInterval(()=>{
    const li = fakeWinItem();
    feedEl.prepend(li);
    while (feedEl.children.length > 20) feedEl.removeChild(feedEl.lastChild);
  }, Math.floor(rand(1400, 2600)));
}

/* ---------- Events ---------- */
backBTN.addEventListener('click', ()=> location.href = 'games.html');
cells.forEach(c => c.addEventListener('click', onCellClick));
betButton.addEventListener('click', () => {
  setMsg('');
  if (!inRound) onPlaceBet(); else onCashOut();
});
minesInput.addEventListener('input', ()=>{
  minesVal.textContent = minesInput.value;
  if (!inRound) { // only rebuild visuals between rounds
    // no shuffle here; just update label
  }
});

/* ---------- Init ---------- */
(async function init(){
  if (!username){ setMsg('Please log in first.'); return; }
  minesVal.textContent = minesInput.value;
  await refreshMoney();
  if (!betAmountEl.value) betAmountEl.value = Math.max(1, Math.floor(wallet * 0.01));
  startFeed();
})();
