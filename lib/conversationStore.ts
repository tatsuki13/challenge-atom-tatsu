import {
  addUtcDays,
  dateKeyToUtcDate,
  getTokyoDateKey,
} from "./date";
import {
  endDemoConversation,
  getDemoConversationSession,
  getDemoMetrics,
  recordDemoAssistantTurn,
  recordDemoMemoryCandidates,
  recordDemoUserMessage,
} from "./demoStore";
import { MEMORY_EXTRACTION_VERSION } from "./ai/memoryExtraction";
import { getPrismaClient } from "./prisma";
import type { EmotionState } from "./emotionState";
import { validateMemoryRetrievalAudit } from "./memoryRetrievalAuditRules";
import {
  DEMO_PROFILE_ID,
  RECENT_MESSAGE_LIMIT,
  type EmotionLabel,
  type ConversationSession,
  type ExtractedMemoryCandidate,
  type ConversationDecisionInput,
  type MetricsSummary,
  type MessageInputType,
  type RiskLevel,
  type StorageMode,
  type StoredConversationDecision,
  type StoredChatMessage,
  type StoredMemoryCandidate,
} from "./conversationTypes";

type PrismaClientInstance = NonNullable<ReturnType<typeof getPrismaClient>>;
type ProfileStoreClient = Pick<PrismaClientInstance, "profile">;
type MetricsStoreClient = Pick<PrismaClientInstance, "dailyMetric">;

function toStoredMessage(message: {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  emotionLabel: string | null;
  emotionScores?: unknown;
  riskLevel: string;
  rawContent: string | null;
  inputType: string;
  clientMessageId: string | null;
  createdAt: Date;
}): StoredChatMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
    emotionLabel: (message.emotionLabel as EmotionLabel | null) ?? null,
    emotionScores: message.emotionScores,
    riskLevel: (message.riskLevel as RiskLevel) ?? "none",
    rawContent: message.rawContent,
    inputType: message.inputType as MessageInputType,
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt,
  };
}

function getAiMode() {
  return process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_MODEL?.trim()
    ? "openai"
    : "mock";
}

async function ensureDemoProfile(prisma: ProfileStoreClient) {
  await prisma.profile.upsert({
    where: { id: DEMO_PROFILE_ID },
    create: {
      id: DEMO_PROFILE_ID,
      displayName: "デモ利用者",
      consentFamilyShare: false,
    },
    update: {},
  });
}

export async function getConversationSession(
  conversationId: string,
  profileId: string = DEMO_PROFILE_ID,
): Promise<ConversationSession | null> {
  const prisma = getPrismaClient();

  if (!prisma) {
    return profileId === DEMO_PROFILE_ID
      ? getDemoConversationSession(conversationId)
      : null;
  }

  try {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        profileId,
        endedAt: null,
      },
      select: {
        id: true,
        startedAt: true,
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!conversation) {
      return profileId === DEMO_PROFILE_ID
        ? getDemoConversationSession(conversationId)
        : null;
    }
    if (getTokyoDateKey(conversation.startedAt) !== getTokyoDateKey()) {
      return null;
    }

    return {
      conversationId: conversation.id,
      startedAt: conversation.startedAt,
      messages: conversation.messages.map(toStoredMessage),
      storageBackend: "database",
    };
  } catch {
    console.warn("Conversation session read failed.", {
      reasonCode: "conversation_session_read_failed",
    });
    return profileId === DEMO_PROFILE_ID
      ? getDemoConversationSession(conversationId)
      : null;
  }
}

export async function endConversationSession(
  conversationId: string,
  profileId: string = DEMO_PROFILE_ID,
) {
  const prisma = getPrismaClient();

  if (!prisma) {
    return profileId === DEMO_PROFILE_ID
      ? endDemoConversation(conversationId)
      : false;
  }

  try {
    const result = await prisma.conversation.updateMany({
      where: {
        id: conversationId,
        profileId,
        endedAt: null,
      },
      data: { endedAt: new Date() },
    });
    return (
      result.count === 1 ||
      (profileId === DEMO_PROFILE_ID && endDemoConversation(conversationId))
    );
  } catch {
    console.warn("Conversation session end failed.", {
      reasonCode: "conversation_session_end_failed",
    });
    return profileId === DEMO_PROFILE_ID
      ? endDemoConversation(conversationId)
      : false;
  }
}

