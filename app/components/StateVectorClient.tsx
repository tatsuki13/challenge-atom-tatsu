"use client";

import { useEffect, useMemo, useState } from "react";
import { stateDimensions, stateVectorDelta, type StateVectorPoint } from "@/lib/stateVector";
import { resolveEmotionState, stateStatusLabel, type StateScores } from "@/lib/emotionState";

const sampleInputs: Array<{ content: string; estimate: StateScores }> = [
  { content: "今日は寂しさを強く感じます。不安はありません。", estimate: { loneliness: 0.75, anxiety: 0, positive_affect: null, interest: null } },
  { content: "はい。", estimate: { loneliness: null, anxiety: null, positive_affect: null, interest: null } },
  { content: "寂しさは同じくらいです。明日のことは少し心配です。", estimate: { loneliness: 0.75, anxiety: 0.3, positive_affect: null, interest: null } },
  { content: "散歩の話は面白くて、もっと聞きたいです。", estimate: { loneliness: null, anxiety: null, positive_affect: 0.55, interest: 0.8 } },
  { content: "一緒に話せて安心しました。もう寂しくありません。", estimate: { loneliness: 0, anxiety: 0.1, positive_affect: 0.7, interest: null } },
  { content: "なるほど。", estimate: { loneliness: null, anxiety: null, positive_affect: null, interest: null } },
];
const samplePoints: StateVectorPoint[] = [];
for (const [index, { content, estimate }] of sampleInputs.entries()) {
  const previous = samplePoints[index - 1];
  const emotionState = resolveEmotionState(estimate, previous?.emotionState, previous?.id ?? null, "openai", "sample");
  samplePoints.push({ id: `sample-${index}`, conversationId: "sample", conversationTitle: "サンプルの会話",
    createdAt: new Date(Date.UTC(2026, 9, 5, 0, index * 5)).toISOString(), content, scores: emotionState, emotionState });
}
const scoreText = (value: number | null | undefined) => value == null ? "未推定" : value.toFixed(2);
const dateFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const formatDate = (value: string) => dateFormat.format(new Date(value));
const buttonClass = "rounded-lg border border-[#b5c5ce] bg-white px-4 py-2 text-sm font-bold hover:bg-[#edf4f2] disabled:opacity-40";

