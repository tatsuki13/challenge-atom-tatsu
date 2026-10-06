import { NextResponse, type NextRequest } from "next/server";
import {
  endConversationSession,
  getConversationSession,
} from "@/lib/conversationStore";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function isValidConversationId(value: unknown): value is string {
  return typeof value === "string" && CONVERSATION_ID_PATTERN.test(value);
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (!isValidConversationId(conversationId)) {
    return NextResponse.json(
      { error: "conversation_id_invalid" },
      { status: 400 },
    );
  }

  const session = await getConversationSession(conversationId, user.profileId);
  if (!session) {
    return NextResponse.json(
      { error: "conversation_not_available" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    conversationId: session.conversationId,
    messages: session.messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.content,
      emotionLabel: message.emotionLabel,
      emotionScores: message.emotionScores ?? null,
      riskLevel: message.riskLevel,
    })),
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const conversationId =
    typeof body === "object" && body !== null && "conversationId" in body
      ? body.conversationId
      : null;
  if (!isValidConversationId(conversationId)) {
    return NextResponse.json(
      { error: "conversation_id_invalid" },
      { status: 400 },
    );
  }

  const ended = await endConversationSession(conversationId, user.profileId);
  if (!ended) {
    return NextResponse.json(
      { error: "conversation_not_available" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ended: true });
}
