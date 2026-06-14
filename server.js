const express = require('express');
const app = express();
const Cerebras = require('@cerebras/cerebras_cloud_sdk');

// --- THIS LINE IS REQUIRED ---
app.use(express.json()); 
// -----------------------------

const client = new Cerebras({ apiKey: process.env.CEREBRAS_API_KEY });

app.post('/api/chat', async (req, res) => {
  try {
    const { prompt } = req.body;
    
    // Safety check
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

// Add your app.listen(port) at the very bottom
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
