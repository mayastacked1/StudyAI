const express = require('express');
const path = require('path');
const app = express();
const Cerebras = require('@cerebras/cerebras_cloud_sdk');

// Middleware
app.use(express.json({ limit: '10mb' })); // Increased limit for file attachments
app.use(express.static(__dirname));

// Cerebras Client
const client = new Cerebras({ apiKey: process.env.CEREBRAS_API_KEY });

// Serve Frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Chat API Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { prompt, history } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    const messages = [
      { 
        role: 'system', 
        content: 'You are StudyAI, a friendly, highly intelligent, and encouraging academic assistant built by Vision. \n\nRULES:\n1. ORGANIZATION: If an answer is long, you MUST use Markdown to organize it. Use Headers (##) for sections and Bullet Points for lists.\n2. STYLE: Be professional, concise, and clear. Avoid fluff. Be encouraging to students.\n3. FORMATTING: Use code blocks for any code or data. Use LaTeX formatting for math where appropriate.\n4. FILE HANDLING: If the user provides a file context, analyze it thoroughly and base your answers on it.\n5. Do not introduce yourself unless asked.\n6. IMAGE GENERATION: If the user explicitly asks you to generate, draw, or create an image/picture, you MUST output a markdown image using this exact format: ![Image Description](https://image.pollinations.ai/prompt/A%20description%20of%20the%20image). \n\nIMPORTANT IMAGE RULES:\n- Replace the description part with a URL-encoded string of the requested image.\n- You can generate any style of image (art, sketch, diagram, realistic, cartoon, etc.) based on what the user asks for.\n- Do not output images unless specifically asked.' 
      },
      ...(history || []),
      { role: 'user', content: prompt }
    ];

    // Set SSE Headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Prevents nginx buffering

    // Heartbeat to keep connection alive during long generation times
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 12000);

    const stream = await client.chat.completions.create({
      messages,
      model: 'llama3.1-8b', // Updated to standard Cerebras model (change back to gpt-oss-120b if you have specific access)
      stream: true,
      temperature: 0.7,
      max_tokens: 4096,
    });

    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content || "";
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
    
    res.write('data: [DONE]\n\n');
    
    clearInterval(heartbeat);
    res.end();

  } catch (error) {
    console.error("Cerebras API Error:", error);
    
    // Handle Rate Limiting (SDK sometimes uses status, sometimes statusCode)
    const status = error.status || error.statusCode || 500;
    let errorMessage = error.message;
    
    if (status === 429) {
      errorMessage = "I'm experiencing high traffic right now. Please wait a moment and try again.";
    } else if (status === 401) {
      errorMessage = "API key is invalid or missing. Please check your server configuration.";
    }

    // If headers haven't been sent yet, send a standard JSON error
    if (!res.headersSent) {
      res.status(status).json({ error: errorMessage });
    } else {
      // If we are already streaming, send the error as a stream chunk so the UI shows it gracefully
      res.write(`data: ${JSON.stringify({ content: `\n\n⚠️ **Error:** ${errorMessage}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`StudyAI Server running on port ${PORT}`));
