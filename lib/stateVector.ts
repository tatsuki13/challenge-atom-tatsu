import type { EmotionScores } from "./wellbeing";
import type { StateScores, EmotionState } from "./emotionState";

export const stateDimensions = [
  { key: "loneliness", label: "孤独感", color: "#5553a6" },
  { key: "anxiety", label: "不安", color: "#a45c12" },
  { key: "positive_affect", label: "楽しさ", color: "#ae3d66" },
  { key: "interest", label: "関心", color: "#237668" },
] as const;

export type StateVectorPoint = {
  id: string;
  conversationId: string;
  conversationTitle: string;
  createdAt: string;
  content: string;
  scores: StateScores | null;
  emotionState?: EmotionState | null;
};

// Missing or malformed historical scores must not appear as a neutral vector.
export function parseStateVector(value: unknown): EmotionScores | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const result = {} as EmotionScores;
  for (const { key } of stateDimensions) {
    const score = record[key];
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) return null;
    result[key] = score;
  }
  return result;
}

export function stateVectorDelta(current: StateScores | null, previous: StateScores | null): StateScores | null {
  if (!current || !previous) return null;
  return Object.fromEntries(stateDimensions.map(({ key }) => [key, current[key] === null || previous[key] === null ? null : current[key] - previous[key]])) as StateScores;
}
