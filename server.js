const express = require('express');
const path = require('path');
const app = express();
const Cerebras = require('@cerebras/cerebras_cloud_sdk');

app.use(express.json());

// Serve static files from the CURRENT directory
app.use(express.static(__dirname));

// Serve index.html from the current directory
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Using your provided API key
const client = new Cerebras({ apiKey: 'csk-cfnyfhfeved2k4yfnvfxeyfnwr5mpe5xmn2d3yc88ttvnmwp' });

app.post('/api/chat', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    const completion = await client.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama3-8b',
    });
    
    res.json({ reply: completion.choices[0].message.content });
  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ error: "Failed to fetch from Cerebras" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
