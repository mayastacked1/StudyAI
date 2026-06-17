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

        // ====== PROPER SSE PARSING ======
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            
            // SSE events are separated by double newlines
            const events = buffer.split('\n\n');
            // Keep the last incomplete chunk in the buffer
            buffer = events.pop() || '';

            for (const event of events) {
                const lines = event.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    
                    // Skip empty lines and heartbeat comments
                    if (!trimmed || trimmed.startsWith(':')) continue;
                    
                    if (trimmed.startsWith('data: ')) {
                        const dataStr = trimmed.slice(6); // Remove "data: " prefix
                        
                        if (dataStr === '[DONE]') continue;
                        
                        try {
                            const parsed = JSON.parse(dataStr);
                            
                            // Foolproof extraction: checks common key names just in case
                            const delta = parsed.content || parsed.text || parsed.delta || parsed.message;
                            
                            if (delta) {
                                fullResponse += delta;
                                
                                // Render markdown safely
                                bubble.innerHTML = DOMPurify.sanitize(
                                    marked.parse(fullResponse, { renderer })
                                );
                                
                                // Auto-scroll to bottom
                                chat.scrollTo({ top: chat.scrollHeight, behavior: 'auto' });
                            } else if (typeof parsed === 'string') {
                                // Fallback if backend sends a raw string instead of an object
                                fullResponse += parsed;
                                bubble.innerHTML = DOMPurify.sanitize(
                                    marked.parse(fullResponse, { renderer })
                                );
                                chat.scrollTo({ top: chat.scrollHeight, behavior: 'auto' });
                            }
                        } catch (parseErr) {
                            console.warn('Could not parse SSE chunk:', dataStr, parseErr);
                        }
                    }
                }
            }
        }
        // ====== END SSE PARSING ======

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
