const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const MAX_RETRIES = 3;
const MODEL_FALLBACK_CHAIN = [
    'gemini-2.0-flash',      // Start with older stable model
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash'
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
            console.log(`\n🔄 Trying model: ${modelName}`);

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    console.log(`   Attempt ${attempt}/${MAX_RETRIES}`);
                    
                    // ✅ STRATEGY: Try non-streaming first (more reliable)
                    if (attempt === 1) {
                        console.log(`   📡 Using NON-STREAMING mode...`);
                        const success = await tryNonStreaming(res, modelName, apiKey, formattedHistory, prompt);
                        if (success) return; // Success! Exit early
                    } else {
                        // Fallback to streaming for retries
                        console.log(`   📡 Using STREAMING mode...`);
                        const success = await tryStreaming(res, modelName, apiKey, formattedHistory, prompt);
                        if (success) return;
                    }
                    
                    await sleep(attempt * 1000);
                    
                } catch (error) {
                    console.error(`   💥 Failed:`, error.message?.substring(0, 100));
                    lastError = error;
                    if (attempt < MAX_RETRIES) await sleep(attempt * 1000);
                }
            }
        }

        console.error('\n🚨 ALL MODELS FAILED');
        if (!res.headersSent) {
            res.status(503).json({ 
                error: 'All AI models are currently unavailable.',
                details: lastError?.message,
                suggestion: 'Please try again in a few minutes.'
            });
        }

    } catch (error) {
        console.error('💥 SERVER ERROR:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// ✅ NEW: Non-streaming approach (MORE RELIABLE!)
async function tryNonStreaming(res, modelName, apiKey, formattedHistory, prompt) {
    try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        
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
                        text: 'You are Aiserie, a helpful study assistant created by Vision. Be concise and helpful.' 
                    }]
                },
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 2048
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            
            if (response.status === 503) {
                console.log(`   ⚠️  Model overloaded (503), will retry...`);
                return false; // Signal to retry
            }
            
            if (response.status === 404) {
                console.log(`   ❌ Model not found (404), skipping...`);
                return false; // Signal to try next model
            }
            
            throw new Error(`${response.status}: ${errorText.substring(0, 100)}`);
        }

        const data = await response.json();
        
        // Debug log
        console.log('\n📦 Raw API Response:');
        console.log(JSON.stringify(data, null, 2).substring(0, 500));

        // Extract text
        let fullText = '';
        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
            fullText = data.candidates[0].content.parts[0].text;
        } else if (data.error) {
            throw new Error(data.error.message || 'API returned error');
        } else {
            console.log('⚠️  Unexpected response format');
            console.log('Keys:', Object.keys(data));
            return false;
        }

        if (!fullText || fullText.trim().length === 0) {
            console.log('⚠️  Empty response from API');
            return false;
        }

        // ✅ SUCCESS! Send as SSE (simulated stream)
        console.log(`\n✅ SUCCESS! Got ${fullText.length} characters`);
        console.log(`📝 Content: "${fullText.substring(0, 100)}..."`);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        res.write(`data: ${JSON.stringify({ type: 'connected', model: modelName })}\n\n`);
        
        // Simulate streaming by sending in chunks (better UX)
        const chunkSize = 20; // Send 20 chars at a time
        for (let i = 0; i < fullText.length; i += chunkSize) {
            const chunk = fullText.slice(i, i + chunkSize);
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
            // Small delay to simulate typing effect (optional)
            await new Promise(r => setTimeout(r, 10)); 
        }
        
        res.write('data: [DONE]\n\n');
        res.end();
        
        return true; // Success!

    } catch (error) {
        console.error(`   ❌ Non-streaming failed:`, error.message);
        return false;
    }
}

// Streaming approach (as fallback)
async function tryStreaming(res, modelName, apiKey, formattedHistory, prompt) {
    try {
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
                        text: 'You are Aiserie, a helpful study assistant created by Vision.' 
                    }]
                },
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 2048
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            if (response.status === 503 || response.status === 404) {
                return false;
            }
            throw new Error(errorText);
        }

        console.log(`   ✅ Stream connected, reading data...`);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        res.write(`data: ${JSON.stringify({ type: 'connected', model: modelName })}\n\n`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let chunkCount = 0;
        let totalText = '';

        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                console.log(`   📊 Stream ended: ${chunkCount} chunks, ${totalText.length} chars`);
                
                if (totalText.length === 0) {
                    console.log('   ⚠️  Empty stream!');
                    return false;
                }
                
                res.write('data: [DONE]\n\n');
                res.end();
                return true;
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

                    if (parsed.candidates?.[0]?.content?.parts?.[0]?.text) {
                        const textChunk = parsed.candidates[0].content.parts[0].text;
                        totalText += textChunk;
                        res.write(`data: ${JSON.stringify({ content: textChunk })}\n\n`);
                    }
                } catch (e) {}
            }
        }

    } catch (error) {
        console.error(`   ❌ Streaming failed:`, error.message);
        return false;
    }
}

// Test endpoint
app.post('/api/test', async (req, res) => {
    try {
        const { prompt } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;

        console.log('\n🧪 RAW API TEST...');
        
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt || 'Say hello' }] }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: 256 }
                })
            }
        );

        const data = await response.json();
        
        console.log('\n📋 STATUS:', response.status);
        console.log('📦 RESPONSE:');
        console.log(JSON.stringify(data, null, 2));

        res.json({
            status: response.status,
            hasContent: !!data.candidates?.[0]?.content?.parts?.[0]?.text,
            text: data.candidates?.[0]?.content?.parts?.[0]?.text || 'NO TEXT',
            raw: data
        });

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
    console.log(`💡 Strategy: Non-streaming first, then streaming fallback`);
    console.log(`${'='.repeat(50)}\n`);
});
