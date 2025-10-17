// --- WebSocket Server for Sanskrit Handwriting Recognition using OCR.space ---

const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const fetch = require('node-fetch');

// 1. Initialize Express App and Configuration
const PORT = process.env.PORT || 8080;
const OCR_API_KEY = process.env.OCR_API_KEY || '';
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

    // Remove data URI prefix if present
    const base64Clean = base64ImageData.replace(/^data:image\/\w+;base64,/, '');
    
    // Check data size before making an API call
    if (base64Clean.length < 1000) { 
        console.warn("Image data is very small. Likely blank canvas.");
        return "Recognition Failed: Please write clearly before recognizing.";
    }
    
    console.log("Attempting to recognize image using OCR.space...");
    console.log("Image data length:", base64Clean.length);

    const formData = new URLSearchParams();
    formData.append('base64Image', `data:image/png;base64,${base64Clean}`);
    
    // Try multiple language configurations
    formData.append('language', 'hin'); // Hindi/Devanagari
    formData.append('isOverlayRequired', 'false');
    formData.append('detectOrientation', 'true');
    formData.append('scale', 'true');
    formData.append('OCREngine', '2'); // Try engine 2 first

    try {
        const response = await fetch(OCR_API_URL, {
            method: 'POST',
            headers: { 
                'apikey': OCR_API_KEY,
            },
            body: formData,
        });

        const result = await response.json();
        
        console.log("OCR.space Response:", JSON.stringify(result, null, 2));
        
        if (!response.ok) {
            console.error('OCR.space HTTP Error:', response.status, response.statusText);
            return `Recognition Failed: HTTP ${response.status} - ${response.statusText}`;
        }
        
        if (result.IsErroredOnProcessing) {
            const errorMsg = result.ErrorMessage ? result.ErrorMessage.join(', ') : 'Unknown error';
            console.error('OCR.space Processing Error:', errorMsg);
            
            // If engine 2 fails, try engine 1
            if (errorMsg.includes('Engine2') || errorMsg.includes('engine')) {
                console.log("Retrying with Engine 1...");
                return await recognizeSanskritTextWithEngine1(base64Clean);
            }
            
            return `Recognition Failed: ${errorMsg}`;
        }
        
        let recognizedText = '';
        
        if (result.ParsedResults && result.ParsedResults.length > 0) {
            recognizedText = result.ParsedResults[0].ParsedText.trim();
            
            // Check for exit code
            const exitCode = result.ParsedResults[0].FileParseExitCode;
            if (exitCode !== 1) {
                console.warn(`Parse exit code: ${exitCode}`);
            }
        }

        if (recognizedText && recognizedText.length > 0) {
            console.log(`Recognition Result: ${recognizedText}`);
            return recognizedText;
        } else {
            console.warn("OCR.space returned no parsed text for the image.");
            return "Recognition Failed: No text detected. Try writing larger and clearer.";
        }

    } catch (error) {
        console.error("Error during OCR.space API call:", error.message);
        console.error("Full error:", error);
        return `Recognition Failed: ${error.message}`;
    }
}

// Fallback function with engine 1
async function recognizeSanskritTextWithEngine1(base64Clean) {
    const formData = new URLSearchParams();
    formData.append('base64Image', `data:image/png;base64,${base64Clean}`);
    formData.append('language', 'hin');
    formData.append('isOverlayRequired', 'false');
    formData.append('OCREngine', '1'); // Engine 1

    try {
        const response = await fetch(OCR_API_URL, {
            method: 'POST',
            headers: { 'apikey': OCR_API_KEY },
            body: formData,
        });

        const result = await response.json();
        console.log("OCR.space Engine 1 Response:", JSON.stringify(result, null, 2));
        
        if (result.ParsedResults && result.ParsedResults.length > 0) {
            const text = result.ParsedResults[0].ParsedText.trim();
            if (text) return text;
        }
        
        return "Recognition Failed: No text detected with either engine.";
    } catch (error) {
        console.error("Engine 1 fallback error:", error.message);
        return "Recognition Failed: Both engines failed.";
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
                
                // Send acknowledgment
                ws.send(JSON.stringify({ 
                    type: 'display_text', 
                    text: 'Processing...' 
                }));
                
                // Perform Recognition
                const recognizedText = await recognizeSanskritText(base64Image);

                // Broadcast the Recognized Text
                wss.clients.forEach(function each(client) {
                    if (client.readyState === client.OPEN) {
                        client.send(JSON.stringify({ 
                            type: 'display_text', 
                            text: recognizedText 
                        }));
                    }
                });

            } else {
                console.log("Received unknown message type or missing image data.");
            }

        } catch (e) {
            console.error('Error processing incoming message:', e);
            ws.send(JSON.stringify({ 
                type: 'display_text', 
                text: 'Server Error: ' + e.message 
            }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected. Remaining clients:', wss.clients.size);
    });
});

console.log("WebSocket server ready and waiting for connections...");