async function handleSend() {
    const input = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    // Cache the chat container outside the loop to prevent layout thrashing
    const chat = document.getElementById('messages');
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
            // Prevent leading newlines if text is empty
            fullMessage = fullMessage 
                ? `${fullMessage}\n\n--- Attached File: ${attachedFile.name} ---\n${fileContent}` 
                : `--- Attached File: ${attachedFile.name} ---\n${fileContent}`;
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
            // Add a catch here in case the error response isn't valid JSON
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Server Error: ${response.status}`);
        }

        // ====== STREAMING PARSER (SSE + Raw Text Fallback) ======
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            
            // Try splitting by double newlines (Standard SSE format)
            let events = buffer.split('\n\n');
            buffer = events.pop() || '';

            // Fallback: If no double newlines found, split by single newline (Raw text streaming)
            if (events.length === 0) {
                events = buffer.split('\n');
                buffer = events.pop() || '';
            }

            for (const event of events) {
                const trimmed = event.trim();
                if (!trimmed || trimmed.startsWith(':')) continue; // Skip heartbeats
                
                // Check if it's an SSE data line
                if (trimmed.startsWith('data: ')) {
                    const dataStr = trimmed.slice(6); // Remove "data: " prefix
                    if (dataStr === '[DONE]') continue;
                    
                    try {
                        const parsed = JSON.parse(dataStr);
                        // Foolproof extraction: checks common key names
                        const delta = parsed.content || parsed.text || parsed.delta || parsed.message;
                        
                        if (delta) {
                            fullResponse += delta;
                            bubble.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse, { renderer }));
                            chat.scrollTo({ top: chat.scrollHeight, behavior: 'auto' });
                        }
                    } catch (parseErr) {
                        // If JSON parse fails, treat it as raw text
                        fullResponse += dataStr;
                        bubble.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse, { renderer }));
                        chat.scrollTo({ top: chat.scrollHeight, behavior: 'auto' });
                    }
                } else {
                    // If it doesn't start with "data: ", it's raw text streaming
                    fullResponse += trimmed;
                    bubble.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse, { renderer }));
                    chat.scrollTo({ top: chat.scrollHeight, behavior: 'auto' });
                }
            }
        }
        // ====== END STREAMING PARSER ======

    } catch (error) {
        console.error('Stream error:', error);
        // Append error to existing response, or replace if empty
        if (!fullResponse) {
            fullResponse = `⚠️ Error: ${error.message}`;
        } else {
            fullResponse += `\n\n⚠️ Error: Stream interrupted: ${error.message}`;
        }
        bubble.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse, { renderer }));
    } finally {
        // Use finally to guarantee cleanup happens even if an error is thrown
        bubble.classList.remove('cursor-blink');
        bubble.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse, { renderer }));
        
        // Save to history
        conversationHistory.push({ role: 'assistant', content: fullResponse });
        saveCurrentChat();
        sendBtn.disabled = false;
    }
}
