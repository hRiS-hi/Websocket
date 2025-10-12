// --- WebSocket Server for Sanskrit Handwriting Recognition (FIXED) ---

const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

// 1. Initialize Express App and Configuration
const PORT = process.env.PORT || 8080;
const API_KEY = process.env.GEMINI_API_KEY || '';

// FIX 1: Updated to use a valid Gemini model name
// Use gemini-1.5-flash or gemini-1.5-pro instead of the non-existent model
const MODEL_NAME = 'gemini-1.5-flash-latest'; // or 'gemini-1.5-pro-latest'
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`;

if (!API_KEY) {
    console.error("FATAL: GEMINI_API_KEY environment variable not set. Recognition will fail.");
    console.error("Set it with: export GEMINI_API_KEY='your-api-key-here'");
} else {
    console.log("INFO: GEMINI_API_KEY successfully loaded.");
    console.log(`INFO: Using model: ${MODEL_NAME}`);
    console.log(`INFO: API endpoint: ${API_URL.split('?')[0]}`); // Log without key
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
    
    // FIX 2: More lenient blank canvas detection
    // Base64 encoded blank canvas is typically around 5000-8000 bytes
    if (base64ImageData.length < 5000) { 
        console.warn("Image data is very small. User likely submitted a blank or near-blank canvas.");
        return "Recognition Failed: Please write clearly (ensure dark, thick lines) before recognizing.";
    }

    console.log(`Attempting to recognize image... (${base64ImageData.length} bytes)`);

    // FIX 3: Improved prompt for better recognition
    const userPrompt = `You are an OCR system specialized in Sanskrit Devanagari script. 
Carefully analyze the handwritten text in this image and transcribe ONLY the Sanskrit characters you can clearly recognize.
Output only the Devanagari text, nothing else.
If no clear text is visible or the image is blank, respond with exactly: NO_TEXT`;

    const payload = {
        contents: [
            {
                role: "user",
                parts: [
                    { text: userPrompt },
                    {
                        inlineData: {
                            mimeType: "image/png",
                            data: base64ImageData.replace(/^data:image\/png;base64,/, '')
                        }
                    }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
            // FIX 4: Add additional safety settings
            topK: 1,
            topP: 0.95
        },
        // FIX 5: Add safety settings to prevent blocking
        safetySettings: [
            {
                category: "HARM_CATEGORY_HARASSMENT",
                threshold: "BLOCK_NONE"
            },
            {
                category: "HARM_CATEGORY_HATE_SPEECH",
                threshold: "BLOCK_NONE"
            },
            {
                category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                threshold: "BLOCK_NONE"
            },
            {
                category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                threshold: "BLOCK_NONE"
            }
        ]
    };

    try {
        console.log("Sending request to Gemini API...");
        
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        
        // CHECK 1: Handle non-2xx HTTP status codes
        if (!response.ok) {
            console.error(`API Request Failed (HTTP ${response.status}):`, JSON.stringify(result, null, 2));
            
            // FIX 6: Better error messages for common issues
            if (response.status === 400) {
                if (result.error?.message?.includes("API key")) {
                    return "Recognition Failed: Invalid API key. Check your GEMINI_API_KEY.";
                }
                if (result.error?.message?.includes("models/")) {
                    return `Recognition Failed: Model '${MODEL_NAME}' not found. Update MODEL_NAME in server.js`;
                }
                return `Recognition Failed: Bad Request - ${result.error?.message || 'Unknown error'}`;
            }
            if (response.status === 403) {
                return "Recognition Failed: API key lacks permission or billing not enabled.";
            }
            if (response.status === 429) {
                return "Recognition Failed: Rate limit exceeded. Try again in a moment.";
            }
            if (response.status === 500 || response.status === 503) {
                return "Recognition Failed: Google API server error. Try again later.";
            }
            return `Recognition Failed: HTTP Error ${response.status}. Check server logs.`;
        }

        // CHECK 2: Extract the text from the API response
        console.log("API Response structure:", JSON.stringify(result, null, 2));
        
        // FIX 7: Handle content filtering
        if (result.candidates?.[0]?.finishReason === 'SAFETY') {
            console.warn("Content was filtered by safety settings");
            return "Recognition Failed: Content filtered by safety settings.";
        }
        
        let recognizedText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
        
        if (recognizedText) {
            recognizedText = recognizedText.trim();
            
            // Handle the specific NO_TEXT failure token
            if (recognizedText === 'NO_TEXT') {
                console.warn("Model explicitly failed to recognize text and returned NO_TEXT.");
                return "Recognition Failed: No legible text detected. Please write more clearly.";
            }

            console.log(`✓ Recognition successful: ${recognizedText}`);
            return recognizedText;
            
        } else {
            console.error("Recognition Failed: API Response missing text candidate.");
            console.error("Full response:", JSON.stringify(result, null, 2));
            return "Recognition Failed: Empty response from model. Check server logs.";
        }

    } catch (error) {
        console.error("Error during Gemini API call:", error);
        console.error("Error details:", error.message);
        
        // FIX 8: Better network error handling
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            return "Recognition Failed: Network error. Check internet connection.";
        }
        return `Recognition Failed: ${error.message}`;
    }
}

// 7. WebSocket Connection Handling
wss.on('connection', function connection(ws) {
    console.log('✓ Client connected. Total clients:', wss.clients.size);
    
    ws.on('message', async function incoming(message) {
        const messageString = message.toString();
        
        try {
            const data = JSON.parse(messageString);

            if (data.type === 'recognize_image') {
                console.log('📝 Recognition request received');
                const base64Image = data.image;
                
                // 1. Perform Recognition
                const recognizedText = await recognizeSanskritText(base64Image);

                // 2. Broadcast the Recognized Text
                console.log(`📤 Broadcasting result to ${wss.clients.size} client(s)`);
                wss.clients.forEach(function each(client) {
                    if (client.readyState === client.OPEN) {
                        client.send(JSON.stringify({ 
                            type: 'recognized_text', 
                            text: recognizedText 
                        }));
                    }
                });

            } else {
                console.log("⚠ Received unknown message type:", data.type);
            }

        } catch (e) {
            console.error('❌ Error processing message:', e);
            ws.send(JSON.stringify({ 
                type: 'error', 
                message: 'Server error processing request' 
            }));
        }
    });

    ws.on('close', () => {
        console.log('✗ Client disconnected. Remaining clients:', wss.clients.size);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

console.log('\n🚀 Server initialization complete!');
console.log(`📍 Visit: http://localhost:${PORT}`);