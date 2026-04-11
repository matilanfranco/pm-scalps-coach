// lib/journalLogic.ts
// Lógica de derivación automática de categoría de trade

import type {
  AmDir,
  AmReac,
  HtfStruct,
  M15Struct,
  CisdDir,
  LevelLabel,
  ContextTag,
  TradeSide,
} from "@/lib/types";

// ─── Helpers generales ────────────────────────────

export function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isValidHHMM(s: string): boolean {
  return /^\d{2}:\d{2}$/.test(s);
}

export function buildTimestamp(dateStr: string, timeStr: string): number {
  if (!dateStr) return Date.now();
  const base = new Date(dateStr + "T12:00:00");
  if (timeStr && isValidHHMM(timeStr)) {
    const [hh, mm] = timeStr.split(":").map(Number);
    base.setHours(hh, mm, 0, 0);
  }
  return base.getTime();
}

// ─── Tipos de contexto ────────────────────────────
export type ContextInput = {
  // Sección 1 — Contexto apertura
  amDir: AmDir;
  amSweepNivel: LevelLabel;
  amReac: AmReac;
  htfStruct: HtfStruct;

  // Sección 2 — Estado actual
  pmSweepNivel: LevelLabel;
  pmReac: AmReac;
  m15Struct: M15Struct;

  // Sección 3 — Update delivery
  cisdDir: CisdDir;
};

export type ContextResult = {
  contextTag: ContextTag;
  htfAligned: boolean | null;
  // La dirección operable derivada (útil para el pretrade)
  operableDir: "alcista" | "bajista" | null;
};

/**
 * Calcula contextTag y htfAligned a partir de las respuestas del pretrade.
 *
 * Lógica de dirección operable (por precedencia):
 *   1. CISD M15 (si existe, toma precedencia sobre todo)
 *   2. Estructura M15 actual
 *   3. Dirección AM
 *
 * Lógica de categoría:
 *   - Si hay sweep en sesión + aceptación → CONT-AM-SWEEP o REVERSAL-SWEEP
 *   - Si hay sweep en sesión + absorción + contra AM → REVERSAL-SWEEP
 *   - Si hay sweep + a favor AM → CONT-AM-SWEEP
 *   - Sin sweep + a favor AM → CONT-AM
 *   - Sin sweep + contra AM → REVERSAL-NO-SWEEP
 */
export function computeContextTag(
  input: ContextInput,
  tradeSide: TradeSide | null
): ContextResult {
  const { amDir, amSweepNivel, amReac, htfStruct, pmSweepNivel, pmReac, m15Struct, cisdDir } = input;

  // ─── 1. Dirección operable ─────────────────────
  let operableDir: "alcista" | "bajista" | null = null;

  if (amDir && amDir !== "sin-dir") operableDir = amDir;
  if (m15Struct) operableDir = m15Struct;
  if (cisdDir) operableDir = cisdDir; // CISD toma precedencia

  // ─── 2. ¿La dirección operable va contra la AM? ─
  const hasSweepSesion = !!pmSweepNivel;
  const pmAcepto = pmReac === "acepto";
  const pmAbsorbio = pmReac === "absorbio";

  const contraAM =
    operableDir !== null &&
    amDir !== null &&
    amDir !== "sin-dir" &&
    operableDir !== amDir;

  const favorAM = !contraAM && amDir !== "sin-dir";

  // ─── 3. Derivar contextTag ─────────────────────
  let contextTag: ContextTag = null;

  if (amDir === "sin-dir") {
    // Sin dirección clara en AM — no hay categoría confiable
    contextTag = null;
  } else if (favorAM) {
    contextTag = hasSweepSesion ? "CONT-AM-SWEEP" : "CONT-AM";
  } else {
    // Contra AM → reversal
    if (hasSweepSesion) {
      contextTag = "REVERSAL-SWEEP";
    } else {
      contextTag = "REVERSAL-NO-SWEEP";
    }
  }

  // ─── 4. HTF aligned ───────────────────────────
  let htfAligned: boolean | null = null;

  if (htfStruct && tradeSide) {
    htfAligned =
      (htfStruct === "alcista" && tradeSide === "BUY") ||
      (htfStruct === "bajista" && tradeSide === "SELL");
  }

  return { contextTag, htfAligned, operableDir };
}