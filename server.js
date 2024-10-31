import http from 'http'; // Use import instead of require
import { fileURLToPath } from 'url'; // To handle file paths correctly
import { dirname, join, extname } from 'path'; // Import join and extname
import fs from 'fs'; // Import fs for file system operations

const __filename = fileURLToPath(import.meta.url); // Get current file path
const __dirname = dirname(__filename); // Get current directory path

// Function to load user data
function loadUserData() {
    const data = fs.readFileSync(join(__dirname, 'users.json')); // Use join to construct the path
    return JSON.parse(data).users; // Assuming users.json has a users array
}

// Server logic
const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') {
        // Parse login request
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            const { username, password } = JSON.parse(body);
            const users = loadUserData();
            const user = users.find(u => u.username === username && u.password === password);

            if (user) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, money: user.money }));
            } else {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Invalid credentials' }));
            }
        });
    } else {
        // Serve static files (index.html, game.html, styles.css, etc.)
        let filePath = join(__dirname, req.url === '/' ? 'index.html' : req.url); // Use join for file path
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.wav': 'audio/wav',
            '.mp4': 'video/mp4',
            '.woff': 'application/font-woff',
            '.ttf': 'application/font-ttf',
            '.eot': 'application/vnd.ms-fontobject',
            '.otf': 'application/font-otf',
            '.wasm': 'application/wasm',
        };

        const contentType = mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream';

        fs.readFile(filePath, (error, content) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    res.writeHead(404);
                    res.end('404 Not Found');
                } else {
                    res.writeHead(500);
                    res.end(`Error: ${error.code}`);
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}/`);
});
