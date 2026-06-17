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
        const apiKey = process.env.CEREBRAS_API_KEY; // Make sure to set this in Render!

        if (!apiKey) {
            return res.status(500).json({ error: 'Missing CEREBRAS_API_KEY environment variable' });
        }

        // Call Cerebras API (It is compatible with OpenAI SDK format)
        const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'llama3.1-8b', // or whatever model you are using
                messages: [
                    { role: 'system', content: 'You are StudyAI, a helpful study assistant.' },
                    ...(history || []),
                    { role: 'user', content: prompt }
                ],
                stream: true
            })
        });

        if (!response.ok) {
            // FIX: Get the exact error text from Cerebras and log it
            const errorText = await response.text();
            console.error("CEREBRAS API REJECTED REQUEST:", errorText);
            
            // Send the exact error back to the frontend
            return res.status(response.status).json({ error: errorText || 'Upstream API Error' });
        }

        // Set headers for SSE streaming
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        // Pipe the stream directly to the client
        // Your frontend handleSend() will parse this perfectly!
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                res.write('data: [DONE]\n\n');
                break;
            }
            const chunk = decoder.decode(value, { stream: true });
            res.write(chunk); // Forward raw chunks to frontend
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

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
