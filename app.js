document.getElementById('loginForm').addEventListener('submit', async function(event) {
    event.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    const response = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await response.json();

    if (data.success) {
        localStorage.setItem('username', username); // Store username locally
        window.location.href = './game.html' // Redirect to game
    } else {
        document.getElementById('loginMessage').textContent = 'Invalid username or password.';
    }
});
