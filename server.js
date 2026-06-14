<script>
    // Load history on startup
    window.onload = () => {
        const savedChat = localStorage.getItem('studyAI_chat');
        if (savedChat) document.getElementById('messages').innerHTML = savedChat;
    };

    function toggleSettings() { document.getElementById('settings-modal').classList.toggle('hidden'); }

    function createNewChat() {
        document.getElementById('messages').innerHTML = '';
        localStorage.removeItem('studyAI_chat'); // Wipe saved data
        if (window.innerWidth < 768) document.getElementById('sidebar').classList.add('hidden');
    }

    async function handleSend() {
        const input = document.getElementById('user-input');
        const btn = document.getElementById('send-btn');
        const prompt = input.value.trim();
        if (!prompt) return;

        const chat = document.getElementById('messages');
        chat.innerHTML += `<div class="flex justify-end"><div class="bg-indigo-600 text-white px-5 py-3 rounded-2xl shadow-md">${prompt}</div></div>`;
        input.value = '';
        btn.disabled = true;
        
        try {
            const res = await fetch('/api/chat', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({ prompt })
            });
            const data = await res.json();
            
            chat.innerHTML += `<div class="flex justify-start"><div class="bg-slate-100 dark:bg-slate-700 px-5 py-3 rounded-2xl">${data.reply}</div></div>`;
            
            // Save to LocalStorage
            localStorage.setItem('studyAI_chat', chat.innerHTML);
            
            chat.scrollTop = chat.scrollHeight;
        } catch (err) {
            alert("Error sending message.");
        } finally {
            btn.disabled = false;
            input.focus();
        }
    }

    document.getElementById('user-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSend(); });
</script>
