const canvas = document.getElementById('plinko');
const ctx = canvas.getContext('2d');

const pegs = [];
const balls = [];
const pegRadius = 5;
const ballRadius = 6;
const spacing = 40;
const rows = 10;

// Create triangular peg layout
function setupPegs() {
  pegs.length = 0;
  for (let row = 0; row < rows; row++) {
    const count = row + 1;
    const offsetX = (canvas.width - count * spacing) / 2 + spacing / 2;
    const y = spacing + row * spacing;
    for (let i = 0; i < count; i++) {
      const x = offsetX + i * spacing;
      pegs.push({ x, y });
    }
  }
}


// function dropBall() {
//     balls.push({
//       x: canvas.width / 2,
//       y: 20,
//       vx: 0,
//       vy: 1,
//       radius: ballRadius,
//       lastPeg: null
//     });
//   }
  
function dropBall() {
    balls.push({
      x: canvas.width / 2,
      y: 20,
      radius: ballRadius,
      currentRow: 0
    });
  }
  
  
  function updateBall(ball) {
    const rowY = spacing + ball.currentRow * spacing;
  
    // Move down to the row
    if (ball.y < rowY) {
      ball.y += 1; // controlled fall speed
      return;
    }
  
    // Once it reaches the peg row level
    const pegCount = ball.currentRow + 1;
    const offsetX = (canvas.width - pegCount * spacing) / 2 + spacing / 2;
  
    // Calculate closest peg position in current row
    let pegIndex = Math.round((ball.x - offsetX) / spacing);
    pegIndex = Math.max(0, Math.min(pegCount - 1, pegIndex));
    const pegX = offsetX + pegIndex * spacing;
  
    // Snap to peg X
    ball.x = pegX;
    ball.y = rowY;
  
    // Decide 50/50 move
    const direction = Math.random() < 0.5 ? -1 : 1;
    pegIndex += direction;
  
    // Clamp to valid peg range for next row
    const nextRow = ball.currentRow + 1;
    if (nextRow < rows) {
      const nextCount = nextRow + 1;
      const nextOffsetX = (canvas.width - nextCount * spacing) / 2 + spacing / 2;
      pegIndex = Math.max(0, Math.min(nextCount - 1, pegIndex));
      ball.x = nextOffsetX + pegIndex * spacing;
    }
  
    ball.currentRow++;
  
    // If ball is below peg rows, let it fall straight
    if (ball.currentRow >= rows) {
      ball.y += 1.5;
    }
  }
  
//   function updateBall(ball) {
//     // gravity
//     ball.vy += 0.05;
//     ball.x += ball.vx;
//     ball.y += ball.vy;
  
//     // Peg collisions and 50/50 nudge
//     for (let peg of pegs) {
//       const dx = ball.x - peg.x;
//       const dy = ball.y - peg.y;
//       const dist = Math.sqrt(dx * dx + dy * dy);
//       const minDist = ball.radius + pegRadius;
  
//       if (dist < minDist) {
//         const angle = Math.atan2(dy, dx);
//         const overlap = minDist - dist + 0.5;
  
//         // Separate ball from peg
//         ball.x += Math.cos(angle) * overlap;
//         ball.y += Math.sin(angle) * overlap;
  
//         // Reflect velocity
//         const normal = angle;
//         const dot = ball.vx * Math.cos(normal) + ball.vy * Math.sin(normal);
  
//         ball.vx -= 2 * dot * Math.cos(normal);
//         ball.vy -= 2 * dot * Math.sin(normal);
  
//         // Damping
//         ball.vx *= 0.6;
//         ball.vy *= 0.3;
  
//         // Apply a one-time 50/50 nudge to x
//         if (!ball.lastPeg || Math.abs(ball.lastPeg.x - peg.x) > 10 || Math.abs(ball.lastPeg.y - peg.y) > 10) {
//           ball.vx += (Math.random() < 0.5 ? -1 : 1) * 1.0;
//           ball.lastPeg = { x: peg.x, y: peg.y };
//         }
//       }
//     }
  
    // Wall collisions
//     if (ball.x < ball.radius) {
//       ball.x = ball.radius;
//       ball.vx *= -0.6;
//     }
//     if (ball.x > canvas.width - ball.radius) {
//       ball.x = canvas.width - ball.radius;
//       ball.vx *= -0.6;
//     }
  
//     // Floor
//     if (ball.y > canvas.height - ball.radius) {
//       ball.y = canvas.height - ball.radius;
//       ball.vy = 0;
//       ball.vx = 0;
//     }
//   }
  
  

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw walls (top & sides)
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 5, canvas.height); // left wall
  ctx.fillRect(canvas.width - 5, 0, 5, canvas.height); // right wall
  ctx.fillRect(0, 0, canvas.width, 5); // top wall

  // Draw pegs
  ctx.fillStyle = '#000';
  for (let peg of pegs) {
    ctx.beginPath();
    ctx.arc(peg.x, peg.y, pegRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw balls
  ctx.fillStyle = '#e74c3c';
  for (let ball of balls) {
    updateBall(ball);
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  requestAnimationFrame(draw);
}

// Set up
setupPegs();
canvas.addEventListener('click', dropBall);
draw();
