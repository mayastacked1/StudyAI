const express = require('express');
const path = require('path');
const app = express();
const Cerebras = require('@cerebras/cerebras_cloud_sdk');

app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const client = new Cerebras({ apiKey: 'csk-rwm3c49pr8krmdf2td5we6dj6kkvp3kn6dh53kk36mjk4tjm' });

app.post('/api/chat', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    // Strict system constraints applied here
    const completion = await client.chat.completions.create({
      messages: [
        { 
          role: 'system', 
          content: 'You are StudyAI. Follow these rules: 1. You are a helpful academic assistant. 2. Provide direct, concise answers. 3. NEVER introduce yourself or mention your name unless the user specifically asks "Who are you?" or "What is your name?". 4. Do not use filler phrases like "I am StudyAI" at the start of your responses. 5. If the user asks who you are, identify yourself as StudyAI.' 
        },
        { role: 'user', content: prompt }
      ],
      model: 'gpt-oss-120b',
    });
    
    res.json({ reply: completion.choices[0].message.content });
  } catch (error) {
    console.error("API Error Details:", error.message);
    res.status(500).json({ error: "API Connection Error: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`StudyAI Server running on port ${PORT}`));
