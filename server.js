const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// ✅ OPTIMIZED: Only try 2 models (avoid hitting multiple quotas)
const MODEL_FALLBACK_CHAIN = [
    'gemini-2.5-flash-lite',  // Primary: Has separate quota from 2.0-flash
    'gemini-2.5-flash'        // Backup
];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

app.post('/api/chat', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { prompt, history } = req.body;
        const apiKey = process.env.GEMINI_API_KEY; 

        if (!apiKey) {
            return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
        }

        console.log('\n' + '⚡'.repeat(25));
        console.log(`📥 [${new Date().toLocaleTimeString()}] PROMPT:`, prompt?.substring(0, 60));
        console.log(`📜 History: ${history?.length || 0} messages`);

        const formattedHistory = (history || []).map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        }));

        let lastError = null;
        
        for (let modelIndex = 0; modelIndex < MODEL_FALLBACK_CHAIN.length; modelIndex++) {
            const modelName = MODEL_FALLBACK_CHAIN[modelIndex];
            
            // ✅ Try non-streaming first (faster and more reliable)
            const result = await callGeminiAPI(modelName, apiKey, formattedHistory, prompt);
            
            if (result.success) {
                // ✅ SPEED FIX: Send response instantly without artificial delays
                const elapsed = Date.now() - startTime;
                console.log(`✅ Response ready in ${elapsed}ms (${result.text.length} chars)`);
                console.log(`📝 "${result.text.substring(0, 80)}..."`);
                
                // Send as SSE immediately
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                
                res.write(`data: ${JSON.stringify({ type: 'connected', model: modelName })}\n\n`);
                
                // ✅ SPEED FIX: Send entire response at once (no fake typing delay)
                res.write(`data: ${JSON.stringify({ content: result.text })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
                
                console.log(`⚡ Sent to client in ${Date.now() - startTime}ms total\n`);
                return;
            }
            
            lastError = result.error;
            
            // ✅ RATE LIMIT FIX: Handle 429 errors properly
            if (result.rateLimited) {
                console.log(`\n⏳ Rate limited on ${modelName}`);
                if (result.retryAfter) {
                    console.log(`   ⏱️  Must wait ${Math.ceil(result.retryAfter / 1000)}s before retry`);
                    // Don't actually wait here, just try next model
                }
                continue; // Try next model
            }
            
            // For other errors, wait briefly then retry same model once
            if (!result.fatal && modelIndex === 0) {
                console.log(`   ⏳ Retrying ${modelName}...`);
                await sleep(500);
                const retryResult = await callGeminiAPI(modelName, apiKey, formattedHistory, prompt);
                if (retryResult.success) {
                    sendSuccessResponse(res, modelName, retryResult.text, startTime);
                    return;
                }
                lastError = retryResult.error;
            }
        }

        // All failed
        console.error('\n❌ ALL MODELS FAILED');
        if (!res.headersSent) {
            res.status(lastError?.code === 429 ? 429 : 503).json({ 
                error: lastError?.message || 'All AI models unavailable',
                suggestion: lastError?.code === 429 
                    ? 'Rate limit exceeded. Wait a minute or upgrade your API plan.'
                    : 'Please try again later.',
                retryAfter: lastError?.retryAfter
            });
        }

    } catch (error) {
        console.error('💥 ERROR:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// ✅ NEW: Clean API calling function
async function callGeminiAPI(modelName, apiKey, formattedHistory, prompt) {
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
                    maxOutputTokens: 1024  // Limit output for speed
                }
            })
        });

        // Handle rate limiting
        if (response.status === 429) {
            const errorData = await response.json().catch(() => ({}));
            let retryAfter = null;
            
            // Extract retry-after from Google's error response
            if (errorData.error?.details) {
                for (const detail of errorData.error.details) {
                    if (detail['@type']?.includes('RetryInfo') && detail.retryDelay) {
                        // Parse "48s" format
                        const match = detail.retryDelay.match(/(\d+)s/);
                        if (match) retryAfter = parseInt(match[1]) * 1000;
                    }
                }
            }
            
            return {
                success: false,
                rateLimited: true,
                fatal: true,
                error: { code: 429, message: 'Rate limited', retryAfter },
                retryAfter
            };
        }

        // Handle other errors
        if (!response.ok) {
            const errorText = await response.text();
            const isFatal = response.status === 404; // Model not found
            
            return {
                success: false,
                rateLimited: false,
                fatal: isFatal,
                error: { code: response.status, message: errorText.substring(0, 100) },
                retryAfter: null
            };
        }

        // Parse successful response
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!text || text.trim().length === 0) {
            return {
                success: false,
                rateLimited: false,
                fatal: false,
                error: { message: 'Empty response from API' },
                retryAfter: null
            };
        }

        return {
            success: true,
            text: text,
            model: modelName
        };

    } catch (error) {
        return {
            success: false,
            rateLimited: false,
            fatal: false,
            error: { message: error.message },
            retryAfter: null
        };
    }
}

// Helper to send success response
function sendSuccessResponse(res, modelName, text, startTime) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    res.write(`data: ${JSON.stringify({ type: 'connected', model: modelName })}\n\n`);
    res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    
    console.log(`⚡ Total time: ${Date.now() - startTime}ms\n`);
}

// ✅ IMPROVED: Status endpoint
app.get('/api/status', async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    const results = {};
    
    for (const model of MODEL_FALLBACK_CHAIN) {
        try {
            const testResponse = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
                        generationConfig: { maxOutputTokens: 10 }
                    })
                })
                .catch(() => ({ status: 'network_error' }));
            
            results[model] = {
                status: testResponse.status === 200 ? '✅ Available' : `❌ ${testResponse.status}`,
                note: testResponse.status === 429 ? '(Rate limited)' : ''
            };
        } catch (e) {
            results[model] = { status: '❌ Error', note: e.message };
        }
    }
    
    res.json({
        timestamp: new Date().toISOString(),
        models: results,
        tip: 'If all show 429, wait ~1 min or check https://ai.dev/rate-limit'
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n${'⚡'.repeat(50)}`);
    console.log(`🖥️  Server running on http://localhost:${PORT}`);
    console.log(`📡 Models: ${MODEL_FALLBACK_CHAIN.join(', ')}`);
    console.log(`📊 Check status: GET http://localhost:${PORT}/api/status`);
    console.log(`${'⚡'.repeat(50)}\n`);
});
