import OpenAI from "openai";
import { buildAiInput } from "@/lib/ai/buildAiInput";
import {
  analyzeConversationTurn,
  getRecentAssistantReplies,
  normalizeConversationTurnPlan,
  type ConversationMode,
  type EventType,
  type QuestionPolicy,
  type ResponsePurpose,
  type TopicType,
  type ConversationTurnPlan,
} from "@/lib/ai/conversationEngine";
import { createMockReply } from "@/lib/ai/mockReply";
import {
  createMemoryExtractionResult,
  MAX_MEMORY_CANDIDATES_PER_TURN,
  MEMORY_CANDIDATE_JSON_SCHEMA,
  validateMemoryCandidates,
} from "@/lib/ai/memoryExtraction";
import {
  classifyMemoryConfirmationReply,
  createMemoryConfirmationQuestion,
  findPendingMemoryConfirmation,
  type PendingMemoryConfirmation,
} from "@/lib/ai/memoryConfirmation";
import {
  MEMORY_RETRIEVAL_CONFIG,
  createContinuityFallbackRequest,
  createMemoryRetrievalAuditInput,
  discardSelectedMemoryResults,
  normalizeMemoryRetrievalRequest,
  toMemoryPromptContext,
} from "@/lib/ai/memoryRetrieval";
import { normalizeDetectedMemoryManagementRequest } from "@/lib/ai/memoryManagementDetection";
import { validateReplyAgainstContract } from "@/lib/ai/replyValidation";
import { inferEmotionState } from "@/lib/ai/emotionInference";
import { parseEmotionState, parseStateScores, resolveEmotionState } from "@/lib/emotionState";
import { estimateEmotion } from "@/lib/emotion";
import { scoreEmotions, suggestConversation } from "@/lib/wellbeing";
import { getLatestPhysicalSignals } from "@/lib/healthSamples";
import { syncGoogleHealth } from "@/lib/googleHealth";
import { getCurrentUser } from "@/lib/auth";
import {
  getConversationSession,
  recordAssistantTurn,
  recordMemoryCandidates,
  recordUserMessage,
} from "@/lib/conversationStore";
import { retrieveConfirmedMemories } from "@/lib/memoryRetrievalService";
import { resolveMemoryCandidate } from "@/lib/memoryResolutionService";
import {
  dedupeSourceUtteranceIds,
  isListeningStrategy,
  isMessageInputType,
  type GenerationSource,
  type ExtractedMemoryCandidate,
  type MemoryExtractionResult,
  type MemoryRetrievalFailureReason,
  type MemoryRetrievalMode,
  type MemoryRetrievalRequest,
  type MemoryRetrievalSource,
  type MemoryRetrievalStatus,
  type MemorySearchEvaluation,
  type MemorySearchResult,
  type DetectedMemoryManagementRequest,
  type PlanSource,
  type RiskLevel,
  type ReplyRejectionReason,
  type StoredChatMessage,
} from "@/lib/conversationTypes";
import { detectRisk, getUrgentSafetyReply } from "@/lib/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

const conversationModes = new Set<ConversationMode>([
  "casual",
  "reminiscence",
  "loneliness",
  "anxiety",
  "daily_life",
  "continuation",
]);

const eventTypes = new Set<EventType>([
  "talked_with",
  "met",
  "went_to",
  "ate",
  "saw",
  "made",
  "heard_about",
  "is_trending",
  "remembered",
  "felt",
  "unknown",
]);

const topicTypes = new Set<TopicType>([
  "person",
  "place",
  "food",
  "activity",
  "object",
  "memory",
  "feeling",
  "unknown",
]);

const responsePurposes = new Set<ResponsePurpose>([
  "receive",
  "continue_topic",
  "clarify",
  "follow_preference",
  "pause_or_close",
]);

const questionPolicies = new Set<QuestionPolicy>(["avoid", "optional", "required"]);

type AiPlanPatch = Partial<
  Pick<
    ConversationTurnPlan,
    | "mode"
    | "focusTerms"
    | "mainFocus"
    | "eventType"
    | "relationHint"
    | "topicType"
    | "responsePurpose"
    | "questionPolicy"
    | "listeningStrategy"
  >
>;

type AiPlanAnalysis = {
  planPatch: AiPlanPatch | null;
  memoryRetrieval: MemoryRetrievalRequest | null;
  memoryManagementRequest: DetectedMemoryManagementRequest | null;
  memoryCandidates: ExtractedMemoryCandidate[];
  rejectedCount: number;
  rejectionReasonCodes: MemoryExtractionResult["rejectionReasonCodes"];
};

const aiPlanResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: [...conversationModes] },
    focusTerms: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
    },
    mainFocus: { anyOf: [{ type: "string" }, { type: "null" }] },
    eventType: { type: "string", enum: [...eventTypes] },
    relationHint: { anyOf: [{ type: "string" }, { type: "null" }] },
    topicType: { type: "string", enum: [...topicTypes] },
    responsePurpose: { type: "string", enum: [...responsePurposes] },
    questionPolicy: { type: "string", enum: [...questionPolicies] },
    listeningStrategy: {
      type: "string",
      enum: [
        "acknowledge",
        "reflect_content",
        "reflect_emotion",
        "show_interest",
        "ask_open_question",
        "ask_clarification",
        "allow_silence",
        "change_topic",
      ],
    },
    memoryCandidates: {
      type: "array",
      items: MEMORY_CANDIDATE_JSON_SCHEMA,
      maxItems: MAX_MEMORY_CANDIDATES_PER_TURN,
    },
    memoryRetrieval: {
      type: "object",
      description: "Whether confirmed user-approved long-term memory is needed to answer the current userMessage naturally. Decide from the current utterance; recentMessages may only disambiguate continuity.",
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: ["none", "topic_match", "category_browse", "clarification"],
          description: "topic_match needs a concrete subject; category_browse is only for an explicit request to review a known category without a concrete subject; clarification is an explicit prior-memory reference with neither category nor subject; none means no memory work.",
        },
        categories: {
          type: "array",
          description: "Required for topic_match and category_browse; empty for none and clarification.",
          items: {
            type: "string",
            enum: ["person", "place", "experience", "preference", "routine", "wish"],
          },
          maxItems: MEMORY_RETRIEVAL_CONFIG.maxCategories,
        },
        searchTerms: {
          type: "array",
          description: "Concrete subject phrases required only for topic_match; empty for all other modes.",
          items: { type: "string", maxLength: MEMORY_RETRIEVAL_CONFIG.maxSearchTermLength },
          maxItems: MEMORY_RETRIEVAL_CONFIG.maxSearchTerms,
        },
        polarities: {
          type: "array",
          description: "Explicitly requested preference polarity. Empty when unspecified.",
          items: { type: "string", enum: ["positive", "negative", "neutral"] },
          maxItems: 3,
        },
        temporalScopes: {
          type: "array",
          description: "Explicit time scope of the sought fact. Empty when unspecified.",
          items: { type: "string", enum: ["past", "current", "future", "timeless", "unknown"] },
          maxItems: 5,
        },
        purpose: {
          type: "string",
          description: "Concise purpose. Non-empty for topic_match, category_browse, and clarification; empty for none.",
          maxLength: MEMORY_RETRIEVAL_CONFIG.maxPurposeLength,
        },
        noSearchReason: {
          type: "string",
          description: "Use a reason only for mode=none; otherwise use none.",
          enum: ["none", "general_knowledge", "greeting", "current_turn_sufficient", "memory_would_be_unnatural", "no_concrete_topic"],
        },
        clarificationReason: {
          type: "string",
          description: "Use a clarification reason only for mode=clarification; otherwise use none.",
          enum: ["none", "category_and_topic_unknown", "ambiguous_prior_reference"],
        },
      },
      required: ["mode", "categories", "searchTerms", "polarities", "temporalScopes", "purpose", "noSearchReason", "clarificationReason"],
    },
    memoryManagementRequest: {
      type: "object",
      additionalProperties: false,
      properties: {
        intent: { type: "string", enum: ["NONE", "CORRECT", "FORGET"] },
        category: {
          anyOf: [
            {
              type: "string",
              enum: ["person", "place", "experience", "preference", "routine", "wish"],
            },
            { type: "null" },
          ],
        },
        searchTerms: {
          type: "array",
          items: { type: "string", maxLength: MEMORY_RETRIEVAL_CONFIG.maxSearchTermLength },
          maxItems: MEMORY_RETRIEVAL_CONFIG.maxSearchTerms,
        },
        correctedContent: {
          anyOf: [{ type: "string", maxLength: 240 }, { type: "null" }],
        },
      },
      required: ["intent", "category", "searchTerms", "correctedContent"],
    },
  },
  required: [
    "mode",
    "focusTerms",
    "mainFocus",
    "eventType",
    "relationHint",
    "topicType",
    "responsePurpose",
    "questionPolicy",
    "listeningStrategy",
    "memoryCandidates",
    "memoryRetrieval",
    "memoryManagementRequest",
  ],
} as const;

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: noStoreHeaders,
  });
}

function normalizeMoodScore(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }

  return value >= 1 && value <= 5 ? value : null;
}

function clipForInternalPrompt(text: string, maxLength = 240) {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeText(value: unknown, maxLength = 40) {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.replace(/\s+/g, " ").trim();

  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function sanitizeTerms(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const terms: string[] = [];

  for (const item of value) {
    const term = sanitizeText(item, 32);

    if (!term || seen.has(term)) {
      continue;
    }

    seen.add(term);
    terms.push(term);
  }

  return terms.slice(0, 6);
}

function pickEnum<T extends string>(value: unknown, allowed: Set<T>) {
  return typeof value === "string" && allowed.has(value as T)
    ? (value as T)
    : null;
}

function parseJsonObject(text: string) {
  const withoutFence = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence) as Record<string, unknown>;
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");

    if (start < 0 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(withoutFence.slice(start, end + 1)) as Record<
        string,
        unknown
      >;
    } catch {
      return null;
    }
  }
}

