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

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Your game logic variables and functions here
let username;
let money = 1000; // Default money value
let multiplier = 1;
let array = [];
let mines = 5;
let time = 0;
let betAmount = 0;
let gameStarted = false;

// Function to set username and retrieve user's money from Firestore
async function login() {
    username = prompt("Enter your username:");
    money = await getMoney(username); // Retrieve money from Firestore
    updateMoneyDisplay();
}

// Retrieve the user's money from Firestore
async function getMoney(username) {
    try {
        const docRef = db.collection("users").doc(username);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            return docSnap.data().money;
        } else {
            console.log("No such document! Returning default money.");
            return 1000; // Default money value if user doesn't exist
        }
    } catch (error) {
        console.error("Error fetching money:", error);
        return 1000; // Return default if error occurs
    }
}

// Save the user's money to Firestore
async function updateMoney(username, money) {
    try {
        await db.collection("users").doc(username).set({ money: money });
        console.log("Money updated successfully!");
    } catch (error) {
        console.error("Error updating money:", error);
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

function updateMoneyDisplay() {
    document.getElementById("moneyAmount").innerText = money;
}

function updateMltplierDisplay() {
    document.getElementById("multiplier").innerText = multiplier;
}

updateMoneyDisplay();

betButton.addEventListener("click", function () {
    if (!gameStarted) {
        betAmount = parseInt(document.getElementById("betAmount").value);

        if (!isNaN(betAmount) && betAmount > 0 && betAmount <= money) {
            money -= betAmount;
            updateMoneyDisplay();
            generateArray();
            betButton.textContent = 'Payout';
        } else {
            alert("Invalid bet amount or insufficient funds.");
        }
    } else {
        revealBombs();
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
