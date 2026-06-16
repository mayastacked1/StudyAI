async function handleSend() {
    const input = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const text = input.value.trim();
    
    // Don't send if input is empty and no file is attached
    if (!text && !attachedFile) return;

    sendBtn.disabled = true;
    input.value = '';
    input.style.height = 'auto';

    let fullMessage = text;
    
    // Handle file attachments
    if (attachedFile) {
        try {
            const fileContent = await readFileAsText(attachedFile);
            fullMessage += `\n\n--- Attached File: ${attachedFile.name} ---\n${fileContent}`;
        } catch (e) {
            console.error("Failed to read file", e);
        }
        attachedFile = null;
        fileNameDisplay.classList.add('hidden');
        fileInput.value = '';
    }

    // Add user message to UI and history
    conversationHistory.push({ role: 'user', content: fullMessage });
    createMessageElement('user', fullMessage, false);
    generateTitle(fullMessage);

    // Create AI message placeholder with streaming cursor
    const { bubble } = createMessageElement('assistant', '', true);
    let fullResponse = '';

    try {
        // Call your backend API
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: fullMessage,
                history: conversationHistory // Send the history your backend expects
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || `Server Error: ${response.status}`);
        }

        // ====== THIS IS THE FIX: PROPER SSE PARSING ======
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Decode the chunk and add to buffer
            buffer += decoder.decode(value, { stream: true });
            
            // Split by newlines to process each SSE line
            const lines = buffer.split('\n');
            
            // Keep the last incomplete line in the buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                
                // Skip empty lines and heartbeat comments from your server
                if (!trimmed || trimmed.startsWith(':')) continue;
                
                // Check if it's an SSE data line
                if (trimmed.startsWith('data: ')) {
                    const dataStr = trimmed.slice(6); // Remove "data: " prefix
                    
                    // Check for stream end
                    if (dataStr === '[DONE]') continue;
                    
                    try {
                        const parsed = JSON.parse(dataStr);
                        // Your backend sends { content: "..." }, so we extract it here
                        const delta = parsed.content; 
                        
                        if (delta) {
                            fullResponse += delta;
                            // Render markdown safely
                            bubble.innerHTML = DOMPurify.sanitize(
                                marked.parse(fullResponse, { renderer })
                            );
                            // Auto-scroll to bottom
                            const chat = document.getElementById('messages');
                            chat.scrollTo({ top: chat.scrollHeight, behavior: 'auto' });
                        }
                    } catch (parseErr) {
                        console.warn('Could not parse SSE chunk:', trimmed);
                    }
                }
            }
        }
        // ====== END SSE FIX ======

    } catch (error) {
        console.error('Stream error:', error);
        fullResponse = fullResponse || `⚠️ Error: ${error.message}`;
        bubble.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse, { renderer }));
    }

    // Remove cursor blink, do final render
    bubble.classList.remove('cursor-blink');
    bubble.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse, { renderer }));

    // Save to history
    conversationHistory.push({ role: 'assistant', content: fullResponse });
    saveCurrentChat();
    sendBtn.disabled = false;
}
