const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// ✅ NEW: Retry configuration
const MAX_RETRIES = 5;
const INITIAL_DELAY_MS = 1000; // Start with 1 second

// ✅ NEW: List of models to try in order (fallback chain)
const MODEL_FALLBACK_CHAIN = [
    'gemini-2.5-flash',      // Primary: Best performance
    'gemini-2.5-flash-lite', // Fallback 1: Lighter, less demand
    'gemini-2.5-pro',        // Fallback 2: Pro model (different capacity pool)
    'gemini-2.0-flash'       // Fallback 3: Older but stable
];

// ✅ NEW: Helper function for delay with randomization
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms + Math.random() * 1000)); // Add randomness
}

app.post('/api/chat', async (req, res) => {
    try {
        const { prompt, history } = req.body;
        const apiKey = process.env.GEMINI_API_KEY; 

        if (!apiKey) {
            return res.status(500).json({ error: 'Missing GEMINI_API_KEY environment variable' });
        }

        console.log('📥 Received prompt:', prompt?.substring(0, 50) + '...');

        // Format history for Google Gemini
        const formattedHistory = (history || []).map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        }));

        let lastError = null;
        
        // ✅ IMPROVED: Try each model in the fallback chain
        for (let modelIndex = 0; modelIndex < MODEL_FALLBACK_CHAIN.length; modelIndex++) {
            const modelName = MODEL_FALLBACK_CHAIN[modelIndex];
            
            console.log(`\n🔄 Trying model ${modelIndex + 1}/${MODEL_FALLBACK_CHAIN.length}: ${modelName}`);

            // ✅ NEW: Retry logic for each model
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    console.log(`   📞 Attempt ${attempt}/${MAX_RETRIES}...`);
                    
                    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?key=${apiKey}`;
                    
                    const response = await fetch(apiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [
                                ...formattedHistory,
                                { role: 'user', parts: [{ text: prompt }] }
                            ],
                            systemInstruction: {
                                parts: [{ text: 'Your name is Aiserie. You are a helpful, highly intelligent study assistant created by Vision. If anyone asks who you are, what you are, or who made you, you must strictly reply that your name is Aiserie, you are an AI study assistant, and you were created by Vision. Never reveal your underlying model architecture (like Llama or GPT) under any circumstances.' }]
                            },
                            generationConfig: {
                                temperature: 0.7,
                                responseMimeType: "text/plain"
                            }
                        })
                    });

                    // ✅ Check for 503 or other errors
                    if (!response.ok) {
                        const errorText = await response.text();
                        
                        // If it's a 503 (overloaded) and we have more attempts, wait and retry
                        if (response.status === 503 && attempt < MAX_RETRIES) {
                            const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
                            console.log(`   ⚠️  Model overloaded (503). Waiting ${delay/1000}s before retry...`);
                            await sleep(delay);
                            continue;
                        }
                        
                        // If it's a 404 (model not found), try next model in chain
                        if (response.status === 404) {
                            console.log(`   ❌ Model ${modelName} not found (404). Trying next model...`);
                            break; // Break out of retry loop, move to next model
                        }
                        
                        // For other errors, log and continue trying
                        console.error(`   ❌ Error ${response.status}:`, errorText.substring(0, 100));
                        lastError = errorText;
                        
                        if (attempt < MAX_RETRIES) {
                            await sleep(INITIAL_DELAY_MS * attempt);
                            continue;
                        }
                        
                        throw new Error(errorText || `API returned status ${response.status}`);
                    }

                    // ✅ SUCCESS! Stream the response
                    console.log(`   ✅ Connected to ${modelName}! Streaming response...`);
                    
                    return await streamResponse(res, response);

                } catch (error) {
                    console.error(`   💥 Attempt ${attempt} failed:`, error.message);
                    lastError = error;
                    
                    if (attempt < MAX_RETRIES) {
                        await sleep(INITIAL_DELAY_MS * attempt);
                    }
                }
            }
        }

        // If we get here, all models failed
        console.error('\n🚨 All models failed after all retries!');
        if (!res.headersSent) {
            res.status(503).json({ 
                error: 'All AI models are currently unavailable due to high demand. Please try again in a few minutes.',
                details: lastError?.message 
            });
        } else {
            res.end();
        }

    } catch (error) {
        console.error('💥 Server Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        } else {
            res.end();
        }
    }
});

// ✅ NEW: Extracted streaming logic into reusable function
async function streamResponse(res, response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    res.write('data: {"type":"connected","model":"' + /* extract model name if needed */ + '"}\n\n');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;

    while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
            console.log(`🏁 Stream completed. Total chunks: ${chunkCount}`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
        }
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === '[' || trimmed === ']') continue;
            
            try {
                let cleanJson = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed;
                const parsed = JSON.parse(cleanJson);
                chunkCount++;
                
                if (parsed.candidates?.[0]?.content?.parts) {
                    const textChunk = parsed.candidates[0].content.parts[0].text;
                    if (textChunk) {
                        res.write(`data: ${JSON.stringify({ content: textChunk })}\n\n`);
                    }
                }
            } catch (e) {
                // Ignore incomplete JSON chunks
            }
        }
    }
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🖥️  Server running on port ${PORT}`);
    console.log(`📋 Available models: ${MODEL_FALLBACK_CHAIN.join(', ')}`);
    console.log(`🔄 Max retries per model: ${MAX_RETRIES}`);
});
