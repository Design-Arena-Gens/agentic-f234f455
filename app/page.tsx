import VoiceAgentPanel from "@/components/voice-agent-panel";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-12 px-6 pb-16 pt-24">
      <header className="space-y-4 text-center">
        <p className="mx-auto inline-flex items-center gap-2 rounded-full bg-brand/10 px-4 py-2 text-sm font-medium text-brand">
          AI Receptionist · Voice Enabled
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-white md:text-5xl">
          Delight callers with an always-on AI receptionist
        </h1>
        <p className="mx-auto max-w-2xl text-pretty text-base text-slate-300 md:text-lg">
          Capture visitor intent, schedule meetings, and deliver consistent
          information using a voice-first assistant that listens, understands,
          and responds conversationally just like a human receptionist.
        </p>
      </header>

      <VoiceAgentPanel />
    </main>
  );
}
