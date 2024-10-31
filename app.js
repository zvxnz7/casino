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

// Initialize Firebase (add your own configuration here)

// Event listener for login form submission
document.getElementById('loginForm').addEventListener('submit', async function(event) {
    event.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    localStorage.setItem('username', username);

    try {
        // Query Firestore to find a document with the matching username
        const userQuery = await firebase.firestore().collection('users')
            .where('username', '==', username)
            .get();

        if (userQuery.empty) {
            alert('Username not found.');
            return;
        }

        // Assume the username is unique, so get the first match
        const userDoc = userQuery.docs[0];
        const userData = userDoc.data();

        // Check if the provided password matches the stored password
        if (userData.password === password) {  // In production, compare hashed passwords
            // Login successful, retrieve and store user's money
            const userMoney = userData.money;
            localStorage.setItem('userMoney', userMoney);

            // Redirect to game.html
            window.location.href = 'mines.html';
        } else {
            alert('Incorrect password.');
        }
    } catch (error) {
        console.error('Error during login:', error.message);
        alert('Login failed. Please try again.');
    }
});

