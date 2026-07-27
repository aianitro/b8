'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, ArrowRight } from 'lucide-react';

type Role = 'user' | 'assistant';
interface ChatMessage { role: Role; content: string; }

const SUGGESTIONS = [
  'How am I tracking against my annual budget?',
  'Where am I most likely to overspend by year end?',
  'What are my top merchants this year?',
  'How does this month compare to last month?',
  'Break down my spending by category for the last 3 months.',
];

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-slate-900 text-white flex items-center justify-center mr-2.5 mt-0.5 shrink-0">
          <Sparkles size={13} />
        </div>
      )}
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap
          ${isUser
            ? 'bg-slate-900 text-white rounded-tr-sm'
            : 'bg-white border border-slate-100 shadow-sm text-slate-800 rounded-tl-sm'}`}
      >
        {msg.content}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start mb-4">
      <div className="w-7 h-7 rounded-full bg-slate-900 flex items-center justify-center mr-2.5 shrink-0">
        <Sparkles size={13} className="text-white" />
      </div>
      <div className="bg-white border border-slate-100 shadow-sm rounded-2xl rounded-tl-sm px-4 py-3">
        <div className="flex gap-1 items-center h-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function InsightsChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);
    setError(null);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })) }),
    });

    const data = await res.json();
    setLoading(false);

    if (data.success) {
      setMessages([...next, { role: 'assistant', content: data.data.reply }]);
    } else {
      setError(data.error?.message ?? 'Something went wrong');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-8 py-8">
        {empty ? (
          <div className="flex flex-col items-center justify-center h-full text-center max-w-lg mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center mb-5 shadow-lg">
              <Sparkles size={24} />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">B8 Finance Assistant</h2>
            <p className="text-sm text-slate-500 mb-8 leading-relaxed">
              Ask anything about your spending, budgets, or financial trends. I have access to your real transaction data.
            </p>
            <div className="w-full space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="w-full text-left text-sm px-4 py-3 bg-white border border-slate-100 shadow-sm rounded-xl text-slate-600 hover:bg-slate-50 hover:border-slate-200 transition-all flex items-center justify-between group"
                >
                  <span>{s}</span>
                  <ArrowRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors shrink-0 ml-2" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
            {loading && <TypingIndicator />}
            {error && <div className="text-xs text-red-500 text-center mt-2 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-100 bg-white px-8 py-5">
        <div className="flex gap-3 items-end max-w-3xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your finances… (Enter to send)"
            rows={1}
            disabled={loading}
            className="flex-1 resize-none border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-50 max-h-32 overflow-y-auto bg-slate-50"
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="p-3 bg-slate-900 text-white rounded-xl hover:bg-slate-700 disabled:opacity-40 shrink-0 transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
        {!empty && (
          <p className="text-xs text-slate-300 text-center mt-2">Shift+Enter for new line · resets on refresh</p>
        )}
      </div>
    </div>
  );
}