async function incrementDailyMetric({
  prisma,
  newConversation,
  userMessageCount,
  assistantMessageCount,
  userCharCount,
  profileId,
}: {
  prisma: MetricsStoreClient;
  newConversation: boolean;
  userMessageCount: number;
  assistantMessageCount: number;
  userCharCount: number;
  profileId: string;
}) {
  const dateKey = getTokyoDateKey();
  const date = dateKeyToUtcDate(dateKey);
  const estimatedMinutes = userMessageCount > 0 ? 1 : 0;

  await prisma.dailyMetric.upsert({
    where: {
      profileId_date: {
        profileId,
        date,
      },
    },
    create: {
      profileId,
      date,
      conversationCount: newConversation ? 1 : 0,
      userMessageCount,
      assistantMessageCount,
      userCharCount,
      estimatedMinutes,
    },
    update: {
      conversationCount: { increment: newConversation ? 1 : 0 },
      userMessageCount: { increment: userMessageCount },
      assistantMessageCount: { increment: assistantMessageCount },
      userCharCount: { increment: userCharCount },
      estimatedMinutes: { increment: estimatedMinutes },
    },
  });
}

export async function recordUserMessage({
  profileId = DEMO_PROFILE_ID,
  conversationId,
  message,
  rawContent,
  inputType,
  clientMessageId,
  moodScore,
  emotionLabel,
  emotionScores,
  riskLevel,
}: {
  profileId?: string;
  conversationId?: string;
  message: string;
  rawContent: string | null;
  inputType: MessageInputType;
  clientMessageId: string | null;
  moodScore: number | null;
  emotionLabel: EmotionLabel;
  emotionScores?: EmotionState;
  riskLevel: RiskLevel;
}): Promise<{
  conversationId: string;
  userMessage: StoredChatMessage;
  recentMessages: StoredChatMessage[];
  storageBackend: StorageMode;
}> {
  const prisma = getPrismaClient();

  if (!prisma) {
    if (profileId !== DEMO_PROFILE_ID) {
      throw new Error("Database storage is required for authenticated users.");
    }
    return recordDemoUserMessage({
      conversationId,
      message,
      rawContent,
      inputType,
      clientMessageId,
      moodScore,
      emotionLabel,
      emotionScores,
      riskLevel,
    });
  }

  try {
    const result = await prisma.$transaction(async (transaction) => {
      if (profileId === DEMO_PROFILE_ID) await ensureDemoProfile(transaction);

      const existingConversation = conversationId
        ? await transaction.conversation.findFirst({
            where: {
              id: conversationId,
              profileId,
              endedAt: null,
            },
          })
        : null;
      const currentConversation =
        existingConversation &&
        getTokyoDateKey(existingConversation.startedAt) === getTokyoDateKey()
          ? existingConversation
          : null;
      const conversation =
        currentConversation ??
        (await transaction.conversation.create({
          data: {
            profileId,
            title: message.slice(0, 24) || "今日の会話",
            moodScoreStart: moodScore,
            moodScoreEnd: moodScore,
          },
        }));

      if (currentConversation && moodScore !== null) {
        await transaction.conversation.update({
          where: { id: conversation.id },
          data: { moodScoreEnd: moodScore },
        });
      }

      const userMessage = await transaction.message.create({
        data: {
          conversationId: conversation.id,
          role: "user",
          content: message,
          rawContent,
          inputType,
          clientMessageId,
          emotionLabel,
          emotionScores,
          riskLevel,
        },
      });

      if (riskLevel !== "none") {
        await transaction.riskEvent.create({
          data: {
            profileId,
            conversationId: conversation.id,
            messageId: userMessage.id,
            riskLevel,
            note: `${riskLevel} keyword detected`,
          },
        });
      }

      await incrementDailyMetric({
        prisma: transaction,
        newConversation: !currentConversation,
        userMessageCount: 1,
        assistantMessageCount: 0,
        userCharCount: message.length,
        profileId,
      });

      const recentMessages = await transaction.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "desc" },
        take: RECENT_MESSAGE_LIMIT,
      });

      return { conversation, userMessage, recentMessages };
    });

    return {
      conversationId: result.conversation.id,
      userMessage: toStoredMessage(result.userMessage),
      recentMessages: result.recentMessages.reverse().map(toStoredMessage),
      storageBackend: "database",
    };
  } catch {
    if (profileId !== DEMO_PROFILE_ID) throw new Error("Database save failed.");
    console.warn("Database save failed; using memory store.");
    return recordDemoUserMessage({
      conversationId,
      message,
      rawContent,
      inputType,
      clientMessageId,
      moodScore,
      emotionLabel,
      emotionScores,
      riskLevel,
    });
  }
}

