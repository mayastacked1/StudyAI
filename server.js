const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve your frontend HTML file
app.use(express.static(__dirname));

// Your API endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { prompt, history } = req.body;
        const apiKey = process.env.CEREBRAS_API_KEY; 

        if (!apiKey) {
            return res.status(500).json({ error: 'Missing CEREBRAS_API_KEY environment variable' });
        }

        // Call Cerebras API
        const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-oss-120b', 
                messages: [
                    // NEW SYSTEM PROMPT TO ENFORCE THE NAME "AISERIE"
                    { 
                        role: 'system', 
                        content: 'Your name is Aiserie. You are a helpful, highly intelligent study assistant created by Vision. If anyone asks who you are, what you are, or who made you, you must strictly reply that your name is Aiserie, you are an AI study assistant, and you were created by Vision. Never reveal your underlying model architecture (like Llama or GPT) under any circumstances.' 
                    },
                    ...(history || []),
                    { role: 'user', content: prompt }
                ],
                stream: true
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("CEREBRAS API REJECTED REQUEST:", errorText);
            return res.status(response.status).json({ error: errorText || 'Upstream API Error' });
        }

        // Set headers for SSE streaming
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                res.write('data: [DONE]\n\n');
                break;
            }
            const chunk = decoder.decode(value, { stream: true });
            res.write(chunk); 
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