function normalizeAiPlanPatch(parsed: Record<string, unknown>): AiPlanPatch | null {
  const focusTerms = sanitizeTerms(parsed.focusTerms);
  const mainFocus = sanitizeText(parsed.mainFocus, 32);
  const relationHint = sanitizeText(parsed.relationHint, 40);
  const patch: AiPlanPatch = {};
  const mode = pickEnum(parsed.mode, conversationModes);
  const eventType = pickEnum(parsed.eventType, eventTypes);
  const topicType = pickEnum(parsed.topicType, topicTypes);
  const responsePurpose = pickEnum(parsed.responsePurpose, responsePurposes);
  const questionPolicy = pickEnum(parsed.questionPolicy, questionPolicies);
  const listeningStrategy = isListeningStrategy(parsed.listeningStrategy)
    ? parsed.listeningStrategy
    : null;

  if (mode) {
    patch.mode = mode;
  }

  if (focusTerms.length > 0) {
    patch.focusTerms = focusTerms;
  }

  if (mainFocus) {
    patch.mainFocus = mainFocus;
  }

  if (eventType) {
    patch.eventType = eventType;
  }

  if (topicType) {
    patch.topicType = topicType;
  }

  if (responsePurpose) {
    patch.responsePurpose = responsePurpose;
  }

  if (questionPolicy) {
    patch.questionPolicy = questionPolicy;
  }

  if (listeningStrategy) {
    patch.listeningStrategy = listeningStrategy;
  }

  if (relationHint) {
    patch.relationHint = relationHint;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function mergeAiPlanPatch(
  localPlan: ConversationTurnPlan,
  patch: AiPlanPatch | null,
  userMessage: string,
  recentAssistantReplies: string[],
): ConversationTurnPlan {
  if (!patch) {
    return localPlan;
  }

  const mainFocus = patch.mainFocus ?? localPlan.mainFocus;
  const focusTerms = [
    ...(mainFocus ? [mainFocus] : []),
    ...(patch.focusTerms ?? []),
    ...localPlan.focusTerms,
  ].filter((term, index, terms) => terms.indexOf(term) === index);
  const mergedPlan: ConversationTurnPlan = {
    ...localPlan,
    mode: patch.mode ?? localPlan.mode,
    focusTerms: focusTerms.slice(0, 6),
    mainFocus,
    eventType: patch.eventType ?? localPlan.eventType,
    relationHint: patch.relationHint ?? localPlan.relationHint,
    topicType: patch.topicType ?? localPlan.topicType,
    responsePurpose: patch.responsePurpose ?? localPlan.responsePurpose,
    questionPolicy: patch.questionPolicy ?? localPlan.questionPolicy,
    listeningStrategy: patch.listeningStrategy ?? localPlan.listeningStrategy,
    shouldAskQuestion: (patch.questionPolicy ?? localPlan.questionPolicy) === "required",
    suggestedQuestion: null,
  };

  return normalizeConversationTurnPlan({
    plan: mergedPlan,
    userMessage,
    recentAssistantReplies,
    hasConcreteTopic:
      localPlan.mainFocus !== null && localPlan.topicType !== "feeling",
  });
}

async function createOpenAIPlanAnalysis({
  messages,
  userMessage,
  localPlan,
  topicStarter,
  topicTitle,
  pendingMemoryConfirmation,
}: {
  messages: StoredChatMessage[];
  userMessage: string;
  localPlan: ConversationTurnPlan;
  topicStarter: boolean;
  topicTitle: string | null;
  pendingMemoryConfirmation: PendingMemoryConfirmation | null;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();

  if (!apiKey || !model) {
    return null;
  }

  const client = new OpenAI({ apiKey });
  const recentMessages = messages.slice(-8).map((message) => ({
    role: message.role,
    content: clipForInternalPrompt(message.content, 160),
  }));
  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content: [
          "You analyze one Japanese conversation turn for a friendly elderly-care chat partner.",
          "Return one object matching the supplied JSON schema.",
          "Pick the most conversation-worthy concrete term, not just a feeling word.",
          "Default to casual conversation. Preserve the user's topic and apparent willingness to continue instead of turning each concrete topic into a question.",
          "The user owns the next step. Do not advance the conversation, choose their next topic, or decide that they will continue or act.",
          "Conversation signals are passive observations. Never ask questions merely to fill an unobserved or false state field.",
          "Never make medical diagnosis. Safety remains handled elsewhere.",
          'Allowed mode: casual, reminiscence, loneliness, anxiety, daily_life, continuation.',
          'Allowed eventType: talked_with, met, went_to, ate, saw, made, heard_about, is_trending, remembered, felt, unknown.',
          'Allowed topicType: person, place, food, activity, object, memory, feeling, unknown.',
          'Allowed listeningStrategy: acknowledge, reflect_content, reflect_emotion, show_interest, ask_open_question, ask_clarification, allow_silence, change_topic.',
          'Allowed responsePurpose: receive, continue_topic, clarify, follow_preference, pause_or_close.',
          'Allowed questionPolicy: avoid, optional, required.',
          "Use continue_topic with questionPolicy=optional for an ordinary concrete topic. A concrete topic alone is not a reason to require a question.",
          "Use clarify with questionPolicy=required only when one necessary point or the user's preference for today must be checked.",
          "Use receive with questionPolicy=avoid after short replies, repeated assistant questions, or a rejected proposal.",
          "Use follow_preference when the user requests a topic change or asks for a suggestion. If a topic change has no destination, one short preference question may be required; if the user supplied the next topic, do not ask again. Do not repeat a rejected suggestion.",
          "Use pause_or_close with questionPolicy=avoid when the user wants to rest or end.",
          "Do not infer loneliness from a family member being absent. Do not propose contact or action unless requested or required for safety.",
          "Treat health and feeling statements as user-reported content, not clinical scores or diagnoses. Never infer or calculate FR-IC.",
          "Do not introduce weather or photos unless the user mentioned them or they are actually present in the input.",
          "memoryCandidates is used for a two-turn consent flow and must contain at most one durable fact.",
          "When pendingMemoryConfirmation is null, extract at most one proposed fact only from userMessage. It will not be saved yet; the assistant will ask permission first.",
          "When pendingMemoryConfirmation is present and userMessage explicitly agrees, reconstruct that one fact from pendingMemoryConfirmation and return it in memoryCandidates.",
          "When pendingMemoryConfirmation is present and userMessage rejects or does not clearly agree, do not return that pending fact.",
          "A short agreement such as はい is evidence of consent only when pendingMemoryConfirmation is present. Never treat a generic short reply as a standalone fact.",
          "Do not infer personality, emotion, diagnosis, cognition, or facts not stated by the user.",
          "Do not extract temporary emotion, meaningless short replies, news, television content, quoted claims, or third-party private information.",
          "Do not extract passwords, financial identifiers, government identifiers, phone numbers, email addresses, or detailed addresses.",
          "Use subject=user only when the fact is about the user. Use other or unknown otherwise.",
          "Use assertion=quoted for someone else's quoted statement and hypothetical only for a clearly stated user wish.",
          "Negative preferences must use category=preference and polarity=negative.",
          "normalizedKey must be a short phrase grounded in userMessage, or in pendingMemoryConfirmation during an explicit confirmation turn.",
          "If nothing qualifies, return an empty memoryCandidates array.",
          "For memoryRetrieval, classify the current userMessage into exactly one mode. Do not assume whether the database contains a match; server-side retrieval handles that.",
          "Use topic_match when the user refers to a concrete remembered subject: categories and short concrete searchTerms are required.",
          "Use category_browse only when the user explicitly asks to review remembered information in a known category, such as their preferences or future wishes, but gives no concrete subject. categories are required and searchTerms must be empty.",
          "Use clarification when the user explicitly refers to prior memory but neither a category nor a concrete subject can be identified. All search conditions must be empty and clarificationReason must explain the ambiguity.",
          "Use none for greetings, general knowledge, ordinary statements about current preferences or experiences, a turn fully answered by current content, or when memory would be unnatural. All search conditions and purpose must be empty, and noSearchReason must not be none.",
          "For topic_match, category_browse, and clarification: purpose must be non-empty and noSearchReason must be none. clarificationReason is non-none only for clarification.",
          "Use polarities and temporalScopes only when the user explicitly asks for them; otherwise use empty arrays.",
          "temporalScopes describes when the remembered fact itself was or will be true. Do not use past merely because the user says it was discussed previously or asks whether it is remembered.",
          "Use userMessage as the source for retrieval intent and search terms. recentMessages may disambiguate what a continuing reference means, but must not independently trigger retrieval.",
          "Example topic_match: 『青い帽子について前に話した？』 => mode=topic_match, categories=[preference], searchTerms=[青い帽子].",
          "Example category_browse: 『私の好みを覚えている？』 => mode=category_browse, categories=[preference], searchTerms=[].",
          "Example clarification: 『前に話したことを覚えている？』 => mode=clarification with empty conditions.",
          "Example none: 『富士山の高さは？』 => mode=none, noSearchReason=general_knowledge. An ordinary statement such as 『今日はコーヒーが好き』 is not a request to browse all preferences.",
          "Detect an explicit request to correct or forget a previously remembered fact in memoryManagementRequest.",
          "Use CORRECT only when the user explicitly says a prior remembered fact is wrong or asks to correct it. Use FORGET only for an explicit request not to remember or to forget it. Otherwise use NONE.",
          "For NONE, category and correctedContent must be null and searchTerms must be empty.",
          "For CORRECT or FORGET, provide one category and concrete search terms for the existing memory. correctedContent is only the explicit corrected fact, otherwise null.",
          "For memoryManagementRequest, category describes the remembered fact, not the sentence's grammatical subject: person=relationships or facts about a named person, preference=likes/dislikes, routine=repeated habits, place=locations, experience=past events, wish=future hopes.",
          "For memoryManagementRequest searchTerms, copy the shortest distinctive noun phrases that identify the old fact (for example 深煎りコーヒー or 朝の散歩). Exclude 私, 記憶, 忘れて, 訂正, 間違い, and other request wording.",
          "A detected management request must never be executed automatically. When intent is CORRECT or FORGET, return an empty memoryCandidates array.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          userMessage,
          topicStarter,
          topicTitle,
          localPlan,
          recentMessages,
          pendingMemoryConfirmation,
        }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "conversation_plan_with_memory_candidates",
        strict: true,
        schema: aiPlanResponseSchema,
      },
    },
    store: false,
  });

  const parsed = parseJsonObject(response.output_text);

  if (!parsed) {
    return {
      planPatch: null,
      memoryRetrieval: null,
      memoryManagementRequest: null,
      memoryCandidates: [],
      rejectedCount: 1,
      rejectionReasonCodes: ["openai_extraction_failed"],
    } satisfies AiPlanAnalysis;
  }

  const confirmationReply = pendingMemoryConfirmation
    ? classifyMemoryConfirmationReply(userMessage)
    : "unclear";
  const validationUtterance =
    pendingMemoryConfirmation && confirmationReply === "confirmed"
      ? `${pendingMemoryConfirmation.sourceMessageContent}\n${pendingMemoryConfirmation.proposedContent}`
      : userMessage;
  const memoryValidation = validateMemoryCandidates({
    rawCandidates: parsed.memoryCandidates,
    currentUtterance: validationUtterance,
  });

  return {
    planPatch: normalizeAiPlanPatch(parsed),
    memoryRetrieval: normalizeMemoryRetrievalRequest(parsed.memoryRetrieval),
    memoryManagementRequest: normalizeDetectedMemoryManagementRequest(
      parsed.memoryManagementRequest,
    ),
    memoryCandidates: memoryValidation.candidates,
    rejectedCount: memoryValidation.rejectedCount,
    rejectionReasonCodes: memoryValidation.rejectionReasonCodes,
  } satisfies AiPlanAnalysis;
}