export async function recordAssistantTurn({
  profileId = DEMO_PROFILE_ID,
  conversationId,
  reply,
  emotionLabel,
  riskLevel,
  storageBackend,
  decision,
}: {
  profileId?: string;
  conversationId: string;
  reply: string;
  emotionLabel: EmotionLabel;
  riskLevel: RiskLevel;
  storageBackend: StorageMode;
  decision: ConversationDecisionInput;
}): Promise<{
  assistantMessage: StoredChatMessage;
  decision: StoredConversationDecision;
}> {
  if (storageBackend === "memory") {
    if (profileId !== DEMO_PROFILE_ID) {
      throw new Error("In-memory storage is unavailable for authenticated users.");
    }
    return recordDemoAssistantTurn({
      conversationId,
      reply,
      emotionLabel,
      riskLevel,
      decision,
    });
  }

  const prisma = getPrismaClient();

  if (!prisma) {
    throw new Error("Database storage became unavailable during the turn.");
  }

  if (decision.conversationId !== conversationId) {
    throw new Error("Decision and assistant message must belong to the same conversation.");
  }

  const sourceUtteranceIds = [...new Set(decision.sourceUtteranceIds)];
  const memoryUsages = decision.memoryUsages ?? [];
  const retrievalAudit = decision.memoryRetrievalAudit;
  const memoryIds = memoryUsages.map((usage) => usage.memoryId);
  const managementRequest = decision.memoryManagementRequest;
  const managementMemoryIds = managementRequest?.matches.map((match) => match.memoryId) ?? [];
  const auditMemoryIds = retrievalAudit.results.map((result) => result.memoryId);

  if (sourceUtteranceIds.length === 0) {
    throw new Error("At least one source utterance is required.");
  }
  if (new Set(memoryIds).size !== memoryIds.length) {
    throw new Error("A memory can be used only once per assistant response.");
  }
  if (new Set(managementMemoryIds).size !== managementMemoryIds.length) {
    throw new Error("Memory management matches must be unique.");
  }
  const invalidAudit = validateMemoryRetrievalAudit(retrievalAudit, memoryUsages);
  if (invalidAudit) throw new Error(invalidAudit);
  if (
    memoryUsages.some(
      (usage) =>
        !Number.isFinite(usage.retrievalScore) ||
        usage.retrievalScore < 0 ||
        !usage.usageReason.trim() ||
        usage.usageReason.length > 120,
    )
  ) {
    throw new Error("Memory usage audit values are invalid.");
  }

  const result = await prisma.$transaction(async (transaction) => {
    const conversation = await transaction.conversation.findFirst({
      where: { id: conversationId, profileId },
      select: { profileId: true },
    });
    if (!conversation) {
      throw new Error("Conversation was not found.");
    }
    if (
      managementRequest &&
      (managementRequest.profileId !== conversation.profileId ||
        managementRequest.sourceMessageId !== sourceUtteranceIds.at(-1))
    ) {
      throw new Error("Memory management request ownership is invalid.");
    }
    if (retrievalAudit.profileId !== conversation.profileId) {
      throw new Error("Memory retrieval audit profile mismatch.");
    }
    const sourceMessages = await transaction.message.findMany({
      where: {
        id: { in: sourceUtteranceIds },
        conversationId,
        role: "user",
      },
      select: { id: true },
    });

    if (sourceMessages.length !== sourceUtteranceIds.length) {
      throw new Error("Decision sources must be existing user messages in the same conversation.");
    }
    const activeMemories =
      memoryIds.length > 0
        ? await transaction.memory.findMany({
            where: {
              id: { in: memoryIds },
              profileId: conversation.profileId,
              status: "active",
            },
            select: { id: true },
          })
        : [];
    if (activeMemories.length !== memoryIds.length) {
      throw new Error("Memory usages must reference active memories in the same profile.");
    }
    const managementMemories =
      managementMemoryIds.length > 0
        ? await transaction.memory.findMany({
            where: {
              id: { in: managementMemoryIds },
              profileId: conversation.profileId,
              status: "active",
            },
            select: { id: true },
          })
        : [];
    if (managementMemories.length !== managementMemoryIds.length) {
      throw new Error("Memory management matches must be active and in the same profile.");
    }
    const auditMemories =
      auditMemoryIds.length > 0
        ? await transaction.memory.findMany({
            where: { id: { in: auditMemoryIds }, profileId: conversation.profileId },
            select: { id: true },
          })
        : [];
    if (auditMemories.length !== auditMemoryIds.length) {
      throw new Error("Memory retrieval audit results must belong to the same profile.");
    }

    const assistantMessage = await transaction.message.create({
      data: {
        conversationId,
        role: "assistant",
        content: reply,
        rawContent: reply,
        inputType: "text",
        emotionLabel,
        riskLevel,
      },
    });
    const storedDecision = await transaction.conversationDecision.create({
      data: {
        conversationId,
        responseMessageId: assistantMessage.id,
        listeningStrategy: decision.listeningStrategy,
        planSource: decision.planSource,
        generationSource: decision.generationSource,
        mode: decision.mode,
        mainFocus: decision.mainFocus,
        shouldAskQuestion: decision.shouldAskQuestion,
        sourceUtterances: {
          create: sourceUtteranceIds.map((sourceMessageId) => ({
            sourceMessageId,
          })),
        },
      },
    });
    if (memoryUsages.length > 0) {
      await transaction.memoryUsage.createMany({
        data: memoryUsages.map((usage) => ({
          memoryId: usage.memoryId,
          assistantMessageId: assistantMessage.id,
          conversationId,
          decisionId: storedDecision.id,
          retrievalScore: usage.retrievalScore,
          usageReason: usage.usageReason,
          usageRole: usage.usageRole,
        })),
      });
    }
    await transaction.memoryRetrievalAudit.create({
      data: {
        decisionId: storedDecision.id,
        profileId: retrievalAudit.profileId,
        executed: retrievalAudit.executed,
        status: retrievalAudit.status,
        requestSource: retrievalAudit.requestSource,
        plannedMode: retrievalAudit.plannedMode,
        finalMode: retrievalAudit.finalMode,
        noSearchReason: retrievalAudit.noSearchReason,
        clarificationReason: retrievalAudit.clarificationReason,
        categories: retrievalAudit.categories,
        polarities: retrievalAudit.polarities,
        temporalScopes: retrievalAudit.temporalScopes,
        activeMemoryCount: retrievalAudit.activeMemoryCount,
        thresholdPassedCount: retrievalAudit.thresholdPassedCount,
        selectedCount: retrievalAudit.selectedCount,
        failureReason: retrievalAudit.failureReason,
        generationRejectionReason: retrievalAudit.generationRejectionReason,
        configVersion: retrievalAudit.configVersion,
        minimumScore: retrievalAudit.minimumScore,
        maxResults: retrievalAudit.maxResults,
        maxContextCharacters: retrievalAudit.maxContextCharacters,
        attributeStrategy: retrievalAudit.attributeStrategy,
        results: {
          create: retrievalAudit.results.map((result) => ({
            memoryId: result.memoryId,
            categoryMatch: result.scoreBreakdown.categoryMatch,
            normalizedKeyExact: result.scoreBreakdown.normalizedKeyExact,
            normalizedKeyPartial: result.scoreBreakdown.normalizedKeyPartial,
            contentPartial: result.scoreBreakdown.contentPartial,
            bigramSimilarity: result.scoreBreakdown.bigramSimilarity,
            bigramScore: result.scoreBreakdown.bigramScore,
            polarityMatch: result.scoreBreakdown.polarityMatch,
            polarityMismatch: result.scoreBreakdown.polarityMismatch,
            temporalScopeMatch: result.scoreBreakdown.temporalScopeMatch,
            temporalScopeMismatch: result.scoreBreakdown.temporalScopeMismatch,
            finalScore: result.scoreBreakdown.finalScore,
            disposition: result.disposition,
          })),
        },
      },
    });
    if (managementRequest) {
      await transaction.memoryManagementRequest.create({
        data: {
          profileId: managementRequest.profileId,
          conversationId,
          sourceMessageId: managementRequest.sourceMessageId,
          decisionId: storedDecision.id,
          intent: managementRequest.intent,
          category: managementRequest.category,
          searchTerms: managementRequest.searchTerms,
          correctedContent: managementRequest.correctedContent,
          matches: {
            create: managementRequest.matches.map((match) => ({
              memoryId: match.memoryId,
              score: match.score,
            })),
          },
        },
      });
    }

    await incrementDailyMetric({
      prisma: transaction,
      newConversation: false,
      userMessageCount: 0,
      assistantMessageCount: 1,
      userCharCount: 0,
      profileId,
    });

    return { assistantMessage, storedDecision };
  });

  return {
    assistantMessage: toStoredMessage(result.assistantMessage),
    decision: {
      id: result.storedDecision.id,
      conversationId: result.storedDecision.conversationId,
      responseMessageId: result.storedDecision.responseMessageId,
      listeningStrategy: result.storedDecision.listeningStrategy as ConversationDecisionInput["listeningStrategy"],
      planSource: result.storedDecision.planSource as ConversationDecisionInput["planSource"],
      generationSource: result.storedDecision.generationSource as ConversationDecisionInput["generationSource"],
      mode: result.storedDecision.mode,
      mainFocus: result.storedDecision.mainFocus,
      shouldAskQuestion: result.storedDecision.shouldAskQuestion,
      sourceUtteranceIds,
      createdAt: result.storedDecision.createdAt,
    },
  };
}

