"use client";

type Props = {
  text: string;
  onStart: () => void;
};

export default function WelcomeModal({ text, onStart }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="max-w-lg w-full rounded-3xl border border-white/15 bg-white/[0.04] p-7 shadow-2xl">
        <div className="text-center">
          <div className="text-[10px] font-black tracking-[0.3em] text-white/40">
            PM SCALPS COACH
          </div>
          <div className="mt-5 text-xl md:text-2xl font-black leading-snug text-white">
            {text}
          </div>
          <div className="mt-3 text-sm text-white/45">
            Respirá. Observá. Reaccioná.
          </div>
          <button
            onClick={onStart}
            className="mt-7 h-11 w-full rounded-full bg-white text-black text-sm font-black hover:bg-white/90 transition shadow-[0_8px_24px_rgba(255,255,255,0.12)]"
          >
            INICIAR →
          </button>
        </div>
      </div>
    </div>
  );
}