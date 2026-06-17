const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// ✅ GROQ CONFIGURATION
const GROQ_API_KEY = process.env.GROQ_API_KEY; // YES! Use this on Render
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

// Fallback models (try these in order)
const MODEL_FALLBACK_CHAIN = [
    'llama-3.3-70b-versatile',  // Primary: Fast & smart
    'mixtral-8x7b-32768'        // Backup
];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

app.post('/api/chat', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { prompt, history } = req.body;

        if (!GROQ_API_KEY) {
            return res.status(500).json({ 
                error: 'Missing GROQ_API_KEY',
                setup: 'Get free key: https://console.groq.com/keys'
            });
        }

        console.log('\n' + '⚡'.repeat(25));
        console.log(`📥 [${new Date().toLocaleTimeString()}] PROMPT:`, prompt?.substring(0, 60));
        console.log(`📜 History: ${history?.length || 0} messages`);

        let lastError = null;
        
        for (let modelIndex = 0; modelIndex < MODEL_FALLBACK_CHAIN.length; modelIndex++) {
            const modelName = MODEL_FALLBACK_CHAIN[modelIndex];
            
            const result = await callGroqAPI(modelName, history, prompt);
            
            if (result.success) {
                const elapsed = Date.now() - startTime;
                console.log(`✅ Response ready in ${elapsed}ms (${result.text.length} chars)`);
                console.log(`📝 "${result.text.substring(0, 80)}..."`);
                
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                
                res.write(`data: ${JSON.stringify({ type: 'connected', model: modelName })}\n\n`);
                res.write(`data: ${JSON.stringify({ content: result.text })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
                
                console.log(`⚡ Sent to client in ${Date.now() - startTime}ms total\n`);
                return;
            }
            
            lastError = result.error;
            
            if (result.rateLimited) {
                console.log(`\n⏳ Rate limited on ${modelName}`);
                continue;
            }
            
            if (!result.fatal && modelIndex === 0) {
                console.log(`   ⏳ Retrying ${modelName}...`);
                await sleep(500);
                const retryResult = await callGroqAPI(modelName, history, prompt);
                if (retryResult.success) {
                    sendSuccessResponse(res, modelName, retryResult.text, startTime);
                    return;
                }
                lastError = retryResult.error;
            }
        }

        console.error('\n❌ ALL MODELS FAILED');
        if (!res.headersSent) {
            res.status(lastError?.code === 429 ? 429 : 503).json({ 
                error: lastError?.message || 'All AI models unavailable',
                suggestion: lastError?.code === 429 
                    ? 'Rate limit exceeded. Wait a minute.'
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

// ✅ UPDATED: Groq API calling function (OpenAI-compatible format)
async function callGroqAPI(modelName, history, prompt) {
    try {
        const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: modelName,
                messages: [
                    {
                        role: 'system',
                        content: 'You are Aiserie, a helpful study assistant created by Vision. Be concise and helpful.'
                    },
                    ...(history || []).map(msg => ({
                        role: msg.role === 'assistant' ? 'assistant' : 'user',
                        content: msg.content
                    })),
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 1024,
                stream: false // Non-streaming for reliability
            })
        });

        if (response.status === 429) {
            return {
                success: false,
                rateLimited: true,
                fatal: true,
                error: { code: 429, message: 'Rate limited' },
                retryAfter: null
            };
        }

        if (!response.ok) {
            const errorText = await response.text();
            const isFatal = response.status === 404;
            
            return {
                success: false,
                rateLimited: false,
                fatal: isFatal,
                error: { code: response.status, message: errorText.substring(0, 100) },
                retryAfter: null
            };
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content;
        
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

// Status endpoint
app.get('/api/status', async (req, res) => {
    const results = {};
    
    for (const model of MODEL_FALLBACK_CHAIN) {
        try {
            const testResponse = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${GROQ_API_KEY}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: 'hi' }],
                    max_tokens: 10
                })
            }).catch(() => ({ status: 'network_error' }));
            
            results[model] = {
                status: testResponse.status === 200 ? '✅ Available' : `❌ ${testResponse.status}`,
                note: testResponse.status === 429 ? '(Rate limited)' : ''
            };
        } catch (e) {
            results[model] = { status: '❌ Error', note: e.message };
        }
    }
    
    res.json({
        provider: 'Groq',
        timestamp: new Date().toISOString(),
        models: results,
        apiKeySet: !!GROQ_API_KEY
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n${'⚡'.repeat(50)}`);
    console.log(`🖥️  Server running on http://localhost:${PORT}`);
    console.log(`🤖 Provider: GROQ (FREE & FAST!)`);
    console.log(`📡 Models: ${MODEL_FALLBACK_CHAIN.join(', ')}`);
    console.log(`🔑 API Key: ${GROQ_API_KEY ? '✅ Set' : '❌ Missing - Set GROQ_API_KEY'}`);
    console.log(`📊 Check status: GET http://localhost:${PORT}/api/status`);
    console.log(`${'⚡'.repeat(50)}\n`);
});
