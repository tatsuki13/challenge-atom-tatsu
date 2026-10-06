export const emotionKeys = ["loneliness", "anxiety", "positive_affect", "interest"] as const;
export type EmotionKey = typeof emotionKeys[number];
export type StateScores = Record<EmotionKey, number | null>;
export type AxisStatus = "estimated" | "held" | "unestimated";
export type EmotionState = StateScores & {
  _analysis: {
    version: "context-v1";
    source: "openai" | "unavailable" | "error" | "skipped";
    model: string | null;
    axes: Record<EmotionKey, { status: AxisStatus; reason: "estimated" | "insufficient_evidence" | "api_unavailable" | "api_error" | "safety_skipped"; previousMessageId: string | null }>;
  };
};

export function parseStateScores(value: unknown): StateScores | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const result = {} as StateScores;
  for (const key of emotionKeys) {
    const score = record[key];
    if (score !== null && (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1)) return null;
    result[key] = score as number | null;
  }
  return result;
}

export function parseEmotionState(value: unknown): EmotionState | null {
  const scores = parseStateScores(value);
  if (!scores) return null;
  const metadata = (value as EmotionState)._analysis;
  if (!metadata || metadata.version !== "context-v1" || !["openai", "unavailable", "error", "skipped"].includes(metadata.source) || (metadata.model !== null && typeof metadata.model !== "string")) return null;
  for (const key of emotionKeys) {
    const axis = metadata.axes?.[key];
    if (!axis || !["estimated", "held", "unestimated"].includes(axis.status) || !["estimated", "insufficient_evidence", "api_unavailable", "api_error", "safety_skipped"].includes(axis.reason)) return null;
    if (axis.previousMessageId !== null && typeof axis.previousMessageId !== "string") return null;
    if ((axis.status === "unestimated") !== (scores[key] === null)) return null;
    if ((axis.status === "estimated") !== (axis.reason === "estimated")) return null;
  }
  return { ...scores, _analysis: metadata };
}

// Only contextual estimates seed future values; legacy keyword scores remain historical data.
export function resolveEmotionState(estimate: StateScores | null, previous: unknown, previousMessageId: string | null, source: EmotionState["_analysis"]["source"], model: string | null): EmotionState {
  const prior = parseEmotionState(previous);
  const scores = {} as StateScores;
  const axes = {} as EmotionState["_analysis"]["axes"];
  for (const key of emotionKeys) {
    const value = estimate?.[key] ?? null;
    scores[key] = value ?? prior?.[key] ?? null;
    axes[key] = {
      status: value !== null ? "estimated" : scores[key] !== null ? "held" : "unestimated",
      reason: value !== null ? "estimated" : source === "skipped" ? "safety_skipped" : source === "error" ? "api_error" : source === "unavailable" ? "api_unavailable" : "insufficient_evidence",
      previousMessageId: value === null && scores[key] !== null ? previousMessageId : null,
    };
  }
  return { ...scores, _analysis: { version: "context-v1", source, model, axes } };
}

export function stateStatusLabel(state: EmotionState | null | undefined, key: EmotionKey): string {
  if (!state) return "従来のキーワード推定";
  const axis = state._analysis.axes[key];
  if (axis.status === "estimated") return "● 推定済み";
  const reason = axis.reason === "safety_skipped" ? "安全応答を優先" : axis.reason === "api_error" ? "APIエラー" : axis.reason === "api_unavailable" ? "API未設定・推定未実行" : "判断材料不足";
  return axis.status === "held" ? `▲ ${reason}のため前回値を維持` : `未推定（${reason}）`;
}

