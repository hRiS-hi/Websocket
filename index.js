// --- WebSocket Server for Real-Time Canvas Collaboration ---
//
// This server handles incoming drawing coordinates and broadcasts them to all
// connected clients (both mobile and desktop).
//
// Dependencies: express, ws (install via 'npm install express ws')

const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

// 1. Initialize Express App
const PORT = process.env.PORT || 8080;
const app = express();

// 2. Serve the static client file (index.html)
// This is necessary for Render to serve the frontend file from the same project.
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to serve index.html for any route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 3. Start the HTTP server
const server = app.listen(PORT, () => {
    console.log(`HTTP Server listening on port ${PORT}`);
});

// 4. Initialize WebSocket Server attached to the HTTP server
const wss = new WebSocketServer({ server });

// Store all connected clients
const clients = new Set();

// 5. WebSocket Connection Handling
wss.on('connection', function connection(ws, req) {
    console.log('Client connected. Total clients:', wss.clients.size);
    clients.add(ws);

    // Handle messages from client (i.e., drawing data)
    ws.on('message', function incoming(message) {
        // Drawing data comes in as a JSON string
        const data = message.toString();

        // Broadcast the received drawing data to all OTHER connected clients
        // The sender will already have drawn the line locally, so we skip them.
        wss.clients.forEach(function each(client) {
            if (client !== ws && client.readyState === client.OPEN) {
                client.send(data);
            }
        });
    });

    // Handle client disconnections
    ws.on('close', () => {
        clients.delete(ws);
        console.log('Client disconnected. Total clients:', wss.clients.size);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

console.log('WebSocket server initialized.');
// Note: For Render deployment, you will need to create a 'public' directory
// and place the 'index.html' file inside it.
