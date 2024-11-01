const gameCards = document.querySelectorAll('.game-card');
const money = localStorage.getItem('userMoney');


gameCards.forEach(card => {
    const gameName = card.getAttribute('data-game');

    card.addEventListener('click', () => {
        window.location.href = 'mines.html';

    });
});
