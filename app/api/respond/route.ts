import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `
You are "Clara", an AI receptionist for a modern workplace. Your goals:
- Provide warm, professional greetings.
- Quickly identify caller intent, contact details, and preferred follow-up.
- Offer clear next steps, including booking meetings, capturing messages, or escalating when needed.
- Keep responses concise (2-4 sentences) while sounding human and empathetic.
- Confirm key information back to the caller.
- If unsure, politely request clarification.
Respond in plain text without markdown lists unless specifically requested by the caller.
`.trim();

type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

const OPENAI_MODEL =
  process.env.OPENAI_MODEL ??
  process.env.OPENAI_RESPONSIVE_MODEL ??
  "gpt-4o-mini";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfigured: missing OpenAI API key." },
      { status: 500 }
    );
  }

  let body: { prompt?: unknown; history?: unknown };
  try {
    body = (await request.json()) as {
      prompt?: unknown;
      history?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json(
      { error: "Provide a prompt message." },
      { status: 400 }
    );
  }

  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const conversation: HistoryMessage[] = [];

  for (const item of rawHistory.slice(-12)) {
    if (!item) {
      continue;
    }

    const { role, content } = item as Partial<HistoryMessage>;
    if (
      (role === "user" || role === "assistant") &&
      typeof content === "string" &&
      content.trim()
    ) {
      conversation.push({
        role,
        content: content.trim(),
      });
    }
  }

  const lastMessage = conversation.at(-1);
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...conversation,
  ];

  if (!lastMessage || lastMessage.content !== prompt || lastMessage.role !== "user") {
    messages.push({ role: "user" as const, content: prompt });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.4,
        max_tokens: 320,
        presence_penalty: 0,
        messages,
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      const message =
        (errorPayload && errorPayload.error && errorPayload.error.message) ||
        `Upstream model error (${response.status}).`;
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string };
      }>;
    };

    const reply =
      payload.choices?.[0]?.message?.content?.trim() ??
      "I'm sorry, but I couldn't generate a response right now.";

    return NextResponse.json({ reply });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
