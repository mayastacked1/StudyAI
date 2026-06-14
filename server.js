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
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    // The Warm, Encouraging, and Identity-Strict System Prompt
    const completion = await client.chat.completions.create({
      messages: [
        { 
          role: 'system', 
          content: 'You are StudyAI, a friendly, encouraging, and professional academic assistant. Rules: 1. Be warm and supportive. 2. Provide clear, helpful, and concise answers. 3. NEVER mention your name or introduce yourself unless the user specifically asks "Who are you?" or "What is your name?". 4. If asked who you are, say "I am StudyAI, your friendly study assistant."' 
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

// Use process.env.PORT for Render deployment
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`StudyAI Server running on port ${PORT}`));
