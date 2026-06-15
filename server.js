const express = require('express');
const path = require('path');
const app = express();
const Cerebras = require('@cerebras/cerebras_cloud_sdk');

app.use(express.json());
app.use(express.static(__dirname));

// Initialize with your API key
// TODO: Move this to process.env.CEREBRAS_API_KEY for security!
const client = new Cerebras({ apiKey: 'csk-rwm3c49pr8krmdf2td5we6dj6kkvp3kn6dh53kk36mjk4tjm' });

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/chat', async (req, res) => {
  try {
    const { prompt, history } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    // System prompt & History handling
    const messages = [
      { 
        role: 'system', 
        content: 'You are StudyAI, a friendly, encouraging, and professional academic assistant. RULES: 1. Always be brief and prioritize scannability. 2. Use bullet points or short tables for data; avoid long paragraphs. 3. NEVER introduce yourself unless asked. 4. If asked who you are, say "I am StudyAI, your friendly study assistant."' 
      },
      ...(history || []),
      { role: 'user', content: prompt }
    ];

    // Enable Streaming for a professional feel
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await client.chat.completions.create({
      messages,
      model: 'gpt-oss-120b',
      stream: true, // Enable streaming
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
    
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error("API Error:", error.message);
    // Ensure we don't write headers if already sent
    if (!res.headersSent) {
        res.status(500).json({ error: "API Connection Error: " + error.message });
    } else {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`StudyAI Server running on port ${PORT}`));
