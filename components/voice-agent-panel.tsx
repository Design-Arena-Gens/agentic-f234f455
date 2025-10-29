"use client";

import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

type RecognitionResult = {
  isFinal: boolean;
  0: {
    transcript: string;
  };
};

type RecognitionResultList = ArrayLike<RecognitionResult> & {
  [index: number]: RecognitionResult;
};

type RecognitionEvent = {
  resultIndex: number;
  results: RecognitionResultList;
};

type RecognitionErrorEvent = {
  error: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type Role = "user" | "assistant";

type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
};

type ApiResponse =
  | {
      reply: string;
    }
  | {
      error: string;
    };

type RecognitionStatus = "idle" | "initializing" | "listening";

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(16).slice(2);

const createMessage = (role: Role, content: string): Message => ({
  id: `${role}-${makeId()}`,
  role,
  content,
  createdAt: Date.now(),
});

const MAX_HISTORY = 12;

const VoiceAgentPanel = () => {
  const [messages, setMessages] = useState<Message[]>(() => [
    createMessage(
      "assistant",
      "Hello! I'm your AI receptionist. Tap the microphone or type to tell me how I can help."
    ),
  ]);
  const [status, setStatus] = useState<RecognitionStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [pendingInput, setPendingInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const speechAllowedRef = useRef(false);
  const messagesRef = useRef<Message[]>(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!messageListRef.current) {
      return;
    }

    const el = messageListRef.current;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isProcessing]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleClick = () => {
      speechAllowedRef.current = true;
      window.removeEventListener("pointerdown", handleClick);
    };

    window.addEventListener("pointerdown", handleClick);

    return () => window.removeEventListener("pointerdown", handleClick);
  }, []);

  const synthSpeak = useCallback((text: string) => {
    if (
      typeof window === "undefined" ||
      !speechAllowedRef.current ||
      !autoSpeak
    ) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1.05;
    utterance.lang = "en-US";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [autoSpeak]);

  const handleSend = useCallback(
    async (input: string) => {
      const content = input.trim();
      if (!content || isProcessing) {
        return;
      }

      const userMessage = createMessage("user", content);
      const history = [...messagesRef.current, userMessage].slice(-MAX_HISTORY);

      messagesRef.current = history;
      setMessages(history);
      setPendingInput("");
      setTranscript("");
      setIsProcessing(true);
      setError(null);

      try {
        const response = await fetch("/api/respond", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: content,
            history: history.map((entry) => ({
              role: entry.role,
              content: entry.content,
            })),
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | ApiResponse
            | null;
          const message =
            (payload && "error" in payload && payload.error) ||
            `Request failed (${response.status})`;
          throw new Error(message);
        }

        const data = (await response.json()) as ApiResponse;
        if (!("reply" in data) || typeof data.reply !== "string") {
          throw new Error("Invalid response from server.");
        }

        const assistantMessage = createMessage("assistant", data.reply.trim());

        const nextMessages = [...messagesRef.current, assistantMessage].slice(
          -MAX_HISTORY
        );
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        synthSpeak(assistantMessage.content);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to reach the server.";
        setError(message);
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, synthSpeak]
  );

  const ensureRecognition = useCallback((): SpeechRecognitionLike | null => {
    if (typeof window === "undefined") {
      return null;
    }

    if (recognitionRef.current) {
      return recognitionRef.current;
    }

    const SpeechRecognitionCtor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setError("Voice input is not supported in this browser.");
      return null;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onstart = () => {
      setStatus("listening");
      setTranscript("");
      setError(null);
    };

    recognition.onerror = (event: RecognitionErrorEvent) => {
      setStatus("idle");
      setError(event.error || "Voice recognition error.");
    };

    recognition.onresult = (event: RecognitionEvent) => {
      let finalText = "";
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      if (finalText) {
        setTranscript("");
        void handleSend(finalText.trim());
      } else {
        setTranscript(interimText.trim());
      }
    };

    recognition.onend = () => {
      setStatus("idle");
    };

    recognitionRef.current = recognition;
    return recognition;
  }, [handleSend]);

  const handleToggleRecording = useCallback(() => {
    const recognition = ensureRecognition();
    if (!recognition) {
      return;
    }

    if (status === "listening") {
      recognition.stop();
      setStatus("idle");
      return;
    }

    try {
      setStatus("initializing");
      recognition.start();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to start voice capture."
      );
      setStatus("idle");
    }
  }, [ensureRecognition, status]);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void handleSend(pendingInput);
    },
    [handleSend, pendingInput]
  );

  return (
    <section className="grid gap-8 md:grid-cols-[3fr,2fr]">
      <div className="flex flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/40 shadow-xl shadow-brand/10 backdrop-blur">
        <div className="flex items-center justify-between border-b border-slate-800/80 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Conversation Console
            </h2>
            <p className="text-sm text-slate-400">
              Capture caller needs and respond instantly.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAutoSpeak((value) => !value)}
            className={clsx(
              "inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1 text-sm transition",
              autoSpeak
                ? "bg-brand/20 text-brand hover:bg-brand/30"
                : "bg-transparent text-slate-400 hover:text-slate-200"
            )}
          >
            <span className="h-2 w-2 rounded-full bg-current" />
            Auto voice {autoSpeak ? "on" : "off"}
          </button>
        </div>

        <div
          ref={messageListRef}
          className="flex-1 space-y-4 overflow-y-auto px-6 py-6"
        >
          {messages.map((message) => (
            <div
              key={message.id}
              className={clsx(
                "max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow transition",
                message.role === "assistant"
                  ? "bg-slate-800/70 text-slate-100"
                  : "ml-auto bg-brand text-white shadow-brand/50"
              )}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
          ))}

          {transcript && (
            <div className="ml-auto max-w-[80%] animate-pulse rounded-2xl bg-brand/30 px-4 py-3 text-sm text-brand">
              <p className="whitespace-pre-wrap">{transcript}</p>
            </div>
          )}

          {isProcessing && (
            <div className="max-w-[80%] rounded-2xl bg-slate-800/70 px-4 py-3 text-sm text-slate-300">
              <div className="flex items-center gap-2">
                <span className="relative h-2 w-2">
                  <span className="absolute inset-0 animate-ping rounded-full bg-brand/80 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
                </span>
                Thinking...
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-800/70 p-6">
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Type a caller request
            </label>
            <textarea
              value={pendingInput}
              onChange={(event) => setPendingInput(event.target.value)}
              placeholder="e.g. I'd like to schedule a tour next Tuesday at 10am."
              rows={3}
              className="w-full resize-none rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
            />

            <div className="flex flex-wrap items-center justify-between gap-4">
              <button
                type="button"
                onClick={handleToggleRecording}
                className={clsx(
                  "inline-flex items-center gap-3 rounded-full px-5 py-3 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950",
                  status === "listening"
                    ? "bg-red-500/80 text-white hover:bg-red-500 focus:ring-red-500/60"
                    : "bg-brand text-white hover:bg-brand-dark focus:ring-brand/80"
                )}
              >
                <span
                  className={clsx(
                    "relative h-3.5 w-3.5 rounded-full",
                    status === "listening" ? "bg-red-300" : "bg-white/80"
                  )}
                >
                  {status === "listening" && (
                    <span className="absolute inset-0 animate-ping rounded-full bg-red-400/80" />
                  )}
                </span>
                {status === "listening" ? "Listening…" : "Start voice capture"}
              </button>

              <button
                type="submit"
                disabled={isProcessing || !pendingInput.trim()}
                className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-900 transition disabled:cursor-not-allowed disabled:bg-slate-700/50 disabled:text-slate-400 hover:bg-white"
              >
                {isProcessing ? "Sending…" : "Send message"}
              </button>
            </div>
          </form>

          {error && (
            <p className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          )}
        </div>
      </div>

      <aside className="flex flex-col gap-6 rounded-3xl border border-slate-800 bg-slate-900/40 p-6 shadow-lg shadow-brand/10 backdrop-blur">
        <div>
          <h3 className="text-lg font-semibold text-white">Receptionist IQ</h3>
          <p className="mt-2 text-sm text-slate-400">
            Tailor the assistant with your business context so it can triage
            callers, collect call-backs, and route leads without human hand-off.
          </p>
        </div>

        <dl className="grid gap-4 text-sm text-slate-300">
          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 px-4 py-3">
            <dt className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              Always on
            </dt>
            <dd className="mt-2 text-slate-200">
              Intake caller intent day or night with consistent brand voice and
              escalation logic.
            </dd>
          </div>
          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 px-4 py-3">
            <dt className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              Smart routing
            </dt>
            <dd className="mt-2 text-slate-200">
              Capture contact details, qualify leads, and hand off urgent calls
              to on-call staff instantly.
            </dd>
          </div>
          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 px-4 py-3">
            <dt className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              CRM ready
            </dt>
            <dd className="mt-2 text-slate-200">
              Connect to your CRM or calendar to log conversations, schedule
              visits, and trigger workflows automatically.
            </dd>
          </div>
        </dl>

        <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 px-4 py-3">
          <h4 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">
            Tips
          </h4>
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            <li>Provide office hours and call escalation instructions.</li>
            <li>
              Teach the receptionist how to greet returning callers with custom
              CRM data.
            </li>
            <li>Configure warm transfers for sales, billing, or support queues.</li>
          </ul>
        </div>
      </aside>
    </section>
  );
};

export default VoiceAgentPanel;
