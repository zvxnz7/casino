// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyCbSyocu6e8t7UTLJ4VBwULgBxt38ggw1k",
    authDomain: "casino777-7.firebaseapp.com",
    projectId: "casino777-7",
    storageBucket: "casino777-7.firebasestorage.app",
    messagingSenderId: "824259346500",
    appId: "1:824259346500:web:1ace23689863864cc23c11",
    measurementId: "G-LHMDCMRY9E"
};

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const analytics = firebase.analytics(app);
const db = firebase.firestore(app);


const gameBoard = document.getElementById('gameBoard');
const cells = document.querySelectorAll('[data-cell]');
const betButton = document.getElementById('betButton');

let username = localStorage.getItem('username');
let money = 1000; // Default value
let multiplier = 1;
let array = [];
let mines = 5;
let time = 0;
let betAmount = 0;
let gameStarted = false;

// Function to set username and retrieve user's money from Firestore
async function login() {
    createUser('karek', 1000);
    createUser('wielu', 1000);
    createUser('rybson', 1000);
    createUser('kamil', 1000);
    createUser('cyrylito', 1000);
    createUser('user1', 1000);
    money = await getMoney(username); // Retrieve money from Firestore
    updateMoneyDisplay();
}

// Retrieve the user's money from Firestore
// Function to retrieve the user's money from Firestore
async function getMoney(username) {
    try {
        const docRef = firebase.firestore().doc(`users/${username}`);
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

// Function to save the user's money to Firestore
async function updateMoney(username, money) {
    try {
        await firebase.firestore().doc(`users/${username}`).set({ money: money });
        console.log("Money updated successfully!");
    } catch (error) {
        console.error("Error updating money:", error);
    }
}

// Function to create a new user in Firestore
async function createUser(username, initialMoney) {
    try {
        await firebase.firestore().doc(`users/${username}`).set({ money: initialMoney });
        console.log(`User ${username} created with initial money: ${initialMoney}`);
    } catch (error) {
        console.error("Error creating user:", error);
    }
}


// Function to generate array for mines
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
    });
}

// Function to update money display
function updateMoneyDisplay() {
    document.getElementById("moneyAmount").innerText = money;
}

// Event listener for the bet button
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
        updateMoney(username, money); // Update money in Firestore
        updateMoneyDisplay();
        gameStarted = false;
        betButton.textContent = 'Place bets';
    }
});

// Function to reveal bombs and show results
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

// Function to handle cell clicks
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
    }
}

// Calculate multiplier based on time
function calculateMultiplier(time) {
    if (time === 0) return 0;
    return (0.83 * Math.pow(1.32, time)).toFixed(2);
}

// Example usage

// Add event listeners for cell clicks
cells.forEach(cell => cell.addEventListener('click', handleClick));

// Start the login process when the page loads
window.onload = login;