export async function recordMemoryCandidates({
  profileId = DEMO_PROFILE_ID,
  conversationId,
  decisionId,
  sourceMessageIds,
  storageBackend,
  candidates,
}: {
  profileId?: string;
  conversationId: string;
  decisionId: string;
  sourceMessageIds: string[];
  storageBackend: StorageMode;
  candidates: ExtractedMemoryCandidate[];
}): Promise<{
  candidates: StoredMemoryCandidate[];
  failureReason: "memory_write_failed" | null;
}> {
  if (candidates.length === 0) {
    return { candidates: [], failureReason: null };
  }

  if (storageBackend === "memory") {
    if (profileId !== DEMO_PROFILE_ID) {
      return { candidates: [], failureReason: "memory_write_failed" };
    }
    try {
      return {
        candidates: recordDemoMemoryCandidates({
          conversationId,
          decisionId,
          sourceMessageIds,
          candidates,
          extractionVersion: MEMORY_EXTRACTION_VERSION,
        }),
        failureReason: null,
      };
    } catch {
      console.warn("Memory candidate write failed.", {
        reasonCode: "memory_write_failed",
        storageBackend: "memory",
      });
      return { candidates: [], failureReason: "memory_write_failed" };
    }
  }

  const prisma = getPrismaClient();

  if (!prisma) {
    console.warn("Memory candidate write failed.", {
      reasonCode: "memory_write_failed",
      storageBackend: "database",
    });
    return { candidates: [], failureReason: "memory_write_failed" };
  }

  try {
    const storedCandidates = await prisma.$transaction(async (transaction) => {
      const uniqueSourceMessageIds = [...new Set(sourceMessageIds)];
      const [conversation, decision, sourceMessages] = await Promise.all([
        transaction.conversation.findFirst({
          where: { id: conversationId, profileId },
          select: { id: true, profileId: true },
        }),
        transaction.conversationDecision.findFirst({
          where: { id: decisionId, conversationId },
          select: { id: true, conversationId: true },
        }),
        transaction.message.findMany({
          where: { id: { in: uniqueSourceMessageIds }, conversationId, role: "user" },
          select: { id: true, conversationId: true },
        }),
      ]);

      if (
        !conversation ||
        !decision ||
        uniqueSourceMessageIds.length === 0 ||
        sourceMessages.length !== uniqueSourceMessageIds.length
      ) {
        throw new Error("memory_candidate_relation_validation_failed");
      }

      const created: StoredMemoryCandidate[] = [];

      for (const candidate of candidates) {
        const stored = await transaction.memoryCandidate.create({
          data: {
            profileId: conversation.profileId,
            conversationId,
            decisionId,
            category: candidate.category,
            content: candidate.content,
            normalizedKey: candidate.normalizedKey,
            subject: candidate.subject,
            assertion: candidate.assertion,
            polarity: candidate.polarity,
            temporalScope: candidate.temporalScope,
            confidence: candidate.confidence,
            status: "candidate",
            extractionVersion: MEMORY_EXTRACTION_VERSION,
            evidence: {
              create: uniqueSourceMessageIds.map((sourceMessageId) => ({ sourceMessageId })),
            },
          },
        });

        created.push({
          id: stored.id,
          profileId: stored.profileId,
          conversationId: stored.conversationId,
          decisionId: stored.decisionId,
          category: stored.category as ExtractedMemoryCandidate["category"],
          content: stored.content,
          normalizedKey: stored.normalizedKey,
          subject: stored.subject as ExtractedMemoryCandidate["subject"],
          assertion: stored.assertion as ExtractedMemoryCandidate["assertion"],
          polarity: stored.polarity as ExtractedMemoryCandidate["polarity"],
          temporalScope:
            stored.temporalScope as ExtractedMemoryCandidate["temporalScope"],
          confidence: stored.confidence,
          status: "candidate",
          extractionVersion: stored.extractionVersion,
          sourceUtteranceIds: uniqueSourceMessageIds,
          createdAt: stored.createdAt,
        });
      }

      return created;
    });

    return { candidates: storedCandidates, failureReason: null };
  } catch {
    console.warn("Memory candidate write failed.", {
      reasonCode: "memory_write_failed",
      storageBackend: "database",
    });
    return { candidates: [], failureReason: "memory_write_failed" };
  }
}

