const Cerebras = require('@cerebras/cerebras_cloud_sdk');
const client = new Cerebras({ apiKey: process.env.CEREBRAS_API_KEY });

app.post('/api/chat', async (req, res) => {
  const { prompt } = req.body;
  const completion = await client.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama3-8b', // or your preferred model
  });
  res.json({ reply: completion.choices[0].message.content });
});
