import { initializeApp } from "https://www.gstatic.com/firebasejs/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/firebase-firestore.js";


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

// const firebaseConfig = {
//     apiKey: "AIzaSyCbSyocu6e8t7UTLJ4VBwULgBxt38ggw1k",
//     authDomain: "casino777-7.firebaseapp.com",
//     projectId: "casino777-7",
//     storageBucket: "casino777-7.appspot.com",
//     messagingSenderId: "824259346500",
//     appId: "1:824259346500:web:1ace23689863864cc23c11",
//     measurementId: "G-LHMDCMRY9E"
// };

// // Initialize Firebase
// const app = firebase.initializeApp(firebaseConfig);
// const auth = firebase.auth();
// const db = firebase.firestore();

// document.getElementById('loginForm').addEventListener('submit', async function(event) {
//     event.preventDefault();

//     const username = document.getElementById('username').value; // This will be the email
//     const password = document.getElementById('password').value;

//     try {
//         // Sign in the user
//         const userCredential = await signInWithEmailAndPassword(auth, username, password);
//         const user = userCredential.user;

//         // Optionally, fetch user data from Firestore
//         const docRef = doc(db, "users", user.uid); // Change this to your user identification
//         const docSnap = await getDoc(docRef);
//         if (docSnap.exists()) {
//             localStorage.setItem('money', docSnap.data().money); // Store money amount locally
//             window.location.href = 'game.html'; // Redirect to game
//         } else {
//             console.log("No such document!");
//         }
//     } catch (error) {
//         console.error("Error logging in:", error);
//         document.getElementById('loginMessage').textContent = error.message; // Show error message
//     }
// });
