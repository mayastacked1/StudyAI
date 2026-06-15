const express = require('express');
const path = require('path');
const app = express();
const Cerebras = require('@cerebras/cerebras_cloud_sdk');

app.use(express.json());
app.use(express.static(__dirname));

// Initialize with your API key
const client = new Cerebras({ apiKey: 'csk-rwm3c49pr8krmdf2td5we6dj6kkvp3kn6dh53kk36mjk4tjm' });

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/chat', async (req, res) => {
  try {
    const { prompt, history } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    const messages = [
      { 
        role: 'system', 
        content: 'You are Aiserie, a futuristic, highly intelligent, and sleek AI assistant built into the StudyAI platform. You are helpful, concise, and use markdown formatting. You have a friendly but professional tone. Do not introduce yourself unless asked.' 
      },
      ...(history || []),
      { role: 'user', content: prompt }
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await client.chat.completions.create({
      messages,
      model: 'gpt-oss-120b',
      stream: true,
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
    if (!res.headersSent) res.status(500).json({ error: error.message });
    else {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`StudyAI Server running on port ${PORT}`));
