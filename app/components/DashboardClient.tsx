"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { MetricsSummary } from "@/lib/conversationTypes";
import { moodOptions } from "@/lib/mood";
import type { ReactNode } from "react";

const formatter = new Intl.NumberFormat("ja-JP");

function MetricBlock({
  label,
  value,
  accent,
}: {
  label: string;
  value: ReactNode;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-[#d7e0ea] bg-white p-5 shadow-sm">
      <dt className="text-lg font-semibold text-[#405163]">{label}</dt>
      <dd className={`mt-3 text-4xl font-bold ${accent}`}>{value}</dd>
    </div>
  );
}

export default function DashboardClient({
  conversationId,
}: {
  conversationId?: string;
}) {
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const latestMood = moodOptions.find((option) => option.value === metrics?.latestMoodScore);
  const conversationQuery = conversationId
    ? `?conversationId=${encodeURIComponent(conversationId)}`
    : "";

  const loadMetrics = useCallback(async () => {
    try {
      const response = await fetch("/api/metrics", { cache: "no-store" });
      if (!response.ok) {
        setMetrics(null);
        return;
      }

      setMetrics((await response.json()) as MetricsSummary);
    } catch {
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMetrics();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadMetrics]);

  function refreshMetrics() {
    setLoading(true);
    void loadMetrics();
  }

  const storageMessage =
    metrics?.storageMode === "database"
      ? "DATABASE_URLが設定されているため、KPIはDBから集計しています。"
      : "現在はデモモードです。APIキーとDATABASE_URLを設定すると保存できます。";

  return (
    <main className="min-h-screen bg-[#f6f8fb] px-4 py-5 text-[#1d2733] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 border-b border-[#dfe6ee] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-base font-semibold text-[#3b7f6a]">
              Challenge ATOM
            </p>
            <h1 className="text-3xl font-bold tracking-normal sm:text-4xl">
              今日の記録
            </h1>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={refreshMetrics}
              className="min-h-12 rounded-lg border border-[#b8c6d6] bg-white px-5 text-lg font-semibold transition hover:bg-[#edf4f1]"
            >
              更新
            </button>
            <Link
              href={`/memory${conversationQuery}`}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#8eb5a6] bg-[#edf7f2] px-5 text-lg font-semibold text-[#285747] transition hover:bg-[#dcefe7]"
            >
              記憶を確認する
            </Link>
            <Link
              href={`/${conversationQuery}`}
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#265d8f] px-5 text-lg font-semibold text-white transition hover:bg-[#214f79]"
            >
              会話に戻る
            </Link>
          </div>
        </header>

        <section className="py-5">
          <div className="rounded-lg border border-[#d7e0ea] bg-white p-5 text-lg leading-8 shadow-sm">
            <p>{storageMessage}</p>
            <p className="mt-2">
              本人同意がない限り家族共有しません。ここでは会話本文を全文表示せず、KPIだけを確認します。
            </p>
          </div>
        </section>

        {loading ? (
          <p className="rounded-lg border border-[#d7e0ea] bg-white p-5 text-xl shadow-sm">
            読み込み中です
          </p>
        ) : null}

        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricBlock
            label="今日の会話回数"
            value={formatter.format(metrics?.conversationCount ?? 0)}
            accent="text-[#265d8f]"
          />
          <MetricBlock
            label="今日のユーザー発話数"
            value={formatter.format(metrics?.userMessageCount ?? 0)}
            accent="text-[#3b7f6a]"
          />
          <MetricBlock
            label="今日の推定会話時間"
            value={`${formatter.format(metrics?.estimatedMinutes ?? 0)}分`}
            accent="text-[#9a4f2f]"
          />
          <MetricBlock
            label="今日の発話文字数"
            value={formatter.format(metrics?.userCharCount ?? 0)}
            accent="text-[#265d8f]"
          />
          <MetricBlock
            label="直近の気分"
            value={latestMood ? <span className="inline-flex items-center gap-3"><span aria-hidden="true">{latestMood.emoji}</span><span className="text-xl">{latestMood.label}</span></span> : "未選択"}
            accent="text-[#3b7f6a]"
          />
          <MetricBlock
            label="watch / urgent"
            value={`${formatter.format(metrics?.riskWatchCount ?? 0)} / ${formatter.format(metrics?.riskUrgentCount ?? 0)}`}
            accent="text-[#a04747]"
          />
        </dl>
      </div>
    </main>
  );
}