export default function StateVectorClient({ demoOnly, currentConversationId, refreshKey }: { demoOnly: boolean; currentConversationId?: string; refreshKey?: string }) {
  const embedded = Boolean(currentConversationId);
  const [mode, setMode] = useState(demoOnly ? "sample" : "history");
  const [period, setPeriod] = useState("7");
  const [conversation, setConversation] = useState("all");
  const [history, setHistory] = useState<StateVectorPoint[]>([]);
  const [loading, setLoading] = useState(!demoOnly);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "history" || demoOnly) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams({ period: embedded ? "all" : period });
        if (currentConversationId) query.set("conversationId", currentConversationId);
        const response = await fetch(`/api/state-vector?${query}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "履歴を取得できませんでした。");
        setHistory(data.points);
        setTruncated(data.truncated);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "履歴を取得できませんでした。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [mode, period, revision, demoOnly, embedded, currentConversationId, refreshKey]);

  const source = mode === "sample" ? samplePoints : history;
  const conversations = useMemo(() => Array.from(new Map(source.map((point) => [point.conversationId, point.conversationTitle])).entries()), [source]);
  const points = useMemo(() => source.filter((point) => conversation === "all" || point.conversationId === conversation), [source, conversation]);
  const selectedIndex = selectedId ? points.findIndex((point) => point.id === selectedId) : -1;
  const index = selectedIndex >= 0 ? selectedIndex : Math.max(0, points.length - 1);
  const selected = points[index];
  const previous = index > 0 ? points[index - 1] : null;
  const delta = stateVectorDelta(selected?.scores ?? null, previous?.scores ?? null);
  const missing = points.filter((point) => !point.scores).length;
  const start = points.length ? Date.parse(points[0].createdAt) : 0;
  const end = points.length ? Date.parse(points[points.length - 1].createdAt) : 0;
  const x = (point: StateVectorPoint) => end === start ? 326 : 46 + (Date.parse(point.createdAt) - start) / (end - start) * 560;

  function changeMode(value: string) {
    setMode(value);
    setConversation("all");
    setSelectedId(null);
  }

  return (
    <div className={`${embedded ? "mt-4" : "mt-8"} space-y-6`}>
      {!embedded && <section aria-label="表示設定" className="flex flex-wrap items-end gap-4 rounded-xl border border-[#d7e0ea] bg-white p-5">
        <label className="grid gap-2 text-sm font-bold">表示データ
          <select value={mode} onChange={(event) => changeMode(event.target.value)} className="rounded-lg border border-[#b5c5ce] p-2">
            {!demoOnly && <option value="history">自分の会話履歴</option>}
            <option value="sample">サンプルを試す</option>
          </select>
        </label>
        {mode === "history" && <label className="grid gap-2 text-sm font-bold">期間
          <select value={period} onChange={(event) => { setPeriod(event.target.value); setConversation("all"); setSelectedId(null); }} className="rounded-lg border border-[#b5c5ce] p-2">
            <option value="7">直近7日</option><option value="30">直近30日</option><option value="all">全期間</option>
          </select>
        </label>}
        <label className="grid min-w-0 gap-2 text-sm font-bold">会話
          <select value={conversation} onChange={(event) => { setConversation(event.target.value); setSelectedId(null); }} className="max-w-64 rounded-lg border border-[#b5c5ce] p-2">
            <option value="all">すべての会話</option>
            {conversations.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
          </select>
        </label>
        {mode === "history" && <button type="button" disabled={loading} onClick={() => setRevision((value) => value + 1)} className={buttonClass}>最新の履歴を取得</button>}
      </section>}
      {embedded && <button type="button" disabled={loading} onClick={() => setRevision((value) => value + 1)} className={buttonClass}>最新の履歴を取得</button>}
      {mode === "sample" && <p className="rounded-lg bg-[#e8f6f1] p-4 text-sm font-bold text-[#237668]">サンプル表示です。架空の6つの発話と説明用の強度です。丸・三角・未推定の違いを確認できます。実際の履歴には保存されません。</p>}
      {mode === "history" && loading ? <p role="status" className="py-12 text-center">会話履歴を読み込んでいます…</p>
        : mode === "history" && error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-800">{error} 「最新の履歴を取得」で再試行できます。</p>
        : !points.length ? <section className="rounded-xl border border-dashed border-[#b5c5ce] bg-white p-5 text-center"><h2 className="text-xl font-bold">{embedded ? "この会話の発話はまだありません" : "この期間の発話はありません"}</h2><p className="mt-3 text-[#596a79]">{embedded ? "発話が保存されるとグラフが表示されます。" : "会話をした後に履歴を更新するか、期間を広げてください。"}</p>{!embedded && <button type="button" onClick={() => changeMode("sample")} className={`${buttonClass} mt-5`}>サンプルで変化を見る</button>}</section>
        : <>
          <section aria-labelledby="vector-trend-heading">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2"><h2 id="vector-trend-heading" className="text-xl font-bold">4成分の時系列</h2><p className="text-sm text-[#596a79]">{points.length}発話 ・ 横軸は日時（日本時間）</p></div>
            {mode === "history" && truncated && <p className="mb-3 text-sm text-[#596a79]">選んだ期間の最新500発話を表示しています。会話の絞り込みも、この500件の中が対象です。</p>}
            {missing > 0 && <p className="mb-3 text-sm text-[#596a79]">{missing}発話はスコア未記録です。0として補わず、線を途切れさせています。</p>}
            <div className="grid gap-4 md:grid-cols-2">
              {stateDimensions.map(({ key, label, color }) => {
                let drawing = false;
                const path = points.map((point, i) => {
                  const value = point.scores?.[key];
                  if (value == null) { drawing = false; return ""; }
                  // Separate conversations are separate trajectories.
                  if (i > 0 && points[i - 1].conversationId !== point.conversationId) drawing = false;
                  const segment = `${drawing ? "L" : "M"}${x(point)},${150 - value * 120}`;
                  drawing = true;
                  return segment;
                }).join(" ");
                return <div key={key} className="rounded-xl border border-[#d7e0ea] bg-white p-4">
                  <div className="flex items-center justify-between"><h3 className="font-bold" style={{ color }}>{label}</h3><span className="font-mono text-sm">{scoreText(selected.scores?.[key])} / 1.00</span></div>
                  <svg viewBox="0 0 640 164" role="img" aria-label={`${label}の推移。選択した発話の値は${scoreText(selected.scores?.[key])}。詳細は下の発話一覧で確認できます。`} className="mt-3 w-full">
                    {[0, 0.5, 1].map((tick) => <g key={tick}><line x1="46" x2="606" y1={150 - tick * 120} y2={150 - tick * 120} stroke="#e7edf2" /><text x="35" y={157 - tick * 120} textAnchor="end" fill="#596a79" fontSize="24">{tick.toFixed(1)}</text></g>)}
                    <line x1={x(selected)} x2={x(selected)} y1="25" y2="153" stroke="#8b9eac" strokeDasharray="4 4" />
                    <path d={path} fill="none" stroke={color} strokeWidth="3" />
                    {points.map((point) => {
                      const value = point.scores?.[key];
                      if (value == null) return null;
                      const cx = x(point), cy = 150 - value * 120;
                      const held = point.emotionState?._analysis.axes[key].status === "held";
                      const radius = point.id === selected.id ? 7 : 5;
                      const title = `${formatDate(point.createdAt)} ${label} ${value.toFixed(2)} ${stateStatusLabel(point.emotionState, key)}`;
                      return <g key={point.id} onClick={() => setSelectedId(point.id)} className="cursor-pointer">
                        {held ? <polygon points={`${cx},${cy - radius} ${cx - radius},${cy + radius} ${cx + radius},${cy + radius}`} fill={color} stroke="white" strokeWidth="1.5"><title>{title}</title></polygon>
                          : <circle cx={cx} cy={cy} r={radius} fill={color} stroke="white" strokeWidth="1.5"><title>{title}</title></circle>}
                      </g>;
                    })}
                  </svg>
                  <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-[#596a79]"><span>{formatDate(points[0].createdAt)}</span>{points.length > 1 && <span>{formatDate(points[points.length - 1].createdAt)}</span>}</div>
                </div>;
              })}
            </div>
            <p className="mt-3 text-sm text-[#596a79]">● 丸：推定済み（変化なしも含む）　▲ 三角：前回値を維持。未推定の軸には点を置きません。従来のキーワード推定も丸で表示し、詳細で区別します。線は同じ会話内の記録を結んでいます。発話の間の感情を推定したものではありません。</p>
            {points.length === 1 && <p className="mt-2 text-sm text-[#596a79]">現在は1発話のため、点で表示しています。2発話目から変化が線でつながります。</p>}
          </section>
          <section aria-labelledby="vector-point-heading" className="rounded-xl border border-[#d7e0ea] bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="vector-point-heading" className="text-xl font-bold">選択した発話 <span className="text-base font-normal text-[#596a79]">{index + 1} / {points.length}</span></h2><div className="flex gap-2"><button type="button" disabled={index === 0} onClick={() => setSelectedId(points[index - 1].id)} className={buttonClass}>前へ</button><button type="button" disabled={index === points.length - 1} onClick={() => setSelectedId(points[index + 1].id)} className={buttonClass}>次へ</button></div></div>
            <label className="mt-5 block text-sm font-bold" htmlFor="vector-position">時間をたどる</label>
            <input id="vector-position" type="range" min="0" max={points.length - 1} value={index} onChange={(event) => setSelectedId(points[Number(event.target.value)].id)} aria-valuetext={`${index + 1}番目の発話、${formatDate(selected.createdAt)}`} className="mt-3 w-full accent-[#237668]" disabled={points.length === 1} />
            <div aria-live="polite" aria-atomic="true">
              <p className="mt-4 text-sm text-[#596a79]">{formatDate(selected.createdAt)} ・ {selected.conversationTitle}</p>
              <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-[#f6f8fb] p-4 leading-7">{selected.content}</p>
              <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">{stateDimensions.map(({ key, label, color }) => <div key={key} className="border-l-4 pl-4" style={{ borderColor: color }}><p className="text-sm font-bold">{label}</p><p className="mt-2 text-2xl font-bold tabular-nums">{scoreText(selected.scores?.[key])}</p><p className="mt-1 text-xs text-[#596a79]">{selected.scores ? stateStatusLabel(selected.emotionState, key) : "未記録"}</p><p className="mt-1 text-sm tabular-nums text-[#596a79]">前回比 {delta?.[key] != null ? `${delta[key] > 0 ? "+" : ""}${delta[key].toFixed(2)}` : "—"}</p></div>)}</div>
              <p className="mt-4 text-sm text-[#596a79]">前回比は表示中の直前の発話との差です。{previous && previous.conversationId !== selected.conversationId && "今回は別の会話の発話と比較しています。"}{!delta && "最初の発話、または比較対象のスコア未記録時は差分を表示しません。"}</p>
            </div>
          </section>
          <details className="rounded-xl border border-[#d7e0ea] bg-white p-5"><summary className="cursor-pointer font-bold">発話ごとの数値を一覧で見る</summary><div className="mt-4 max-h-96 overflow-auto"><table className="w-full min-w-[620px] text-left text-sm"><caption className="sr-only">発話日時と感情4成分のスコア</caption><thead><tr className="border-b border-[#d7e0ea]"><th className="p-3">発話</th><th className="p-3">日時</th>{stateDimensions.map(({ key, label }) => <th key={key} className="p-3 text-right">{label}</th>)}</tr></thead><tbody>{points.map((point, i) => <tr key={point.id} className={`border-b border-[#edf2f6] ${point.id === selected.id ? "bg-[#e8f6f1]" : ""}`}><td className="p-3"><button type="button" className="font-bold text-[#237668] underline" aria-pressed={point.id === selected.id} onClick={() => setSelectedId(point.id)}>発話 {i + 1}</button></td><td className="p-3">{formatDate(point.createdAt)}</td>{stateDimensions.map(({ key }) => <td key={key} className="p-3 text-right tabular-nums">{scoreText(point.scores?.[key])}<span className="mt-1 block text-xs">{point.scores ? stateStatusLabel(point.emotionState, key) : "未記録"}</span></td>)}</tr>)}</tbody></table></div></details>
        </>}
    </div>
  );
}