export async function getTodayMetrics(
  profileId: string = DEMO_PROFILE_ID,
): Promise<MetricsSummary> {
  const prisma = getPrismaClient();

  if (!prisma) {
    if (profileId === DEMO_PROFILE_ID) return getDemoMetrics();
    throw new Error("Database storage is required for authenticated users.");
  }

  try {
    if (profileId === DEMO_PROFILE_ID) await ensureDemoProfile(prisma);

    const dateKey = getTokyoDateKey();
    const date = dateKeyToUtcDate(dateKey);
    const nextDate = addUtcDays(date, 1);
    const metric = await prisma.dailyMetric.findUnique({
      where: {
        profileId_date: {
          profileId,
          date,
        },
      },
    });
    const latestConversation = await prisma.conversation.findFirst({
      where: { profileId },
      orderBy: { startedAt: "desc" },
      select: {
        moodScoreEnd: true,
        moodScoreStart: true,
      },
    });
    const riskGroups = await prisma.riskEvent.groupBy({
      by: ["riskLevel"],
      where: {
        profileId,
        createdAt: {
          gte: date,
          lt: nextDate,
        },
      },
      _count: {
        _all: true,
      },
    });

    return {
      date: dateKey,
      conversationCount: metric?.conversationCount ?? 0,
      userMessageCount: metric?.userMessageCount ?? 0,
      assistantMessageCount: metric?.assistantMessageCount ?? 0,
      userCharCount: metric?.userCharCount ?? 0,
      estimatedMinutes: metric?.estimatedMinutes ?? 0,
      latestMoodScore:
        latestConversation?.moodScoreEnd ??
        latestConversation?.moodScoreStart ??
        null,
      riskWatchCount:
        riskGroups.find((group) => group.riskLevel === "watch")?._count._all ??
        0,
      riskUrgentCount:
        riskGroups.find((group) => group.riskLevel === "urgent")?._count._all ??
        0,
      storageMode: "database",
      aiMode: getAiMode(),
    };
  } catch {
    if (profileId !== DEMO_PROFILE_ID) throw new Error("Database metrics failed.");
    console.warn("Database metrics failed; using memory metrics.");
    return getDemoMetrics();
  }
}
