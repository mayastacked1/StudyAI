const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const MAX_RETRIES = 3;
const MODEL_FALLBACK_CHAIN = [
    'gemini-2.5-flash-lite',  // Try lite first (more reliable right now)
    'gemini-2.5-flash',
    'gemini-2.0-flash'
];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms + Math.random() * 1000));
}

app.post('/api/chat', async (req, res) => {
    try {
        const { prompt, history } = req.body;
        const apiKey = process.env.GEMINI_API_KEY; 

        if (!apiKey) {
            return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
        }

        console.log('\n' + '='.repeat(50));
        console.log('📥 PROMPT:', prompt?.substring(0, 80));
        console.log('📜 HISTORY:', history?.length || 0, 'messages');

        const formattedHistory = (history || []).map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        }));

        let lastError = null;
        
        for (let modelIndex = 0; modelIndex < MODEL_FALLBACK_CHAIN.length; modelIndex++) {
            const modelName = MODEL_FALLBACK_CHAIN[modelIndex];
            console.log(`\n🔄 Trying: ${modelName}`);

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    console.log(`   Attempt ${attempt}/${MAX_RETRIES}`);
                    
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
                                parts: [{ 
                                    text: 'You are Aiserie, a helpful study assistant by Vision. Be concise and helpful.' 
                                }]
                            },
                            generationConfig: {
                                temperature: 0.7,
                                maxOutputTokens: 1024
                            }
                        })
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error(`   ❌ Error ${response.status}:`, errorText.substring(0, 150));
                        
                        if (response.status === 503 && attempt < MAX_RETRIES) {
                            console.log(`   ⏳ Waiting ${attempt}s...`);
                            await sleep(attempt * 1000);
                            continue;
                        }
                        
                        if (response.status === 404) {
                            console.log(`   ⏭️  Model not found, skipping...`);
                            break;
                        }
                        
                        lastError = errorText;
                        if (attempt < MAX_RETRIES) {
                            await sleep(attempt * 1000);
                            continue;
                        }
                        throw new Error(errorText);
                    }

                    // ✅ FIXED: Stream the response properly
                    console.log(`   ✅ Success! Streaming from ${modelName}...`);
                    return await handleStream(res, response, modelName);

                } catch (error) {
                    console.error(`   💥 Failed:`, error.message);
                    lastError = error;
                    if (attempt < MAX_RETRIES) await sleep(attempt * 1000);
                }
            }
        }

        // All models failed
        console.error('\n🚨 ALL MODELS FAILED');
        if (!res.headersSent) {
            res.status(503).json({ 
                error: 'All models unavailable. Try again later.',
                details: lastError?.message
            });
        }

    } catch (error) {
        console.error('💥 SERVER ERROR:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// ✅ FIXED: Proper streaming function
async function handleStream(res, response, modelName) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    // ✅ FIX #1: No more NaN!
    res.write(`data: ${JSON.stringify({ type: 'connected', model: modelName })}\n\n`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;
    let totalText = '';

    while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
            console.log(`\n📊 Stream Stats:`);
            console.log(`   Chunks received: ${chunkCount}`);
            console.log(`   Total text length: ${totalText.length}`);
            console.log(`   Content: "${totalText.substring(0, 100)}..."`);
            
            res.write('data: [DONE]\n\n');
            res.end();
            return;
        }
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            
            // Skip empty lines and array brackets
            if (!trimmed || trimmed === '[' || trimmed === ']') continue;
            
            try {
                // Clean up JSON
                let cleanJson = trimmed;
                if (cleanJson.endsWith(',')) cleanJson = cleanJson.slice(0, -1);
                
                const parsed = JSON.parse(cleanJson);
                chunkCount++;
                
                // ✅ FIX #2: Better debugging - log raw structure
                if (chunkCount <= 3) {
                    console.log(`\n📦 Chunk ${chunkCount} raw:`);
                    console.log(JSON.stringify(parsed).substring(0, 300));
                }
                
                // Extract text from Gemini's response format
                if (parsed.candidates?.[0]?.content?.parts?.[0]?.text) {
                    const textChunk = parsed.candidates[0].content.parts[0].text;
                    totalText += textChunk;
                    
                    // Send to frontend in OpenAI format
                    res.write(`data: ${JSON.stringify({ content: textChunk })}\n\n`);
                    
                    if (chunkCount <= 3) {
                        console.log(`✅ Text: "${textChunk.substring(0, 50)}..."`);
                    }
                } else if (parsed.error) {
                    console.error('❌ API Error in chunk:', parsed.error);
                } else {
                    // Debug: Show what we got
                    if (chunkCount <= 5) {
                        console.log(`⚠️  No text in chunk ${chunkCount}, keys:`, Object.keys(parsed));
                    }
                }
                
            } catch (e) {
                // Ignore incomplete JSON (normal)
            }
        }
    }
}

// ✅ NEW: Add a simple test endpoint
app.post('/api/test', async (req, res) => {
    try {
        const { prompt } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;
        
        console.log('\n🧪 TESTING NON-STREAMING...');
        
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt || 'Hello' }] }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: 256 }
                })
            }
        );
        
        const data = await response.json();
        
        console.log('\n📋 FULL API RESPONSE:');
        console.log(JSON.stringify(data, null, 2));
        
        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
            console.log('\n✅ SUCCESS! Response:', data.candidates[0].content.parts[0].text);
        } else {
            console.log('\n❌ NO TEXT IN RESPONSE');
        }
        
        res.json(data);
        
    } catch (error) {
        console.error('💥 Test error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🖥️  Server running on http://localhost:${PORT}`);
    console.log(`📡 Models: ${MODEL_FALLBACK_CHAIN.join(', ')}`);
    console.log(`🧪 Test endpoint: POST /api/test`);
    console.log(`${'='.repeat(50)}\n`);
});
