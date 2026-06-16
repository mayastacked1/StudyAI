const express = require('express');
const path = require('path');
const app = express();
const Cerebras = require('@cerebras/cerebras_cloud_sdk');

app.use(express.json());
app.use(express.static(__dirname));

// FIX 1: Use Environment Variables for your API key!
// Never put your actual key string here. Set this in your hosting provider's dashboard.
const client = new Cerebras({ apiKey: process.env.CEREBRAS_API_KEY });

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
        content: 'You are Aiserie, a futuristic, highly intelligent, and formal academic assistant. \n\nRULES:\n1. ORGANIZATION: If an answer is long, you MUST use Markdown to organize it. Use Headers (##) for sections and Bullet Points for lists.\n2. STYLE: Be professional, concise, and clear. Avoid fluff.\n3. FORMATTING: Use code blocks for any code or data.\n4. FILE HANDLING: If the user provides a file context, analyze it thoroughly.\n5. Do not introduce yourself unless asked.\n6. IMAGE GENERATION: If the user explicitly asks you to generate, draw, or create an image/picture, you MUST output a markdown image using this EXACT format: ![Image Description](https://image.pollinations.ai/prompt/A%20highly%20detailed%20photorealistic%20prompt%20of%20the%20image?model=flux-realism) \n\nIMPORTANT IMAGE RULES:\n- You MUST include "?model=flux-realism" at the end of the URL.\n- You MUST include words like "photorealistic, 8k, ultra-detailed, realistic photography, cinematic lighting" in the URL-encoded description to ensure realistic output.\n- Replace the description part with a URL-encoded string of the requested image.\n- Do not output images unless specifically asked.' 
      },
      ...(history || []),
      { role: 'user', content: prompt }
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // FIX 2: Heartbeat to prevent hosting providers (like Render/Heroku) from timing out the connection
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n'); // SSE comment format, ignored by frontend
    }, 15000);

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
    
    // Clear heartbeat and end response
    clearInterval(heartbeat);
    res.end();

  } catch (error) {
    console.error("API Error:", error.message);
    
    // If it's a rate limit error, send a friendly message instead of crashing
    const errorMessage = (error.status === 429) 
      ? "I'm experiencing high traffic right now. Please wait a moment and try again." 
      : error.message;

    if (!res.headersSent) {
      res.status(error.status || 500).json({ error: errorMessage });
    } else {
      res.write(`data: ${JSON.stringify({ content: errorMessage })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Aiserie Server running on port ${PORT}`));