async function createOpenAIReply({
  messages,
  userMessage,
  turnPlan,
  topicStarter,
  topicTitle,
  memories,
  memoryMode,
  memorySelectionRequired,
  memoryClarificationReason,
  memoryConfirmationContent,
  rejectedReply = null,
  replyRejectionReason = null,
  wellbeingContext,
}: {
  messages: StoredChatMessage[];
  userMessage: string;
  turnPlan: ConversationTurnPlan;
  topicStarter: boolean;
  topicTitle: string | null;
  memories: MemorySearchResult[];
  memoryMode: MemoryRetrievalMode;
  memorySelectionRequired: boolean;
  memoryClarificationReason: MemoryRetrievalRequest["clarificationReason"];
  memoryConfirmationContent: string | null;
  rejectedReply?: string | null;
  replyRejectionReason?: ReplyRejectionReason | null;
  wellbeingContext: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();

  if (!apiKey || !model) {
    return null;
  }

  const client = new OpenAI({ apiKey });
  const responseTurnPlan = memoryMode === "clarification" || memorySelectionRequired
    ? {
        ...turnPlan,
        responsePurpose: "clarify" as const,
        questionPolicy: "required" as const,
        listeningStrategy: "ask_clarification" as const,
        shouldAskQuestion: true,
        suggestedQuestion: null,
      }
    : turnPlan;
  const input = buildAiInput({
    messages,
    userMessage,
    turnPlan: responseTurnPlan,
    topicStarter,
    topicTitle,
    memories: memories.map(toMemoryPromptContext),
    memoryMode,
    memorySelectionRequired,
    memoryClarificationReason,
    memoryConfirmationContent,
    rejectedReply,
    replyRejectionReason,
    wellbeingContext,
  });

  const response = await client.responses.create({
    model,
    input,
    store: false,
  });

  return response.output_text.trim() || null;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonResponse({ error: "authentication_required" }, 401);
  const profileId = user.profileId;

  let body: {
    message?: unknown;
    conversationId?: unknown;
    moodScore?: unknown;
    speechEnabled?: unknown;
    topicStarter?: unknown;
    topicTitle?: unknown;
    rawContent?: unknown;
    inputType?: unknown;
    clientMessageId?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "JSONの形式を確認してください。" }, 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.length <= 120
      ? body.conversationId
      : undefined;
  const moodScore = normalizeMoodScore(body.moodScore);
  const topicStarter = body.topicStarter === true;
  const topicTitle =
    typeof body.topicTitle === "string" && body.topicTitle.length <= 120
      ? body.topicTitle.trim()
      : null;
  const rawContent =
    typeof body.rawContent === "string" ? body.rawContent : message;
  const inputType =
    body.inputType === undefined
      ? "text"
      : isMessageInputType(body.inputType)
        ? body.inputType
        : null;
  const clientMessageId =
    typeof body.clientMessageId === "string" && body.clientMessageId.length <= 120
      ? body.clientMessageId
      : null;

  if (!message) {
    return jsonResponse({ error: "メッセージを入力してください。" }, 400);
  }

  if (message.length > 1000) {
    return jsonResponse(
      { error: "一度に送れる文章は1000文字までです。" },
      400,
    );
  }

  if (!inputType) {
    return jsonResponse({ error: "入力種別が不正です。" }, 400);
  }

  if (rawContent.length > 4000) {
    return jsonResponse({ error: "入力原文が長すぎます。" }, 400);
  }

  const riskLevel: RiskLevel = detectRisk(message);
  const emotionLabel = estimateEmotion(message);
  // Keep the existing response policy independent from the new observational state.
  const emotionScores = scoreEmotions(message);
  const priorSession = conversationId ? await getConversationSession(conversationId, profileId) : null;
  const priorMessages = priorSession?.messages ?? [];
  const priorStateMessage = [...priorMessages].reverse().find((entry) => entry.role === "user" && parseEmotionState(entry.emotionScores));
  const emotionState = riskLevel === "urgent"
    ? resolveEmotionState(null, priorStateMessage?.emotionScores, priorStateMessage?.id ?? null, "skipped", null)
    : await inferEmotionState({
        message, recentMessages: priorMessages,
        previous: priorStateMessage?.emotionScores,
        previousMessageId: priorStateMessage?.id ?? null,
      });
  await syncGoogleHealth(profileId).catch(() => null);
  const physicalSignals = await getLatestPhysicalSignals(profileId).catch(() => null);
  const conversationSuggestion = suggestConversation(emotionScores, physicalSignals);
  const wellbeingContext = JSON.stringify({
    emotionScores,
    physicalSignals,
    conversationSuggestion,
  });
  const savedUserMessage = await recordUserMessage({
    profileId,
    conversationId,
    message,
    rawContent,
    inputType,
    clientMessageId,
    moodScore,
    emotionLabel,
    emotionScores: emotionState,
    riskLevel,
  });
  const recentAssistantReplies = getRecentAssistantReplies(
    savedUserMessage.recentMessages,
  );
  const pendingMemoryConfirmation = findPendingMemoryConfirmation(
    savedUserMessage.recentMessages,
  );
  const memoryConfirmationReply = pendingMemoryConfirmation
    ? classifyMemoryConfirmationReply(message)
    : "unclear";
  let finalTurnPlan: ConversationTurnPlan | null = null;
  let planSource: PlanSource;
  let generationSource: GenerationSource = "mock";
  let reply = "";
  let extractedMemoryCandidates: ExtractedMemoryCandidate[] = [];
  let proposedMemoryCandidates: ExtractedMemoryCandidate[] = [];
  let detectedMemoryManagementRequest: DetectedMemoryManagementRequest | null = null;
  let memoryManagementMatches: MemorySearchResult[] = [];
  let memoryRetrievalRequest: MemoryRetrievalRequest | null = null;
  let memoryRetrievalSource: MemoryRetrievalSource = "none";
  let plannedMemoryRetrievalMode: MemoryRetrievalMode = "none";
  let memorySearchResults: MemorySearchResult[] = [];
  let memorySearchEvaluation: MemorySearchEvaluation | null = null;
  let memoryRetrievalStatus: MemoryRetrievalStatus =
    riskLevel === "urgent"
      ? "skipped_safety"
      : "skipped_no_openai";
  let memoryRetrievalFailureReason: MemoryRetrievalFailureReason | null = null;
  let replyRejectionReason: ReplyRejectionReason | null = null;
  let memoryExtraction = createMemoryExtractionResult(
    riskLevel === "urgent" ? "skipped_safety" : "skipped_no_openai",
  );
  const hasOpenAIConfiguration = Boolean(
    process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_MODEL?.trim(),
  );

  if (riskLevel === "urgent") {
    planSource = "safety";
    generationSource = "safety";
    reply = getUrgentSafetyReply();
  } else {
    const turnPlan = analyzeConversationTurn({
      userMessage: message,
      recentMessages: savedUserMessage.recentMessages,
      recentAssistantReplies,
      safetyResult: riskLevel,
    });
    finalTurnPlan = turnPlan;
    planSource = "local";

    if (hasOpenAIConfiguration) {
      try {
        const aiAnalysis = await createOpenAIPlanAnalysis({
          messages: savedUserMessage.recentMessages,
          userMessage: message,
          localPlan: turnPlan,
          topicStarter,
          topicTitle,
          pendingMemoryConfirmation,
        });

        if (aiAnalysis) {
          memoryRetrievalRequest = aiAnalysis.memoryRetrieval;
          plannedMemoryRetrievalMode = aiAnalysis.memoryRetrieval?.mode ?? "none";
          if (aiAnalysis.memoryRetrieval?.mode === "topic_match" || aiAnalysis.memoryRetrieval?.mode === "category_browse") {
            memoryRetrievalSource = "openai_plan";
          }
          detectedMemoryManagementRequest = aiAnalysis.memoryManagementRequest;
          const blocksNewMemory =
            detectedMemoryManagementRequest?.intent === "CORRECT" ||
            detectedMemoryManagementRequest?.intent === "FORGET";
          const validatedCandidates = blocksNewMemory
            ? []
            : aiAnalysis.memoryCandidates.slice(0, 1);
          if (pendingMemoryConfirmation && memoryConfirmationReply === "confirmed") {
            extractedMemoryCandidates = validatedCandidates;
          } else {
            proposedMemoryCandidates = validatedCandidates;
          }

          memoryExtraction = createMemoryExtractionResult(
            proposedMemoryCandidates.length > 0
              ? "awaiting_confirmation"
              : pendingMemoryConfirmation && memoryConfirmationReply === "rejected"
                ? "confirmation_rejected"
                : aiAnalysis.rejectedCount > 0
                  ? "filtered"
                  : "no_candidates",
            {
              candidateCount: proposedMemoryCandidates.length,
              categories: proposedMemoryCandidates.map((candidate) => candidate.category),
              rejectedCount: aiAnalysis.rejectedCount,
              rejectionReasonCodes: aiAnalysis.rejectionReasonCodes,
            },
          );

          if (aiAnalysis.planPatch) {
            finalTurnPlan = mergeAiPlanPatch(
              turnPlan,
              aiAnalysis.planPatch,
              message,
              recentAssistantReplies,
            );
            planSource = "openai";
          }

          if (proposedMemoryCandidates.length > 0 && finalTurnPlan) {
            finalTurnPlan = {
              ...finalTurnPlan,
              responsePurpose: "clarify",
              questionPolicy: "required",
              listeningStrategy: "ask_clarification",
              shouldAskQuestion: true,
              suggestedQuestion: createMemoryConfirmationQuestion(proposedMemoryCandidates[0]),
            };
          }
        }
      } catch {
        finalTurnPlan = turnPlan;
        planSource = "local";
        memoryExtraction = createMemoryExtractionResult("failed", {
          rejectedCount: 1,
          rejectionReasonCodes: ["openai_extraction_failed"],
        });
        memoryRetrievalStatus = "failed";
        memoryRetrievalFailureReason = "plan_unavailable";
      }
    }

    const hasMemoryManagementRequest =
      detectedMemoryManagementRequest?.intent === "CORRECT" ||
      detectedMemoryManagementRequest?.intent === "FORGET";
    if (hasMemoryManagementRequest) {
      memoryRetrievalRequest = {
        mode: "none",
        categories: [],
        searchTerms: [],
        polarities: [],
        temporalScopes: [],
        purpose: "",
        noSearchReason: "current_turn_sufficient",
        clarificationReason: "none",
      };
      memoryRetrievalSource = "none";
    } else if (
      hasOpenAIConfiguration &&
      (memoryRetrievalRequest?.mode === "none" || memoryRetrievalRequest?.mode === "clarification")
    ) {
      const fallbackRequest = createContinuityFallbackRequest(message);
      if (
        fallbackRequest &&
        (memoryRetrievalRequest.mode === "none" || fallbackRequest.mode !== "clarification")
      ) {
        memoryRetrievalRequest = fallbackRequest;
        memoryRetrievalSource = "local_fallback";
      }
    }

    if (memoryRetrievalRequest?.mode === "topic_match" || memoryRetrievalRequest?.mode === "category_browse") {
      try {
        const retrieval = await retrieveConfirmedMemories({
          profileId,
          storageBackend: savedUserMessage.storageBackend,
          request: memoryRetrievalRequest,
        });
        memorySearchEvaluation = retrieval;
        memorySearchResults = retrieval.results;
        memoryRetrievalStatus = retrieval.results.length === 0
          ? "no_match"
          : retrieval.selectionRequired
            ? "candidate_selection_required"
            : "retrieved";
      } catch {
        console.warn("Confirmed memory retrieval failed; continuing without memory.");
        memorySearchResults = [];
        memoryRetrievalStatus = "failed";
        memoryRetrievalFailureReason = "memory_read_failed";
      }
    } else if (hasOpenAIConfiguration && memoryRetrievalStatus !== "failed") {
      memoryRetrievalStatus = memoryRetrievalRequest
        ? memoryRetrievalRequest.mode === "clarification" ? "clarification" : "not_requested"
        : "failed";
      memoryRetrievalFailureReason = memoryRetrievalRequest
        ? null
        : "invalid_request";
    }

    if (
      detectedMemoryManagementRequest &&
      detectedMemoryManagementRequest.intent !== "NONE" &&
      detectedMemoryManagementRequest.category
    ) {
      try {
        const managementRetrieval = await retrieveConfirmedMemories({
          profileId,
          storageBackend: savedUserMessage.storageBackend,
          request: {
            mode: "topic_match",
            categories: [detectedMemoryManagementRequest.category],
            searchTerms: detectedMemoryManagementRequest.searchTerms,
            polarities: [],
            temporalScopes: [],
            purpose:
              detectedMemoryManagementRequest.intent === "CORRECT"
                ? "conversation_correction"
                : "conversation_forget",
            noSearchReason: "none",
            clarificationReason: "none",
          },
        });
        memoryManagementMatches = managementRetrieval.results;
      } catch {
        console.warn("Memory management target lookup failed; saving without matches.");
        memoryManagementMatches = [];
      }
    }

    if (
      finalTurnPlan &&
      (memoryRetrievalRequest?.mode === "clarification" || memorySearchEvaluation?.selectionRequired)
    ) {
      finalTurnPlan = {
        ...finalTurnPlan,
        responsePurpose: "clarify",
        questionPolicy: "required",
        listeningStrategy: "ask_clarification",
        shouldAskQuestion: true,
        suggestedQuestion: null,
      };
    }

    if (
      finalTurnPlan &&
      memoryRetrievalRequest?.mode !== "clarification" &&
      !memorySearchEvaluation?.selectionRequired
    ) {
      if (emotionScores.anxiety >= 0.45 || emotionScores.loneliness >= 0.45) {
        finalTurnPlan = {
          ...finalTurnPlan,
          mode: emotionScores.anxiety >= emotionScores.loneliness ? "anxiety" : "loneliness",
          listeningStrategy: "reflect_emotion",
          shouldAskQuestion: false,
          suggestedQuestion: null,
        };
      } else if (emotionScores.positive_affect >= 0.45 || emotionScores.interest >= 0.45) {
        finalTurnPlan = {
          ...finalTurnPlan,
          listeningStrategy: "show_interest",
        };
      } else if (physicalSignals?.sleepMinutes != null && physicalSignals.sleepMinutes < 360) {
        finalTurnPlan = {
          ...finalTurnPlan,
          listeningStrategy: "acknowledge",
          shouldAskQuestion: false,
          suggestedQuestion: null,
        };
      }
    }

    let generatedReply: string | null = null;

    if (hasOpenAIConfiguration) {
      try {
        let rejectedReply: string | null = null;
        let previousRejectionReason: ReplyRejectionReason | null = null;

        for (let attempt = 0; attempt < 2; attempt += 1) {
          const candidateReply = await createOpenAIReply({
            messages: savedUserMessage.recentMessages,
            userMessage: message,
            turnPlan: finalTurnPlan,
            topicStarter,
            topicTitle,
            memories: memorySearchResults,
            memoryMode: memoryRetrievalRequest?.mode ?? "none",
            memorySelectionRequired: memorySearchEvaluation?.selectionRequired ?? false,
            memoryClarificationReason: memoryRetrievalRequest?.clarificationReason ?? "none",
            memoryConfirmationContent: proposedMemoryCandidates[0]?.content ?? null,
            rejectedReply,
            replyRejectionReason: previousRejectionReason,
            wellbeingContext,
          });
          const validation = validateReplyAgainstContract({
            text: candidateReply ?? "",
            memoryMode: memoryRetrievalRequest?.mode ?? "none",
            memorySelectionRequired: memorySearchEvaluation?.selectionRequired ?? false,
            listeningStrategy: finalTurnPlan?.listeningStrategy ?? null,
            questionPolicy: finalTurnPlan?.questionPolicy ?? "optional",
            responsePurpose: finalTurnPlan?.responsePurpose ?? "receive",
            conversationSignals: finalTurnPlan?.conversationSignals ?? null,
            memoryConfirmationContent: proposedMemoryCandidates[0]?.content ?? null,
            memories: memorySearchResults.map(toMemoryPromptContext),
            currentUserMessage: message,
          });

          replyRejectionReason = validation.reason;
          if (validation.accepted) {
            generatedReply = candidateReply;
            break;
          }
          rejectedReply = candidateReply;
          previousRejectionReason = validation.reason;
        }
      } catch {
        replyRejectionReason = "generation_error";
        console.warn("OpenAI response failed; using mock reply.");
      }
    }

    if (generatedReply) {
      reply = generatedReply;
      generationSource = "openai";
    } else {
      memorySearchEvaluation = discardSelectedMemoryResults(memorySearchEvaluation);
      memorySearchResults = [];
      reply = createMockReply({
        userMessage: message,
        turnPlan: finalTurnPlan,
        recentMessages: savedUserMessage.recentMessages,
        topicStarter,
        topicTitle,
        memoryMode: memoryRetrievalRequest?.mode ?? "none",
        memories: memorySearchResults.map(toMemoryPromptContext),
        memorySelectionRequired: memorySearchEvaluation?.selectionRequired ?? false,
      });
      generationSource = "mock";
    }
  }

  const sourceUtteranceIds = dedupeSourceUtteranceIds(
    riskLevel === "urgent"
      ? [savedUserMessage.userMessage.id]
      : savedUserMessage.recentMessages
          .filter((storedMessage) => storedMessage.role === "user")
          .map((storedMessage) => storedMessage.id),
  );
  const createDecisionInput = () => ({
      conversationId: savedUserMessage.conversationId,
      listeningStrategy: finalTurnPlan?.listeningStrategy ?? null,
      planSource,
      generationSource,
      mode: finalTurnPlan?.mode ?? "safety",
      mainFocus: finalTurnPlan?.mainFocus ?? null,
      shouldAskQuestion: finalTurnPlan?.shouldAskQuestion ?? false,
      sourceUtteranceIds,
      memoryUsages: memorySearchResults.map((result) => ({
        memoryId: result.memory.id,
        retrievalScore: result.score,
        usageReason: result.reason,
        usageRole: memoryRetrievalRequest?.mode === "category_browse"
          ? "candidate_presentation" as const
          : "answer_context" as const,
      })),
      memoryRetrievalAudit: createMemoryRetrievalAuditInput({
        profileId,
        request: memoryRetrievalRequest,
        requestSource: memoryRetrievalSource,
        plannedMode: plannedMemoryRetrievalMode,
        evaluation: memorySearchEvaluation,
        status: memoryRetrievalStatus,
        failureReason: memoryRetrievalFailureReason,
        generationRejectionReason: replyRejectionReason,
      }),
      ...(detectedMemoryManagementRequest &&
      detectedMemoryManagementRequest.intent !== "NONE" &&
      detectedMemoryManagementRequest.category
        ? {
            memoryManagementRequest: {
              profileId,
              sourceMessageId: savedUserMessage.userMessage.id,
              intent: detectedMemoryManagementRequest.intent,
              category: detectedMemoryManagementRequest.category,
              searchTerms: detectedMemoryManagementRequest.searchTerms,
              correctedContent: detectedMemoryManagementRequest.correctedContent,
              matches: memoryManagementMatches.map((result) => ({
                memoryId: result.memory.id,
                score: result.score,
              })),
            },
          }
        : {}),
    });
  let savedAssistantTurn;
  try {
    savedAssistantTurn = await recordAssistantTurn({
      profileId,
      conversationId: savedUserMessage.conversationId,
      reply,
      emotionLabel,
      riskLevel,
      storageBackend: savedUserMessage.storageBackend,
      decision: createDecisionInput(),
    });
  } catch (error) {
    if (memorySearchResults.length === 0 || !finalTurnPlan) throw error;
    console.warn("Memory usage audit save failed; discarding memory-assisted reply.");
    memorySearchResults = [];
    memorySearchEvaluation = discardSelectedMemoryResults(memorySearchEvaluation);
    memoryRetrievalStatus = "failed";
    memoryRetrievalFailureReason = "usage_write_failed";
    reply = createMockReply({
      userMessage: message,
      turnPlan: finalTurnPlan,
      recentMessages: savedUserMessage.recentMessages,
      topicStarter,
      topicTitle,
      memoryMode: "none",
    });
    generationSource = "mock";
    savedAssistantTurn = await recordAssistantTurn({
      profileId,
      conversationId: savedUserMessage.conversationId,
      reply,
      emotionLabel,
      riskLevel,
      storageBackend: savedUserMessage.storageBackend,
      decision: createDecisionInput(),
    });
  }
  if (extractedMemoryCandidates.length > 0) {
    const sourceMessageIds = pendingMemoryConfirmation
      ? [pendingMemoryConfirmation.sourceMessageId, savedUserMessage.userMessage.id]
      : [savedUserMessage.userMessage.id];
    const memoryWrite = await recordMemoryCandidates({
      profileId,
      conversationId: savedUserMessage.conversationId,
      decisionId: savedAssistantTurn.decision.id,
      sourceMessageIds,
      storageBackend: savedUserMessage.storageBackend,
      candidates: extractedMemoryCandidates,
    });

    if (memoryWrite.failureReason) {
      memoryExtraction = createMemoryExtractionResult("failed", {
        rejectedCount: memoryExtraction.rejectedCount + 1,
        rejectionReasonCodes: [
          ...memoryExtraction.rejectionReasonCodes,
          memoryWrite.failureReason,
        ].filter((reason, index, reasons) => reasons.indexOf(reason) === index),
      });
    } else {
      const resolutionResults = await Promise.all(
        memoryWrite.candidates.map(async (candidate) => {
          try {
            return await resolveMemoryCandidate({
              profileId,
              candidateId: candidate.id,
              action: "ADD",
              actor: "user",
              reasonCode: "new_memory",
            });
          } catch {
            return null;
          }
        }),
      );
      const resolutionFailed = resolutionResults.some((result) => !result?.ok);
      memoryExtraction = createMemoryExtractionResult(resolutionFailed ? "failed" : "saved", {
        candidateCount: memoryWrite.candidates.length,
        candidateIds: memoryWrite.candidates.map((candidate) => candidate.id),
        categories: [
          ...new Set(memoryWrite.candidates.map((candidate) => candidate.category)),
        ],
        rejectedCount: memoryExtraction.rejectedCount,
        rejectionReasonCodes: memoryExtraction.rejectionReasonCodes,
      });
    }
  }
  const usedMock = generationSource === "mock";

  return jsonResponse({
    reply,
    conversationId: savedUserMessage.conversationId,
    userMessageId: savedUserMessage.userMessage.id,
    assistantMessageId: savedAssistantTurn.assistantMessage.id,
    decisionId: savedAssistantTurn.decision.id,
    listeningStrategy: finalTurnPlan?.listeningStrategy ?? null,
    sourceUtteranceIds,
    planSource,
    generationSource,
    emotionLabel,
    emotionScores: parseStateScores(emotionState),
    emotionState,
    physicalSignals,
    conversationSuggestion,
    riskLevel,
    usedMock,
    memoryExtraction,
    debug: {
      usedMock,
      planSource,
      generationSource,
      listeningStrategy: finalTurnPlan?.listeningStrategy ?? null,
      mode: finalTurnPlan?.mode ?? "safety",
      mainFocus: finalTurnPlan?.mainFocus ?? null,
      focusTerms: finalTurnPlan?.focusTerms ?? [],
      eventType: finalTurnPlan?.eventType ?? "unknown",
      topicType: finalTurnPlan?.topicType ?? "unknown",
      responsePurpose: finalTurnPlan?.responsePurpose ?? "safety",
      questionPolicy: finalTurnPlan?.questionPolicy ?? "required",
      conversationSignals: finalTurnPlan?.conversationSignals ?? null,
      shouldAskQuestion: finalTurnPlan?.shouldAskQuestion ?? false,
      suggestedQuestion: finalTurnPlan?.suggestedQuestion ?? null,
      topicStarter,
      memoryExtraction: {
        status: memoryExtraction.status,
        candidateCount: memoryExtraction.candidateCount,
        categories: memoryExtraction.categories,
        rejectedCount: memoryExtraction.rejectedCount,
        rejectionReasonCodes: memoryExtraction.rejectionReasonCodes,
      },
      memoryRetrieval: {
        executed:
          memorySearchEvaluation !== null ||
          memoryRetrievalFailureReason === "memory_read_failed",
        candidateCount: memorySearchEvaluation?.activeMemoryCount ?? 0,
        usedCount: memorySearchResults.length,
        categories: [
          ...new Set(memorySearchResults.map((result) => result.memory.category)),
        ],
        source: memoryRetrievalSource,
        status: memoryRetrievalStatus,
        failureReason: memoryRetrievalFailureReason,
      },
    },
  });
}
