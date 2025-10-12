// --- WebSocket Server for Sanskrit Handwriting Recognition (Updated to Official API Format) ---

const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

// 1. Initialize Express App and Configuration
const PORT = process.env.PORT || 8080;
const API_KEY = process.env.GEMINI_API_KEY || '';

// Using the correct model name from official documentation
const MODEL_NAME = 'gemini-2.5-flash'; // Latest model with best vision capabilities
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`;

if (!API_KEY) {
    console.error("FATAL: GEMINI_API_KEY environment variable not set. Recognition will fail.");
    console.error("Set it with: export GEMINI_API_KEY='your-api-key-here'");
} else {
    console.log("✓ GEMINI_API_KEY successfully loaded.");
    console.log(`✓ Using model: ${MODEL_NAME}`);
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
    console.log(`✓ HTTP Server listening on port ${PORT}`);
});

// 5. Initialize WebSocket Server
const wss = new WebSocketServer({ server });

// 6. Function to call Gemini Vision API using official format from documentation
async function recognizeSanskritText(base64ImageData) {
    if (!API_KEY) {
        console.error("API Key is missing at call time. Check environment configuration.");
        return "Recognition Failed: API Key Missing.";
    }
    
    // Check for blank/minimal canvas
    if (base64ImageData.length < 5000) { 
        console.warn("Image data is very small. User likely submitted a blank or near-blank canvas.");
        return "Recognition Failed: Please write clearly (ensure dark, thick lines) before recognizing.";
    }

    console.log(`📤 Attempting to recognize image... (${base64ImageData.length} bytes)`);

    // Clean and prepare the base64 data
    const cleanBase64 = base64ImageData.replace(/^data:image\/png;base64,/, '');

    // Official API request format from documentation
    const payload = {
        contents: [{
            parts: [
                {
                    text: "You are an OCR system specialized in Sanskrit Devanagari script. Carefully analyze the handwritten text in this image and transcribe ONLY the Sanskrit characters you can clearly recognize. Output only the Devanagari text, nothing else. If no clear text is visible or the image is blank, respond with exactly: NO_TEXT"
                },
                {
                    inline_data: {
                        mime_type: "image/png",
                        data: cleanBase64
                    }
                }
            ]
        }],
        generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
            topK: 1,
            topP: 0.95
        },
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
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-goog-api-key': API_KEY  // Official header format
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        
        // Enhanced error handling
        if (!response.ok) {
            console.error(`❌ API Request Failed (HTTP ${response.status}):`);
            console.error(JSON.stringify(result, null, 2));
            
            if (response.status === 400) {
                if (result.error?.message?.includes("API key")) {
                    return "Recognition Failed: Invalid API key. Check your GEMINI_API_KEY.";
                }
                if (result.error?.message?.includes("model") || result.error?.message?.includes("not found")) {
                    return `Recognition Failed: Model '${MODEL_NAME}' not available. Check API access.`;
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
            return `Recognition Failed: HTTP Error ${response.status}`;
        }

        // Log the full response for debugging
        console.log("📥 API Response received");
        
        // Check for safety filtering
        if (result.candidates?.[0]?.finishReason === 'SAFETY') {
            console.warn("⚠ Content was filtered by safety settings");
            return "Recognition Failed: Content filtered by safety settings.";
        }
        
        // Extract recognized text from response
        const recognizedText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
        
        if (recognizedText) {
            const trimmedText = recognizedText.trim();
            
            // Handle explicit failure token
            if (trimmedText === 'NO_TEXT') {
                console.warn("⚠ Model returned NO_TEXT - no legible text detected");
                return "Recognition Failed: No legible text detected. Please write more clearly.";
            }

            console.log(`✅ Recognition successful: ${trimmedText}`);
            return trimmedText;
            
        } else {
            console.error("❌ API Response missing text candidate");
            console.error("Full response:", JSON.stringify(result, null, 2));
            return "Recognition Failed: Empty response from model.";
        }

    } catch (error) {
        console.error("❌ Error during Gemini API call:", error);
        
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            return "Recognition Failed: Network error. Check internet connection.";
        }
        if (error instanceof SyntaxError) {
            return "Recognition Failed: Invalid JSON response from API.";
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
                
                // Perform Recognition
                const recognizedText = await recognizeSanskritText(base64Image);

                // Broadcast the Recognized Text to all connected clients
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

console.log('\n🚀 Sanskrit Handwriting Recognition Server Ready!');
console.log(`📍 Local: http://localhost:${PORT}`);
console.log(`🔑 API Key Status: ${API_KEY ? 'Loaded' : 'MISSING'}`);
console.log(`🤖 Model: ${MODEL_NAME}\n`);