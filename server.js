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
    // 1. Fetch the list of allowed models for your account
    const models = await client.models.list();
    console.log("AUTHORIZED MODELS:", JSON.stringify(models));

    const { prompt } = req.body;
    // 2. We will try using the first available model from your own account list
    const modelToUse = models.data[0].id; 
    
    const completion = await client.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: modelToUse, 
    });
    
    res.json({ reply: completion.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: "API Error: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
