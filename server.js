// --- WebSocket Server for Sanskrit Handwriting Recognition using OCR.space ---

const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const fetch = require('node-fetch'); // We need to ensure 'node-fetch' is available for API calls

// 1. Initialize Express App and Configuration
const PORT = process.env.PORT || 8080;
const OCR_API_KEY = process.env.OCR_API_KEY || ''; // Read API key from Render Environment Variable
const OCR_API_URL = 'https://api.ocr.space/parse/image';

if (!OCR_API_KEY) {
    console.error("FATAL: OCR_API_KEY environment variable not set. Recognition will fail.");
} else {
    console.log("INFO: OCR_API_KEY successfully loaded."); 
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
    console.log(`HTTP Server listening on port ${PORT}`);
});

const wss = new WebSocketServer({ server });

// 2. Function to call OCR.space API
async function recognizeSanskritText(base64ImageData) {
    if (!OCR_API_KEY) {
        return "Recognition Failed: OCR API Key Missing or not loaded.";
    }

    // Check data size before making an API call (minimal drawing check)
    if (base64ImageData.length < 10000) { 
        console.warn("Image data is very small. Likely blank canvas.");
        return "Recognition Failed: Please write clearly before recognizing.";
    }
    
    console.log("Attempting to recognize image using OCR.space...");

    const formData = new URLSearchParams();
    // OCR.space accepts the Base64 string directly with the header
    formData.append('base64Image', base64ImageData); 
    
    // Devanagari script is used for Sanskrit, Hindi, etc. The code for Hindi is 'hin'.
    // OCR.space lists 'hin' (Hindi) which uses Devanagari script, the best available option.
    formData.append('language', 'hin'); 
    
    // Set engine to 2 which is often better for complex scripts, though sometimes slower.
    formData.append('ocrEngine', 2); 
    
    // Note: OCR.space has a rate limit of 500 requests/day on the free tier.

    try {
        const response = await fetch(OCR_API_URL, {
            method: 'POST',
            headers: { 'apikey': OCR_API_KEY }, // API Key sent as a header
            body: formData,
        });

        const result = await response.json();
        
        if (!response.ok || result.IsErroredOnProcessing) {
            console.error('OCR.space API Error:', result.ErrorMessage || result);
            return `Recognition Failed: ${result.ErrorMessage ? result.ErrorMessage[0] : 'API Error. Check server logs.'}`;
        }
        
        let recognizedText = '';
        
        if (result.ParsedResults && result.ParsedResults.length > 0) {
            // Extract the recognized text from the first result block
            recognizedText = result.ParsedResults[0].ParsedText.trim();
        }

        if (recognizedText) {
            console.log(`Recognition Result: ${recognizedText}`);
            return recognizedText;
        } else {
            console.warn("OCR.space returned no parsed text for the image.");
            return "Recognition Failed: Illegible handwriting or no text found.";
        }

    } catch (error) {
        console.error("Error during OCR.space API call (Network/Parse):", error);
        return "Recognition Failed: Server Network Error or JSON Parse Failure.";
    }
}

// 3. WebSocket Connection Handling
wss.on('connection', function connection(ws) {
    console.log('Client connected. Total clients:', wss.clients.size);
    
    ws.on('message', async function incoming(message) {
        const messageString = message.toString();
        
        try {
            const data = JSON.parse(messageString);

            if (data.type === 'recognize_image' && data.image) {
                const base64Image = data.image;
                
                // 1. Perform Recognition
                const recognizedText = await recognizeSanskritText(base64Image);

                // 2. Broadcast the Recognized Text
                wss.clients.forEach(function each(client) {
                    if (client.readyState === client.OPEN) {
                        client.send(JSON.stringify({ type: 'display_text', text: recognizedText }));
                    }
                });

            } else {
                console.log("Received unknown message type or empty text.");
            }

        } catch (e) {
            console.error('Error processing incoming message:', e);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected.');
    });
});
