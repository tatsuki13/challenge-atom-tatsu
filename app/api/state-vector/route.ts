import { getCurrentUser } from "@/lib/auth";
import { getPrismaClient } from "@/lib/prisma";
import { parseStateScores, parseEmotionState } from "@/lib/emotionState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "ログインしてください。" }, { status: 401, headers });
    const params = new URL(request.url).searchParams;
    const period = params.get("period") ?? "7";
    const conversationId = params.get("conversationId");
    if (conversationId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(conversationId)) {
      return Response.json({ error: "会話の指定が不正です。" }, { status: 400, headers });
    }
    if (!["7", "30", "all"].includes(period)) {
      return Response.json({ error: "期間が不正です。" }, { status: 400, headers });
    }
    const prisma = getPrismaClient();
    if (!prisma) return Response.json({ error: "データベースに接続できません。" }, { status: 503, headers });
    const since = period === "all" ? undefined : new Date(Date.now() - Number(period) * 24 * 60 * 60 * 1000);
    const messages = await prisma.message.findMany({
      where: { role: "user", conversation: { profileId: user.profileId }, ...(conversationId ? { conversationId } : {}), ...(since ? { createdAt: { gte: since } } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 501,
      select: { id: true, conversationId: true, createdAt: true, content: true, emotionScores: true, conversation: { select: { title: true } } },
    });
    return Response.json({
      truncated: messages.length > 500,
      points: messages.slice(0, 500).reverse().map((message) => ({
        id: message.id,
        conversationId: message.conversationId,
        conversationTitle: message.conversation.title,
        createdAt: message.createdAt.toISOString(),
        content: message.content,
        scores: parseStateScores(message.emotionScores),
        emotionState: parseEmotionState(message.emotionScores),
      })),
    }, { headers });
  } catch {
    return Response.json({ error: "履歴を取得できませんでした。時間をおいて再度お試しください。" }, { status: 503, headers });
  }
}
