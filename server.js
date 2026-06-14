const express = require('express');
const path = require('path');
const app = express();
const Cerebras = require('@cerebras/cerebras_cloud_sdk');

app.use(express.json());

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Using your new API key
const client = new Cerebras({ apiKey: 'csk-rwm3c49pr8krmdf2td5we6dj6kkvp3kn6dh53kk36mjk4tjm' });

app.post('/api/chat', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    const completion = await client.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      // Using llama-3.3-70b, a highly compatible model
      model: 'llama-3.3-70b', 
    });
    
    res.json({ reply: completion.choices[0].message.content });
  } catch (error) {
    const errorMessage = error.message || "Unknown error occurred";
    console.error("Detailed API Error:", error);
    res.status(500).json({ error: "Cerebras API Error: " + errorMessage });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
