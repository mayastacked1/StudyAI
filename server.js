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

        // Format history for Google Gemini (requires 'model' instead of 'assistant')
        const formattedHistory = (history || []).map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        }));

        // Call Google Gemini API (Native Streaming Endpoint)
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?key=${apiKey}`, {
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
                    temperature: 0.7
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("GEMINI API REJECTED REQUEST:", errorText);
            return res.status(response.status).json({ error: errorText || 'Upstream API Error' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
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
                if (!trimmed || trimmed === '[') continue; // Skip empty lines and array starts
                
                try {
                    // Remove trailing commas if present
                    const cleanJson = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed;
                    const parsed = JSON.parse(cleanJson);
                    
                    if (parsed.candidates && parsed.candidates[0].content && parsed.candidates[0].content.parts) {
                        const textChunk = parsed.candidates[0].content.parts[0].text;
                        if (textChunk) {
                            // Wrap in OpenAI-like SSE format so our frontend parser handles it automatically
                            res.write(`data: ${JSON.stringify({ content: textChunk })}\n\n`);
                        }
                    }
                } catch (e) {
                    // Ignore parsing errors for incomplete chunks
                }
            }
        }

        res.end();

    } catch (error) {
        console.error('Server Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal Server Error' });
        } else {
            res.end();
        }
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
