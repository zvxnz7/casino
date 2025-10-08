/* ==========================================================
   Mines — responsive, modern wallet integration (Firestore)
   - Uses localStorage.username like your current build
   - Single source of truth for balance with transactions
   - Cleaner state flow: Place bet ↔ Cash out
========================================================== */

/* ---------- Firebase init (kept local to this page) ---------- */
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
const gameBoard = document.getElementById('gameBoard');
const cells = [...document.querySelectorAll('[data-cell]')];
const betButton = document.getElementById('betButton');
const betAmountEl = document.getElementById('betAmount');
const moneyAmountEl = document.getElementById('moneyAmount');
const multiplierEl = document.getElementById('multiplier');
const msgEl = document.getElementById('msg');

/* ---------- State ---------- */
const GRID = 25;               // 5x5
const DEFAULT_MINES = 5;
let username = localStorage.getItem('username') || null;

let wallet = 0;
let inRound = false;
let betAmount = 0;
let mines = DEFAULT_MINES;
let bombMask = new Array(GRID).fill(0);
let revealedSafe = 0;          // number of safe tiles opened this round
let multiplier = 1;

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
  amount = Number(amount);
  const ref = await userRef();
  await db.runTransaction(async tx=>{
    const s = await tx.get(ref);
    const cur = Number((s.data()||{}).money ?? 0);
    if (cur < amount) throw new Error('Insufficient funds.');
    tx.update(ref, { money: +(cur - amount).toFixed(2) });
  });
}
async function credit(amount){
  amount = Number(amount);
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
function shuffleBombs(nBombs = DEFAULT_MINES){
  const idx = [...Array(GRID).keys()];
  for (let i=idx.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [idx[i],idx[j]] = [idx[j],idx[i]];
  }
  bombMask.fill(0);
  for (let i=0;i<nBombs;i++) bombMask[idx[i]] = 1;
}
function calcMultiplier(safeOpens){
  if (safeOpens <= 0) return 1;
  // keep your original curve, but return Number
  const val = 0.83 * Math.pow(1.32, safeOpens);
  return +val.toFixed(2);
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
    betAmount = Math.floor(Number(betAmountEl.value));
    if (!Number.isFinite(betAmount) || betAmount<=0) return setMsg('Enter a valid bet');
    if (betAmount > wallet) return setMsg('Insufficient funds');

    await debit(betAmount);
    await refreshMoney();

    resetBoard();
    shuffleBombs(mines);
    inRound = true;
    betButton.textContent = 'Cash out';
    setMsg('Pick tiles! Avoid bombs.');
  }catch(e){
    setMsg(e.message || 'Bet failed');
  }
}
async function onCashOut(){
  try{
    const payout = +(betAmount * multiplier).toFixed(2);
    await credit(payout);
    await refreshMoney();

    revealAll();
    inRound = false;
    betButton.textContent = 'Place bet';
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
    setMsg('Boom! Better luck next round.');
  } else {
    // Safe
    cell.style.backgroundImage = "url('gem.png')";
    cell.classList.add('win');
    revealedSafe++;
    multiplier = calcMultiplier(revealedSafe);
    multiplierEl.textContent = String(multiplier);
  }
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
  // optional: default bet to a sensible fraction of balance
  if (!betAmountEl.value) betAmountEl.value = Math.max(1, Math.floor(wallet * 0.01));
})();
