import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import AccountBar from "../components/AccountBar";
import StateVectorClient from "../components/StateVectorClient";

export default async function StateVectorPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const demo = (await searchParams).demo === "1";
  const user = demo ? null : await getCurrentUser();
  if (!demo && !user) redirect("/login");
  return (
    <>
      {user && <AccountBar displayName={user.displayName} />}
      <main className="mx-auto max-w-6xl px-4 py-8 text-[#1d2733] sm:px-6">
        <nav className="mb-6 flex flex-wrap gap-5 text-sm font-bold">
          <Link href="/" className="text-[#237668] underline underline-offset-4">会話へ戻る</Link>
          <Link href="/dashboard" className="text-[#237668] underline underline-offset-4">会話の記録</Link>
        </nav>
        <p className="text-sm font-bold tracking-widest text-[#237668]">会話の状態をたどる</p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">状態ベクトルの変化</h1>
        <p className="mt-4 max-w-3xl leading-7 text-[#596a79]">発話から推定した孤独感・不安・楽しさ・関心を、時間の流れに沿って表示します。発話を選ぶと、その時点の値と直前の発話との差を確認できます。</p>
        <StateVectorClient demoOnly={demo} />
        <p className="mt-8 text-sm leading-6 text-[#596a79]">スコアは言葉の一致から求めた0〜1の傾向で、診断や感情の断定ではありません。4成分の合計は1になる必要はありません。身体データは会話時点の値が保存されていないため、このグラフには含めていません。</p>
      </main>
    </>
  );
}
