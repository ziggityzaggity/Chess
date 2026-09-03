"use client";

import { useEffect, useRef, useState } from "react";

interface Message {
  role: "you" | "assistant";
  text: string;
  showLine?: boolean;
}

const CONVERSATIONS = [
  { title: "New conversation", meta: "Ask about any position" },
  { title: "Sicilian ideas", meta: "12 messages" },
  { title: "Review my last game", meta: "8 messages" },
];

const SEED: Message[] = [
  { role: "you", text: "Why is 8…d5 the best move here?" },
  {
    role: "assistant",
    text: "It challenges White's center before development is complete. After exd5, your knight gains tempo and the c-file opens.",
    showLine: true,
  },
];

export default function AssistantPage() {
  const [active, setActive] = useState(0);
  const [messages, setMessages] = useState<Message[]>(SEED);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send() {
    const text = draft.trim();
    if (!text) return;
    setMessages((m) => [
      ...m,
      { role: "you", text },
      {
        role: "assistant",
        text: "This assistant is a design preview and isn't connected to a model yet — this is where the explanation would appear.",
      },
    ]);
    setDraft("");
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Conversation list */}
        <aside className="hidden rounded-3xl bg-paper-200/70 p-4 lg:block">
          <p className="px-2 py-2 text-xs font-bold uppercase tracking-wider text-muted">
            Chess assistant
          </p>
          <ul className="mt-1 space-y-1">
            {CONVERSATIONS.map((c, i) => (
              <li key={c.title}>
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  className={`w-full rounded-2xl px-4 py-3 text-left transition ${
                    active === i
                      ? "bg-white shadow-sm"
                      : "hover:bg-white/60"
                  }`}
                >
                  <div className="text-sm font-semibold text-ink">{c.title}</div>
                  <div className="text-xs text-muted">{c.meta}</div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Chat */}
        <section className="flex min-h-[70vh] flex-col">
          <h1 className="text-3xl font-black tracking-tight text-ink sm:text-4xl">
            Ask about a position
          </h1>
          <p className="mt-2 text-base text-muted">
            Get explanations, not just engine lines.
          </p>

          <div className="mt-6 flex-1 space-y-4">
            {messages.map((m, i) =>
              m.role === "you" ? (
                <div
                  key={i}
                  className="rounded-3xl bg-paper-200/70 px-6 py-5"
                >
                  <p className="text-xs font-bold uppercase tracking-wider text-muted">
                    You
                  </p>
                  <p className="mt-2 text-lg font-semibold text-ink">{m.text}</p>
                </div>
              ) : (
                <div
                  key={i}
                  className="rounded-3xl border border-line bg-white px-6 py-5 shadow-sm"
                >
                  <p className="text-xs font-bold uppercase tracking-wider text-gold-600">
                    Assistant
                  </p>
                  <p className="mt-2 whitespace-pre-line leading-relaxed text-ink-700">
                    {m.text}
                  </p>
                  {m.showLine && (
                    <button
                      type="button"
                      className="mt-3 text-sm font-semibold text-gold-600 transition hover:text-gold"
                    >
                      Show the line →
                    </button>
                  )}
                </div>
              )
            )}
            <div ref={endRef} />
          </div>

          {/* Composer */}
          <div className="sticky bottom-4 mt-4">
            <div className="flex items-center gap-2 rounded-full border border-line bg-white py-2 pl-6 pr-2 shadow-card">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
                placeholder="Ask about openings, strategy, or one of your games…"
                className="flex-1 bg-transparent text-ink outline-none placeholder:text-muted-light"
              />
              <button
                type="button"
                onClick={send}
                aria-label="Send"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-paper transition hover:bg-ink-800"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 19V5M6 11l6-6 6 6" />
                </svg>
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
