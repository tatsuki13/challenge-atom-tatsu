import { scoreEmotions } from "@/lib/wellbeing";
import { getCurrentUser } from "@/lib/auth";
import { getPrismaClient } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "authentication_required" }, { status: 401 });
  const prisma = getPrismaClient();
  if (!prisma) return Response.json({ topics: [] }, { headers: { "Cache-Control": "no-store" } });
  try {
    const decisions = await prisma.conversationDecision.findMany({
      where: { conversation: { profileId: user.profileId }, mainFocus: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        mainFocus: true,
        sourceUtterances: {
          select: { sourceMessage: { select: { role: true, content: true, emotionScores: true, createdAt: true } } },
        },
      },
    });
    const topics: string[] = [];
    for (const decision of decisions) {
      const latest = decision.sourceUtterances
        .map((source) => source.sourceMessage)
        .filter((message) => message.role === "user")
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const scores = latest?.emotionScores;
      const interest = latest && scores && typeof scores === "object" && !Array.isArray(scores) && "_analysis" in scores
        ? scoreEmotions(latest.content).interest
        : scores && typeof scores === "object" && !Array.isArray(scores)
        ? scores.interest : null;
      const focus = decision.mainFocus?.trim();
      if (typeof interest === "number" && interest >= 0.45 && focus && !topics.includes(focus)) {
        topics.push(focus);
      }
      if (topics.length >= 5) break;
    }
    return Response.json({ topics }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ topics: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
