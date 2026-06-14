const express = require('express');
const path = require('path');
const app = express();
const Cerebras = require('@cerebras/cerebras_cloud_sdk');

app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Initialize with your API key
const client = new Cerebras({ apiKey: 'csk-rwm3c49pr8krmdf2td5we6dj6kkvp3kn6dh53kk36mjk4tjm' });

app.post('/api/chat', async (req, res) => {
  try {
    const { prompt, history } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    // Prepare full conversation including system prompt and history
    const messages = [
      { 
        role: 'system', 
        content: 'You are StudyAI, a friendly, encouraging, and professional academic assistant. RULES: 1. Always be brief and prioritize scannability. 2. Use bullet points or short tables for data; avoid long paragraphs. 3. NEVER introduce yourself unless asked. 4. If asked who you are, say "I am StudyAI, your friendly study assistant."' 
      },
      ...(history || []), // Inject previous conversation history
      { role: 'user', content: prompt }
    ];

    const completion = await client.chat.completions.create({
      messages,
      model: 'gpt-oss-120b',
    });
    
    res.json({ reply: completion.choices[0].message.content });
  } catch (error) {
    console.error("API Error Details:", error.message);
    res.status(500).json({ error: "API Connection Error: " + error.message });
  }
});

// Use process.env.PORT for Render deployment
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`StudyAI Server running on port ${PORT}`));
