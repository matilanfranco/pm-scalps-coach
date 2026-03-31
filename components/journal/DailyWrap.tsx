"use client";

type DailyWrap = {
  date: string;
  dailyError: string;
  dailyLearning: string;
  updatedAt: number;
};

type Props = {
  todayKey: string;
  dailyError: string;
  dailyLearning: string;
  dailySaved: DailyWrap | null;
  onChangeError: (v: string) => void;
  onChangeLearning: (v: string) => void;
  onSave: () => void;
};

export default function DailyWrap({
  todayKey,
  dailyError,
  dailyLearning,
  dailySaved,
  onChangeError,
  onChangeLearning,
  onSave,
}: Props) {
  const canSave = dailyError.trim().length > 0 && dailyLearning.trim().length > 0;

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_50px_rgba(0,0,0,0.35)]">
      <div className="text-base font-black text-white">Cierre de jornada</div>
      <div className="mt-1 text-xs text-white/40">
        {todayKey} · Completá esto una vez por día
      </div>

      <div className="mt-4 grid gap-3">
        {/* Error del día */}
        <div className="rounded-xl border border-red-400/15 bg-red-500/[0.07] p-4">
          <div className="text-xs font-black text-red-300/80 mb-2">ERROR DEL DÍA</div>
          <textarea
            value={dailyError}
            onChange={(e) => onChangeError(e.target.value)}
            placeholder='Ej: "Entré sin confirmación en M5. Me apuré."'
            rows={3}
            className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/85 outline-none placeholder:text-white/25 focus:border-white/15 transition"
          />
        </div>

        {/* Aprendizaje */}
        <div className="rounded-xl border border-sky-400/15 bg-sky-500/[0.07] p-4">
          <div className="text-xs font-black text-sky-300/80 mb-2">
            APRENDIZAJE / APRECIACIÓN
          </div>
          <textarea
            value={dailyLearning}
            onChange={(e) => onChangeLearning(e.target.value)}
            placeholder='Ej: "Fui paciente, esperé el momento justo según mi estrategia."'
            rows={3}
            className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/85 outline-none placeholder:text-white/25 focus:border-white/15 transition"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={onSave}
          className={[
            "h-10 rounded-xl border border-white/20 bg-white/10 px-5 text-sm font-black text-white hover:bg-white/15 transition",
            !canSave ? "opacity-40 pointer-events-none" : "",
          ].join(" ")}
        >
          Guardar cierre del día
        </button>

        {dailySaved && (
          <div className="text-xs text-white/40">
            Guardado:{" "}
            <span className="text-white/60">
              {new Date(dailySaved.updatedAt).toLocaleTimeString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}