import { stateStatusLabel, type StateScores, type EmotionState } from "@/lib/emotionState";

const dimensions: Array<{
  key: keyof StateScores;
  label: string;
  color: string;
  surface: string;
  emoji: string;
}> = [
  { key: "loneliness", label: "孤独感", color: "#5553a6", surface: "#efeffb", emoji: "😢" },
  { key: "anxiety", label: "不安", color: "#a45c12", surface: "#fff1dc", emoji: "😟" },
  { key: "positive_affect", label: "楽しさ", color: "#ae3d66", surface: "#fff0f5", emoji: "😊" },
  { key: "interest", label: "関心", color: "#237668", surface: "#e8f6f1", emoji: "🤩" },
];

export function getEmotionTone(scores: StateScores) {
  const dominant = dimensions.reduce<(typeof dimensions)[number] | null>((best, item) => {
    return (scores[item.key] ?? 0) > (best ? scores[best.key] ?? 0 : 0) ? item : best;
  }, null);
  return dominant && (scores[dominant.key] ?? 0) >= 0.45
    ? dominant
    : { key: null, label: dimensions.every(({ key }) => scores[key] === null) ? "未推定" : "目立つ感情表現なし", color: "#405163", surface: "#edf2f6", emoji: "😐" };
}

export default function EmotionVisualization({ scores, state }: { scores: StateScores; state?: EmotionState | null }) {
  const tone = getEmotionTone(scores);

  return (
    <section className="rounded-lg border border-[#d7e0ea] bg-white p-5 shadow-sm" aria-labelledby="emotion-heading">
      <h2 id="emotion-heading" className="text-2xl font-bold">今の会話の気分</h2>
      <p className="mt-2 text-sm leading-6 text-[#596a79]">
        会話の文脈から推定した4つの強度です。判断材料がない軸は前回値を維持します。診断や気持ちの断定ではありません。
      </p>
      <div
        className="mt-4 rounded-lg border px-4 py-3"
        style={{ backgroundColor: tone.surface, borderColor: tone.color }}
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="text-sm font-semibold">いま目立つ傾向</span>
        <p className="mt-2 whitespace-nowrap text-base font-bold sm:text-lg" style={{ color: tone.color }}>{tone.label}</p>
      </div>
      <div className="mt-5 space-y-4">
        {dimensions.map((item) => {
          const value = Math.max(0, Math.min(1, scores[item.key] ?? 0));
          const intensity = scores[item.key] === null ? "未推定" : value >= 0.85 ? "強め" : value >= 0.65 ? "やや強め" : value >= 0.45 ? "表現あり" : value > 0 ? "弱め" : "目立つ表現なし";
          return (
            <div key={item.key}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-base">
                <span className="whitespace-nowrap font-semibold">{item.label}</span>
                <span className="shrink-0 whitespace-nowrap text-sm text-[#405163]">{scores[item.key]?.toFixed(2) ?? "—"} ・ {intensity}</span>
              </div>
              <p className="mb-2 text-xs text-[#596a79]">{scores[item.key] === null && !state ? "未推定" : stateStatusLabel(state, item.key)}</p>
              {scores[item.key] !== null && <div
                role="meter"
                aria-label={item.label}
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={value}
                aria-valuetext={intensity}
                className="h-3 overflow-hidden rounded-full bg-[#e7edf2]"
              >
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{ width: `${value * 100}%`, backgroundColor: item.color }}
                />
              </div>}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-[#596a79]">言葉とバーの長さで4つの傾向を表しています。</p>
    </section>
  );
}
