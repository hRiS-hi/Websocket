// --- WebSocket Server for Sanskrit Handwriting Recognition ---

const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

// 1. Initialize Express App and Configuration
const PORT = process.env.PORT || 8080;
const API_KEY = process.env.GEMINI_API_KEY || ''; // Read API key from Render Environment Variable
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;

if (!API_KEY) {
    // RESTORING API KEY CHECK LOGIC for better startup visibility
    console.error("FATAL: GEMINI_API_KEY environment variable not set. Recognition will fail.");
} else {
    console.log("INFO: GEMINI_API_KEY successfully loaded."); 
}

const app = express();

// 2. Serve the static client file (index.html)
app.use(express.static(path.join(__dirname, 'public')));

// 3. Fallback to serve index.html for any route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 4. Start the HTTP server
const server = app.listen(PORT, () => {
    console.log(`HTTP Server listening on port ${PORT}`);
});

// 5. Initialize WebSocket Server
const wss = new WebSocketServer({ server });

// 6. Function to call Gemini Vision API with robust error handling
async function recognizeSanskritText(base64ImageData) {
    if (!API_KEY) {
        console.error("API Key is missing at call time. Check Render configuration.");
        return "Recognition Failed: API Key Missing.";
    }
    
    // NEW CHECK: Prevent API call on blank canvas
    if (base64ImageData.length < 5000) { // Base64 length check (adjusting threshold higher for safer check)
        console.warn("Image data is very small. User likely submitted a blank or near-blank canvas.");
        return "Recognition Failed: Please write clearly (ensure dark, thick lines) before recognizing.";
    }

    console.log("Attempting to recognize image...");

    // The user prompt guides the model to perform OCR on the Sanskrit handwriting
    const userPrompt = "Please perform Optical Character Recognition (OCR) on the handwriting in this image. The content is Sanskrit text written in the Devanagari script. Transcribe ONLY the recognized Sanskrit text (Devanagari characters) and nothing else. If you cannot recognize it, reply with 'Recognition Failed'.";

    const payload = {
        contents: [
            {
                role: "user",
                parts: [
                    { text: userPrompt },
                    {
                        inlineData: {
                            mimeType: "image/png",
                            data: base64ImageData.replace(/^data:image\/png;base64,/, '') // Clean prefix
                        }
                    }
                ]
            }
        ],
        // Set a low temperature for predictable, accurate transcription
        generationConfig: {
            temperature: 0.1, 
            maxOutputTokens: 2048
        }
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        
        // CHECK 1: Handle non-2xx HTTP status codes (e.g., 400, 403, 429)
        if (!response.ok) {
            console.error(`API Request Failed (HTTP ${response.status}):`, result.error || JSON.stringify(result));
            if (response.status === 400 && result.error?.message.includes("API key not valid")) {
                return "Recognition Failed: Invalid GEMINI_API_KEY.";
            }
            if (response.status === 429) {
                return "Recognition Failed: Rate Limit Exceeded (Too many requests).";
            }
            return `Recognition Failed: HTTP Error ${response.status}. See server logs for details.`;
        }

        // CHECK 2: Extract the text from the API response
        const recognizedText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (recognizedText) {
            console.log(`Recognition Result: ${recognizedText}`);
            
            // Critical: If the model itself returns the 'Recognition Failed' string, we should log it but pass it through.
            if (recognizedText.includes("Recognition Failed")) {
                console.warn("Model explicitly failed to recognize the image content.");
            }
            return recognizedText;
            
        } else {
            console.error("Recognition Failed: API Response missing text candidate.", JSON.stringify(result));
            return "Recognition Failed: Model failed to process input or response structure invalid.";
        }

    } catch (error) {
        console.error("Error during Gemini API call (Network/Parse):", error);
        return "Recognition Failed: Server Network Error or JSON Parse Failure.";
    }
}

// 7. WebSocket Connection Handling
wss.on('connection', function connection(ws) {
    console.log('Client connected. Total clients:', wss.clients.size);
    
    ws.on('message', async function incoming(message) {
        const messageString = message.toString();
        
        try {
            const data = JSON.parse(messageString);

            if (data.type === 'recognize_image') {
                const base64Image = data.image;
                
                // 1. Perform Recognition
                const recognizedText = await recognizeSanskritText(base64Image);

                // 2. Broadcast the Recognized Text
                wss.clients.forEach(function each(client) {
                    if (client.readyState === client.OPEN) {
                        client.send(JSON.stringify({ type: 'recognized_text', text: recognizedText }));
                    }
                });

            } else {
                console.log("Received unknown message type.");
            }

        } catch (e) {
            console.error('Error processing incoming message or API call:', e);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected.');
    });
});
