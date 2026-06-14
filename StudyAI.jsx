import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Bot, User } from 'lucide-react';

export default function StudyAI() {
  const [messages, setMessages] = useState([
    { id: 1, text: "Hello! I am StudyAI by Vision. How can I help you learn today?", isUser: false }
  ]);
  const [input, setInput] = useState("");

  const handleSend = () => {
    if (!input.trim()) return;
    
    // Add User Message
    const userMsg = { id: Date.now(), text: input, isUser: true };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    // Simulate AI Response (Connect your Cerebras API call here)
    setTimeout(() => {
      const aiMsg = { id: Date.now() + 1, text: "Processing your request...", isUser: false };
      setMessages((prev) => [...prev, aiMsg]);
    }, 500);
  };

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto p-4 bg-gray-50">
      <h1 className="text-2xl font-bold text-center mb-6 text-indigo-700">StudyAI by Vision</h1>
      
      <div className="flex-1 overflow-y-auto space-y-4 pr-2">
        <AnimatePresence>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`p-4 rounded-2xl max-w-[80%] ${msg.isUser ? 'bg-indigo-600 text-white' : 'bg-white shadow-sm'}`}>
                {msg.text}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="mt-4 flex gap-2">
        <input
          className="flex-1 p-3 border rounded-full outline-none focus:ring-2 focus:ring-indigo-500"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask StudyAI anything..."
        />
        <button onClick={handleSend} className="p-3 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 transition">
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}
