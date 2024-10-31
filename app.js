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
    const username = document.getElementById('username').value; // This will be the email
    const password = document.getElementById('password').value;
    
    try {
        // Firebase Authentication: Sign in with email and password
        const userCredential = await firebase.auth().signInWithEmailAndPassword(username, password);
        const user = userCredential.user;

        if (user) {
            // User signed in successfully; retrieve money amount from Firestore
            const userDoc = await firebase.firestore().collection('users').doc(user.uid).get();

            if (userDoc.exists) {
                const userData = userDoc.data();
                const userMoney = userData.money;

                // Save user's money data or pass it to the game.html page if needed
                localStorage.setItem('userMoney', userMoney);

                // Redirect to game.html
                window.location.href = 'game.html';
            } else {
                console.log('User data not found in Firestore.');
                alert('User data could not be retrieved.');
            }
        }
    } catch (error) {
        console.error('Error signing in:', error.message);
        alert('Login failed. Please check your credentials.');
    }
});

