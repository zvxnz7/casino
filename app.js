const auth = getAuth();

document.getElementById('loginForm').addEventListener('submit', async function(event) {
    event.preventDefault();

    const username = document.getElementById('username').value; // This will be the email
    const password = document.getElementById('password').value;

    try {
        // Sign in the user
        const userCredential = await signInWithEmailAndPassword(auth, username, password);
        const user = userCredential.user;

        // Optionally, fetch user data from Firestore
        const docRef = doc(db, "users", user.uid); // Change this to your user identification
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            localStorage.setItem('money', docSnap.data().money); // Store money amount locally
            window.location.href = 'game.html'; // Redirect to game
        } else {
            console.log("No such document!");
        }
    } catch (error) {
        console.error("Error logging in:", error);
        document.getElementById('loginMessage').textContent = error.message; // Show error message
    }
});
