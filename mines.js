// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyCbSyocu6e8t7UTLJ4VBwULgBxt38ggw1k",
    authDomain: "casino777-7.firebaseapp.com",
    projectId: "casino777-7",
    storageBucket: "casino777-7.appspot.com",
    messagingSenderId: "824259346500",
    appId: "1:824259346500:web:1ace23689863864cc23c11",
    measurementId: "G-LHMDCMRY9E"
};
const backBTN = document.getElementById('backBtn');
const gameBoard = document.getElementById('gameBoard');
const cells = document.querySelectorAll('[data-cell]');
const betButton = document.getElementById('betButton');

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Your game logic variables and functions here
let username = localStorage.getItem('username');
let money = 1000; // Default money value
let multiplier = 1;
let array = [];
let mines = 5;
let time = 0;
let betAmount = 0;
let gameStarted = false;

backBTN.addEventListener('click', () => {
    window.location.href = 'games.html';
});
// Function to set username and retrieve user's money from Firestore
async function login() {
    money = await getMoney(); // Retrieve money from Firestore
    updateMoneyDisplay();
}

// Retrieve the user's money from Firestore
async function getMoney() {
    try {
        // Query Firestore to find a document with the matching username
        const userQuery = await firebase.firestore().collection('users')
            .where('username', '==', username)
            .get();

        // if (userQuery.empty) {
        //     alert('Username not found.');
        //     return 1000;
        // }

        // Assume the username is unique, so get the first match
        const userDoc = userQuery.docs[0];
        const userData = userDoc.data();
        return (userData.money);

    } catch (error) {
        alert('Money failed. Please try again.');
        console.log(err);
    }
}

// Save the user's money to Firestore
async function updateMoney() {
    try {
        const userQuery = await firebase.firestore().collection('users')
            .where('username', '==', username)
            .get();

        if (userQuery.empty) {
            alert('Username not found.');
            return;
        }

        const userDoc = userQuery.docs[0];
        const userData = userDoc.data();
        userData.money = money;

        await firebase.firestore().collection('users').doc(userDoc.id).update({ money: userData.money });

    } catch (error) {
        alert('Money failed. Please try again.');
    }
}

// Your other game functions...
// Example: Update money display
function updateMoneyDisplay() {
    document.getElementById("moneyAmount").innerText = money;
}

// Start the login process when the page loads
window.onload = login;

function generateArray() {
    array = Array(20).fill(0).concat(Array(5).fill(1));
    time = 0;
    multiplier = 1; // Reset multiplier at the start of each game
    gameStarted = true;

    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }

    cells.forEach((cell) => {
        cell.classList.remove('win', 'red', 'blue', 'gameover');
        cell.textContent = '';
        cell.style.backgroundColor = '';
        cell.style.backgroundImage = '';

        // Add this line to ensure each cell listens for a click even
    });
    updateMltplierDisplay();
}

function updateMltplierDisplay() {
    document.getElementById("multiplier").innerText = multiplier;
}

betButton.addEventListener("click", function () {
    if (!gameStarted) {
        betAmount = parseInt(document.getElementById("betAmount").value);

        if (!isNaN(betAmount) && betAmount > 0 && betAmount <= money) {
            money -= betAmount;
            updateMoneyDisplay();
            updateMoney();
            generateArray();
            betButton.textContent = 'Payout';
        } else {
            alert("Invalid bet amount or insufficient funds.");
        }
    } else {
        revealBombs();
        updateMoney();
        const payout = betAmount * multiplier;
        money += payout;
        updateMoneyDisplay();
        gameStarted = false;
        betButton.textContent = 'Place bets';
    }
});

function revealBombs(){
    cells.forEach((cell, index) => {
        if (array[index] == 1) {
            cell.style.backgroundImage = "url('bomb.png')";
            cell.classList.add('red');
        } else {
            cell.style.backgroundImage = "url('gem.png')";
            cell.classList.add('blue');
        }
    });
}

function handleClick(e) {
    if (!gameStarted) return;

    const cell = e.target;
    // Prevent clicking on already-clicked cells
    if (cell.classList.contains('win') || cell.classList.contains('red') || cell.classList.contains('blue')) {
        return;
    }
    const cellIndex = Array.from(cells).indexOf(cell);

    if (array[cellIndex] == 1) { // Bomb cell
        betButton.textContent = 'Place bets';
        cells.forEach((cell, index) => {
            if (array[index] == 1) {
                cell.style.backgroundImage = "url('bomb.png')";
                cell.classList.add('red');
            } else {
                cell.style.backgroundImage = "url('gem.png')";
                cell.classList.add('blue');
            }
        });
        gameStarted = false;
    } else { // Safe cell
        cell.style.backgroundImage = "url('gem.png')";
        cell.classList.add('win');
        time++;
        multiplier = calculateMultiplier(time);
        updateMltplierDisplay();
    }
}

function calculateMultiplier(time) {
    if (time === 0) return 0;
    return (0.83 * Math.pow(1.32, time)).toFixed(2);
}

cells.forEach(cell => cell.addEventListener('click', handleClick));

// Add other game logic as needed...
