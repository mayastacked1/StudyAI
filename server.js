const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

app.post('/api/chat', async (req, res) => {
    try {
        const { prompt, history } = req.body;
        const apiKey = process.env.GEMINI_API_KEY; 

        if (!apiKey) {
            return res.status(500).json({ error: 'Missing GEMINI_API_KEY environment variable' });
        }

        console.log('📥 Received prompt:', prompt?.substring(0, 50) + '...');
        console.log('📜 History length:', history?.length || 0);

        // Format history for Google Gemini (requires 'model' instead of 'assistant')
        const formattedHistory = (history || []).map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        }));

        // Call Google Gemini API (Native Streaming Endpoint)
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${apiKey}`;
        console.log('🚀 Calling Gemini API:', apiUrl.split('?')[0]);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
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
                    // ✅ ADD THIS: Ensure we get text output
                    responseMimeType: "text/plain"
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ GEMINI API ERROR:", response.status, errorText);
            return res.status(response.status).json({ error: errorText || 'Upstream API Error' });
        }

        console.log('✅ API Response received, starting stream...');

        // ✅ IMPROVED: Better SSE headers with flush support
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering if used
        
        // Send initial connection message
        res.write('data: {"type":"connected"}\n\n');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let chunkCount = 0;
        let totalTextReceived = '';

        while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
                console.log(`🏁 Stream completed. Total chunks: ${chunkCount}, Text length: ${totalTextReceived.length}`);
                res.write('data: [DONE]\n\n');
                break;
            }
            
            buffer += decoder.decode(value, { stream: true });
            
            // Google streams chunks as a JSON array of objects. 
            // We split by newlines and parse any complete JSON objects.
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep the last incomplete chunk in the buffer

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === '[' || trimmed === ']') continue;
                
                try {
                    // Remove trailing commas if present
                    let cleanJson = trimmed;
                    if (cleanJson.endsWith(',')) cleanJson = cleanJson.slice(0, -1);
                    
                    const parsed = JSON.parse(cleanJson);
                    chunkCount++;
                    
                    // ✅ IMPROVED: More robust parsing with debugging
                    if (parsed.candidates && parsed.candidates[0]?.content?.parts) {
                        const textChunk = parsed.candidates[0].content.parts[0].text;
                        if (textChunk) {
                            totalTextReceived += textChunk;
                            // Wrap in OpenAI-like SSE format so our frontend parser handles it automatically
                            const sseData = `data: ${JSON.stringify({ content: textChunk })}\n\n`;
                            res.write(sseData);
                            
                            // Log first few chunks for debugging
                            if (chunkCount <= 3) {
                                console.log(`📤 Chunk ${chunkCount}:`, textChunk.substring(0, 50) + '...');
                            }
                        } else {
                            // Debug: Log when we get empty parts (known Gemini 2.5 issue)
                            if (chunkCount <= 5) {
                                console.log(`⚠️ Empty text in chunk ${chunkCount}:`, JSON.stringify(parsed.candidates[0]).substring(0, 100));
                            }
                        }
                    } else if (parsed.error) {
                        console.error('❌ API returned error:', parsed.error);
                    }
                } catch (e) {
                    // Ignore parsing errors for incomplete chunks - this is normal
                    if (trimmed.length > 0 && chunkCount < 10) {
                        console.log('⏳ Parsing incomplete chunk, waiting for more data...');
                    }
                }
            }
        }

        res.end();

    } catch (error) {
        console.error('💥 Server Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        } else {
            res.end();
        }
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🖥️  Server is running on port ${PORT}`);
});
