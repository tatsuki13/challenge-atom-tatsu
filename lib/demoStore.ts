import { getTokyoDateKey } from "./date";
import {
  DEMO_PROFILE_ID,
  RECENT_MESSAGE_LIMIT,
  type ChatRole,
  type ConversationSession,
  type ConversationDecisionInput,
  type EmotionLabel,
  type ExtractedMemoryCandidate,
  type MessageInputType,
  type MetricsSummary,
  type MemoryResolutionInput,
  type MemoryResolutionResult,
  type MemoryManagementInput,
  type MemoryManagementResult,
  type MemoryManagementRequestResolutionInput,
  type RiskLevel,
  type StoredConversationDecision,
  type StoredChatMessage,
  type StoredMemory,
  type StoredMemoryCandidate,
  type StoredMemoryResolution,
  type StoredMemoryUsage,
  type StoredMemoryManagementAction,
  type StoredMemoryManagementRequest,
  type StoredMemoryRetrievalAudit,
} from "./conversationTypes";
import {
  findExactDuplicate,
  getReviewedCandidate,
  normalizeReviewedMemoryContent,
  validateResolutionCombination,
} from "./memoryResolutionRules";
import { validateMemoryManagementInput } from "./memoryManagementRules";
import { validateMemoryRetrievalAudit } from "./memoryRetrievalAuditRules";

type DemoConversation = {
  id: string;
  profileId: string;
  title: string;
  moodScoreStart: number | null;
  moodScoreEnd: number | null;
  startedAt: Date;
  endedAt: Date | null;
  messages: StoredChatMessage[];
};

type DemoRiskEvent = {
  id: string;
  profileId: string;
  conversationId: string;
  riskLevel: RiskLevel;
  createdAt: Date;
};

type DemoState = {
  conversations: Map<string, DemoConversation>;
  riskEvents: DemoRiskEvent[];
  decisions: StoredConversationDecision[];
  memoryCandidates: StoredMemoryCandidate[];
  memories: StoredMemory[];
  memoryResolutions: StoredMemoryResolution[];
  memoryUsages: StoredMemoryUsage[];
  memoryManagementActions: StoredMemoryManagementAction[];
  memoryManagementRequests: StoredMemoryManagementRequest[];
  memoryRetrievalAudits: StoredMemoryRetrievalAudit[];
};

declare global {
  var __challengeAtomDemoStore: DemoState | undefined;
}

function getState() {
  if (!globalThis.__challengeAtomDemoStore) {
    globalThis.__challengeAtomDemoStore = {
      conversations: new Map(),
      riskEvents: [],
      decisions: [],
      memoryCandidates: [],
      memories: [],
      memoryResolutions: [],
      memoryUsages: [],
      memoryManagementActions: [],
      memoryManagementRequests: [],
      memoryRetrievalAudits: [],
    };
  }

  globalThis.__challengeAtomDemoStore.decisions ??= [];
  globalThis.__challengeAtomDemoStore.memoryCandidates ??= [];
  globalThis.__challengeAtomDemoStore.memories ??= [];
  globalThis.__challengeAtomDemoStore.memoryResolutions ??= [];
  globalThis.__challengeAtomDemoStore.memoryUsages ??= [];
  globalThis.__challengeAtomDemoStore.memoryManagementActions ??= [];
  globalThis.__challengeAtomDemoStore.memoryManagementRequests ??= [];
  globalThis.__challengeAtomDemoStore.memoryRetrievalAudits ??= [];

  return globalThis.__challengeAtomDemoStore;
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function ensureConversation({
  conversationId,
  message,
  moodScore,
}: {
  conversationId?: string;
  message: string;
  moodScore: number | null;
}) {
  const state = getState();
  const existing = conversationId
    ? state.conversations.get(conversationId)
    : undefined;

  if (
    existing &&
    existing.profileId === DEMO_PROFILE_ID &&
    existing.endedAt === null &&
    getTokyoDateKey(existing.startedAt) === getTokyoDateKey()
  ) {
    existing.moodScoreEnd = moodScore ?? existing.moodScoreEnd;
    return existing;
  }

  const id = createId("conv");
  const conversation: DemoConversation = {
    id,
    profileId: DEMO_PROFILE_ID,
    title: message.slice(0, 24) || "今日の会話",
    moodScoreStart: moodScore,
    moodScoreEnd: moodScore,
    startedAt: new Date(),
    endedAt: null,
    messages: [],
  };

  state.conversations.set(id, conversation);
  return conversation;
}

export function getDemoConversationSession(
  conversationId: string,
): ConversationSession | null {
  const conversation = getState().conversations.get(conversationId);
  if (
    !conversation ||
    conversation.profileId !== DEMO_PROFILE_ID ||
    conversation.endedAt !== null ||
    getTokyoDateKey(conversation.startedAt) !== getTokyoDateKey()
  ) {
    return null;
  }

  return {
    conversationId: conversation.id,
    startedAt: conversation.startedAt,
    messages: conversation.messages.slice(),
    storageBackend: "memory",
  };
}

export function endDemoConversation(conversationId: string) {
  const conversation = getState().conversations.get(conversationId);
  if (
    !conversation ||
    conversation.profileId !== DEMO_PROFILE_ID ||
    conversation.endedAt !== null
  ) {
    return false;
  }

  conversation.endedAt = new Date();
  return true;
}

function createMessage({
  conversationId,
  role,
  content,
  rawContent,
  inputType,
  clientMessageId,
  emotionLabel,
  riskLevel,
}: {
  conversationId: string;
  role: ChatRole;
  content: string;
  rawContent: string | null;
  inputType: MessageInputType;
  clientMessageId: string | null;
  emotionLabel: EmotionLabel | null;
  riskLevel: RiskLevel;
}): StoredChatMessage {
  return {
    id: createId("msg"),
    conversationId,
    role,
    content,
    rawContent,
    inputType,
    clientMessageId,
    emotionLabel,
    riskLevel,
    createdAt: new Date(),
  };
}

export function recordDemoUserMessage({
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
  conversationId?: string;
  message: string;
  rawContent: string | null;
  inputType: MessageInputType;
  clientMessageId: string | null;
  moodScore: number | null;
  emotionLabel: EmotionLabel;
  emotionScores?: unknown;
  riskLevel: RiskLevel;
}) {
  const state = getState();
  const conversation = ensureConversation({ conversationId, message, moodScore });
  const storedMessage = createMessage({
    conversationId: conversation.id,
    role: "user",
    content: message,
    rawContent,
    inputType,
    clientMessageId,
    emotionLabel,
    riskLevel,
  });

  storedMessage.emotionScores = emotionScores;
  conversation.messages.push(storedMessage);

  if (riskLevel !== "none") {
    state.riskEvents.push({
      id: createId("risk"),
      profileId: DEMO_PROFILE_ID,
      conversationId: conversation.id,
      riskLevel,
      createdAt: new Date(),
    });
  }

  return {
    conversationId: conversation.id,
    userMessage: storedMessage,
    recentMessages: conversation.messages.slice(-RECENT_MESSAGE_LIMIT),
    storageBackend: "memory" as const,
  };
}

export function recordDemoAssistantTurn({
  conversationId,
  reply,
  emotionLabel,
  riskLevel,
  decision,
}: {
  conversationId: string;
  reply: string;
  emotionLabel: EmotionLabel;
  riskLevel: RiskLevel;
  decision: ConversationDecisionInput;
}) {
  const state = getState();
  if (decision.conversationId !== conversationId) {
    throw new Error("Decision and assistant message must belong to the same conversation.");
  }

  const conversation = ensureConversation({
    conversationId,
    message: "今日の会話",
    moodScore: null,
  });
  const sourceUtteranceIds = [...new Set(decision.sourceUtteranceIds)];
  const memoryUsages = decision.memoryUsages ?? [];
  const retrievalAudit = decision.memoryRetrievalAudit;
  const managementRequest = decision.memoryManagementRequest;
  const memoryIds = memoryUsages.map((usage) => usage.memoryId);
  const managementMemoryIds = managementRequest?.matches.map((match) => match.memoryId) ?? [];
  const auditMemoryIds = retrievalAudit.results.map((result) => result.memoryId);

  if (sourceUtteranceIds.length === 0) {
    throw new Error("At least one source utterance is required.");
  }
  const validSources = conversation.messages.filter(
    (message) => sourceUtteranceIds.includes(message.id) && message.role === "user",
  );

  if (validSources.length !== sourceUtteranceIds.length) {
    throw new Error("Decision sources must be existing user messages in the same conversation.");
  }
  if (new Set(memoryIds).size !== memoryIds.length) {
    throw new Error("A memory can be used only once per assistant response.");
  }
  if (new Set(managementMemoryIds).size !== managementMemoryIds.length) {
    throw new Error("Memory management matches must be unique.");
  }
  const invalidAudit = validateMemoryRetrievalAudit(retrievalAudit, memoryUsages);
  if (invalidAudit || retrievalAudit.profileId !== conversation.profileId) {
    throw new Error(invalidAudit ?? "Memory retrieval audit profile mismatch.");
  }
  const validMemories = state.memories.filter(
    (memory) =>
      memoryIds.includes(memory.id) &&
      memory.profileId === conversation.profileId &&
      memory.status === "active",
  );
  if (validMemories.length !== memoryIds.length) {
    throw new Error("Memory usages must reference active memories in the same profile.");
  }
  if (
    managementRequest &&
    (managementRequest.profileId !== conversation.profileId ||
      managementRequest.sourceMessageId !== sourceUtteranceIds.at(-1))
  ) {
    throw new Error("Memory management request ownership is invalid.");
  }
  const validManagementMemories = state.memories.filter(
    (memory) =>
      managementMemoryIds.includes(memory.id) &&
      memory.profileId === conversation.profileId &&
      memory.status === "active",
  );
  if (validManagementMemories.length !== managementMemoryIds.length) {
    throw new Error("Memory management matches must be active and in the same profile.");
  }
  const validAuditMemories = state.memories.filter(
    (memory) => auditMemoryIds.includes(memory.id) && memory.profileId === conversation.profileId,
  );
  if (validAuditMemories.length !== auditMemoryIds.length) {
    throw new Error("Memory retrieval audit results must belong to the same profile.");
  }
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

  const storedMessage = createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: reply,
    rawContent: reply,
    inputType: "text",
    clientMessageId: null,
    emotionLabel,
    riskLevel,
  });
  const storedDecision: StoredConversationDecision = {
    id: createId("decision"),
    conversationId: conversation.id,
    responseMessageId: storedMessage.id,
    listeningStrategy: decision.listeningStrategy,
    planSource: decision.planSource,
    generationSource: decision.generationSource,
    mode: decision.mode,
    mainFocus: decision.mainFocus,
    shouldAskQuestion: decision.shouldAskQuestion,
    sourceUtteranceIds,
    createdAt: new Date(),
  };

  conversation.messages.push(storedMessage);
  state.decisions.push(storedDecision);
  state.memoryUsages.push(
    ...memoryUsages.map((usage) => ({
      ...usage,
      id: createId("memory_usage"),
      assistantMessageId: storedMessage.id,
      conversationId: conversation.id,
      decisionId: storedDecision.id,
      createdAt: new Date(),
    })),
  );
  state.memoryRetrievalAudits.push({
    ...retrievalAudit,
    id: createId("memory_retrieval_audit"),
    decisionId: storedDecision.id,
    createdAt: new Date(),
  });
  if (managementRequest) {
    state.memoryManagementRequests.push({
      ...managementRequest,
      id: createId("memory_management_request"),
      conversationId: conversation.id,
      decisionId: storedDecision.id,
      status: "pending",
      selectedMemoryId: null,
      managementActionId: null,
      createdAt: new Date(),
      processedAt: null,
    });
  }
  return { assistantMessage: storedMessage, decision: storedDecision };
}

export function recordDemoMemoryCandidates({
  conversationId,
  decisionId,
  sourceMessageIds,
  candidates,
  extractionVersion,
}: {
  conversationId: string;
  decisionId: string;
  sourceMessageIds: string[];
  candidates: ExtractedMemoryCandidate[];
  extractionVersion: string;
}) {
  const state = getState();
  const conversation = state.conversations.get(conversationId);
  const decision = state.decisions.find(
    (item) => item.id === decisionId && item.conversationId === conversationId,
  );
  const sourceMessages = conversation?.messages.filter(
    (message) => sourceMessageIds.includes(message.id) && message.role === "user",
  );

  if (!conversation || conversation.profileId !== DEMO_PROFILE_ID) {
    throw new Error("Memory candidate conversation is invalid.");
  }

  if (!decision) {
    throw new Error("Memory candidate decision is invalid.");
  }

  if (!sourceMessages || sourceMessages.length !== new Set(sourceMessageIds).size) {
    throw new Error("Memory candidate sources must be user messages in the conversation.");
  }

  const storedCandidates: StoredMemoryCandidate[] = candidates.map((candidate) => ({
    ...candidate,
    id: createId("memory_candidate"),
    profileId: DEMO_PROFILE_ID,
    conversationId,
    decisionId,
    status: "candidate",
    extractionVersion,
    sourceUtteranceIds: [...new Set(sourceMessageIds)],
    createdAt: new Date(),
  }));

  state.memoryCandidates.push(...storedCandidates);
  return storedCandidates;
}

export function listDemoMemoryCandidates(profileId: string) {
  return getState().memoryCandidates.filter(
    (candidate) => candidate.profileId === profileId && candidate.status === "candidate",
  );
}

export function listDemoMemories(profileId: string) {
  return getState().memories.filter(
    (memory) => memory.profileId === profileId && memory.status === "active",
  );
}

export function listDemoAllMemories(profileId: string) {
  return getState().memories.filter((memory) => memory.profileId === profileId);
}

export function listDemoMemoryUsages(conversationId: string) {
  return getState().memoryUsages.filter(
    (usage) => usage.conversationId === conversationId,
  );
}

export function listDemoMemoryUsagesForProfile(profileId: string) {
  const state = getState();
  const conversationIds = new Set(
    [...state.conversations.values()]
      .filter((conversation) => conversation.profileId === profileId)
      .map((conversation) => conversation.id),
  );
  return state.memoryUsages.filter((usage) => conversationIds.has(usage.conversationId));
}

export function listDemoMemoryRetrievalAudits(profileId: string) {
  return getState().memoryRetrievalAudits.filter((audit) => audit.profileId === profileId);
}

export function getDemoMessageById(messageId: string) {
  for (const conversation of getState().conversations.values()) {
    const message = conversation.messages.find((item) => item.id === messageId);
    if (message) return message;
  }
  return null;
}

export function listDemoMemoryManagementActions(profileId: string) {
  return getState().memoryManagementActions.filter((action) => action.profileId === profileId);
}

export function listDemoMemoryManagementRequests(profileId: string) {
  return getState().memoryManagementRequests.filter(
    (request) => request.profileId === profileId,
  );
}

function hasActiveDemoSuccessor(memoryId: string, profileId: string) {
  const memories = getState().memories.filter((memory) => memory.profileId === profileId);
  const children = new Map<string, StoredMemory[]>();
  for (const memory of memories) {
    if (!memory.supersedesId) continue;
    const group = children.get(memory.supersedesId) ?? [];
    group.push(memory);
    children.set(memory.supersedesId, group);
  }
  const pending = [...(children.get(memoryId) ?? [])];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const memory = pending.pop()!;
    if (visited.has(memory.id)) continue;
    visited.add(memory.id);
    if (memory.status === "active") return true;
    pending.push(...(children.get(memory.id) ?? []));
  }
  return false;
}

export function manageDemoMemory(input: MemoryManagementInput): MemoryManagementResult {
  const state = getState();
  const existing = state.memoryManagementActions.find(
    (action) => action.requestKey === input.requestKey,
  );
  if (existing) {
    const memory = state.memories.find(
      (item) => item.id === (existing.resultMemoryId ?? existing.targetMemoryId),
    );
    if (!memory || existing.targetMemoryId !== input.memoryId || existing.action !== input.action) {
      return { ok: false, reasonCode: "invalid_input", message: "Request key is already in use." };
    }
    return {
      ok: true,
      outcome: "already_applied",
      action: existing,
      memory,
      previousMemory:
        existing.resultMemoryId
          ? state.memories.find((item) => item.id === existing.targetMemoryId) ?? null
          : null,
    };
  }
  const invalid = validateMemoryManagementInput(input);
  if (invalid) return { ok: false, reasonCode: "invalid_input", message: invalid };
  const target = state.memories.find((memory) => memory.id === input.memoryId);
  if (!target) return { ok: false, reasonCode: "memory_not_found", message: "Memory was not found." };
  if (target.profileId !== input.profileId) {
    return { ok: false, reasonCode: "profile_mismatch", message: "Memory profile mismatch." };
  }
  if ((input.action === "EDIT" || input.action === "ARCHIVE") && target.status !== "active") {
    return { ok: false, reasonCode: "invalid_status", message: "Only an active memory can be changed." };
  }
  if (input.action === "RESTORE" && target.status !== "archived") {
    return { ok: false, reasonCode: "invalid_status", message: "Only an archived memory can be restored." };
  }
  if (input.action === "RESTORE" && hasActiveDemoSuccessor(target.id, input.profileId)) {
    return { ok: false, reasonCode: "active_successor", message: "A newer active memory exists." };
  }

  const now = new Date();
  let resultMemory: StoredMemory = target;
  let previousMemory: StoredMemory | null = null;
  if (input.action === "EDIT") {
    const reviewed = normalizeReviewedMemoryContent(input.reviewedContent);
    if (!reviewed.ok) {
      return { ok: false, reasonCode: "invalid_input", message: reviewed.message };
    }
    previousMemory = { ...target, status: "superseded", updatedAt: now };
    resultMemory = {
      ...target,
      id: createId("memory"),
      content: reviewed.content,
      normalizedKey: reviewed.normalizedKey,
      status: "active",
      supersedesId: target.id,
      createdAt: now,
      updatedAt: now,
    };
    state.memories = state.memories.map((memory) =>
      memory.id === target.id ? previousMemory! : memory,
    );
    state.memories.push(resultMemory);
  } else {
    resultMemory = {
      ...target,
      status: input.action === "ARCHIVE" ? "archived" : "active",
      updatedAt: now,
    };
    state.memories = state.memories.map((memory) =>
      memory.id === target.id ? resultMemory : memory,
    );
  }
  const action: StoredMemoryManagementAction = {
    id: createId("memory_management_action"),
    requestKey: input.requestKey,
    profileId: input.profileId,
    targetMemoryId: target.id,
    action: input.action,
    resultMemoryId: input.action === "EDIT" ? resultMemory.id : null,
    actor: input.actor,
    reasonCode: input.reasonCode,
    createdAt: now,
  };
  state.memoryManagementActions.push(action);
  return { ok: true, outcome: "applied", action, memory: resultMemory, previousMemory };
}

export function resolveDemoMemoryManagementRequest(
  input: MemoryManagementRequestResolutionInput,
) {
  const state = getState();
  const request = state.memoryManagementRequests.find((item) => item.id === input.requestId);
  if (!request) return { ok: false as const, reasonCode: "request_not_found", message: "Request was not found." };
  if (request.profileId !== input.profileId) {
    return { ok: false as const, reasonCode: "profile_mismatch", message: "Request profile mismatch." };
  }
  if (request.status !== "pending") {
    return { ok: true as const, outcome: "already_processed" as const, request };
  }
  if (!input.approve && (input.selectedMemoryId || input.reviewedContent !== undefined)) {
    return { ok: false as const, reasonCode: "invalid_input", message: "A rejected request must not include changes." };
  }
  if (!input.approve) {
    const updated = { ...request, status: "rejected" as const, processedAt: new Date() };
    state.memoryManagementRequests = state.memoryManagementRequests.map((item) =>
      item.id === request.id ? updated : item,
    );
    return { ok: true as const, outcome: "processed" as const, request: updated };
  }
  if (!input.selectedMemoryId || !request.matches.some((match) => match.memoryId === input.selectedMemoryId)) {
    return { ok: false as const, reasonCode: "invalid_target", message: "Select one of the matched memories." };
  }
  if (request.intent === "FORGET" && input.reviewedContent !== undefined) {
    return { ok: false as const, reasonCode: "invalid_input", message: "A forget request must not include edited content." };
  }
  const action = request.intent === "CORRECT" ? "EDIT" : "ARCHIVE";
  const managed = manageDemoMemory({
    profileId: input.profileId,
    requestKey: `management-request:${request.id}`,
    memoryId: input.selectedMemoryId,
    action,
    actor: "user",
    reasonCode: request.intent === "CORRECT" ? "conversation_correction" : "conversation_forget",
    ...(action === "EDIT"
      ? { reviewedContent: input.reviewedContent ?? request.correctedContent ?? undefined }
      : {}),
  });
  if (!managed.ok) return managed;
  const updated = {
    ...request,
    status: "approved" as const,
    selectedMemoryId: input.selectedMemoryId,
    managementActionId: managed.action.id,
    processedAt: new Date(),
  };
  state.memoryManagementRequests = state.memoryManagementRequests.map((item) =>
    item.id === request.id ? updated : item,
  );
  return { ok: true as const, outcome: "processed" as const, request: updated, management: managed };
}

export function getDemoEvidenceMessages(sourceUtteranceIds: string[]) {
  const ids = new Set(sourceUtteranceIds);
  return [...getState().conversations.values()]
    .flatMap((conversation) => conversation.messages)
    .filter((message) => ids.has(message.id));
}

export function getDemoMemoryProvenance(memoryId: string) {
  const state = getState();
  const resolution = state.memoryResolutions.find(
    (item) => item.resultMemoryId === memoryId,
  );
  const candidate = resolution
    ? state.memoryCandidates.find((item) => item.id === resolution.candidateId) ?? null
    : null;
  return {
    candidate,
    resolution: resolution ?? null,
    evidence: candidate ? getDemoEvidenceMessages(candidate.sourceUtteranceIds) : [],
  };
}

export function resolveDemoMemoryCandidate(
  input: MemoryResolutionInput,
): MemoryResolutionResult {
  const state = getState();
  const candidate = state.memoryCandidates.find((item) => item.id === input.candidateId);

  if (!candidate) {
    return { ok: false, reasonCode: "invalid_candidate", message: "Candidate was not found." };
  }

  if (candidate.profileId !== input.profileId) {
    return { ok: false, reasonCode: "profile_mismatch", message: "Candidate profile mismatch." };
  }

  const existingResolution = state.memoryResolutions.find(
    (resolution) => resolution.candidateId === candidate.id,
  );
  if (existingResolution) {
    return {
      ok: true,
      outcome: "already_resolved",
      candidate,
      resolution: existingResolution,
      memory:
        state.memories.find((memory) => memory.id === existingResolution.resultMemoryId) ?? null,
      previousMemory:
        state.memories.find((memory) => memory.id === existingResolution.targetMemoryId) ?? null,
    };
  }

  if (candidate.status !== "candidate") {
    return { ok: false, reasonCode: "already_resolved", message: "Candidate is already processed." };
  }

  const invalidCombination = validateResolutionCombination(input);
  if (invalidCombination) {
    return { ok: false, reasonCode: "invalid_candidate", message: invalidCombination };
  }

  const reviewed = getReviewedCandidate(candidate, input.reviewedContent);
  if (!reviewed.ok) {
    return { ok: false, reasonCode: "invalid_candidate", message: reviewed.message };
  }
  const resolutionCandidate = reviewed.candidate;

  const activeMemories = state.memories.filter(
    (memory) => memory.profileId === input.profileId && memory.status === "active",
  );
  const exactDuplicate = findExactDuplicate(resolutionCandidate, activeMemories);
  const shouldIgnoreDuplicate =
    Boolean(exactDuplicate) &&
    (input.action === "ADD" ||
      (input.action === "IGNORE" && input.reasonCode === "exact_duplicate"));

  if (input.reasonCode === "exact_duplicate" && !exactDuplicate) {
    return {
      ok: false,
      reasonCode: "target_not_found",
      message: "No active exact duplicate exists.",
    };
  }

  let targetMemory: StoredMemory | null = null;
  if (input.action === "UPDATE" || input.action === "SUPERSEDE") {
    targetMemory =
      activeMemories.find((memory) => memory.id === input.targetMemoryId) ?? null;
    if (!targetMemory) {
      const crossProfileTarget = state.memories.some(
        (memory) => memory.id === input.targetMemoryId && memory.profileId !== input.profileId,
      );
      return {
        ok: false,
        reasonCode: crossProfileTarget ? "profile_mismatch" : "target_not_found",
        message: crossProfileTarget
          ? "Target memory profile mismatch."
          : "Active target memory was not found.",
      };
    }
  }

  const now = new Date();
  const effectiveAction = shouldIgnoreDuplicate ? "IGNORE" : input.action;
  const effectiveReason = shouldIgnoreDuplicate ? "exact_duplicate" : input.reasonCode;
  const effectiveActor = shouldIgnoreDuplicate ? "system" : input.actor;
  const effectiveTarget = shouldIgnoreDuplicate ? exactDuplicate : targetMemory;
  let resultMemory: StoredMemory | null = null;
  let nextMemories = state.memories.slice();

  if (effectiveAction !== "IGNORE") {
    if (effectiveTarget) {
      nextMemories = nextMemories.map((memory) =>
        memory.id === effectiveTarget.id
          ? { ...memory, status: "superseded", updatedAt: now }
          : memory,
      );
      targetMemory = { ...effectiveTarget, status: "superseded", updatedAt: now };
    }

    resultMemory = {
      id: createId("memory"),
      profileId: resolutionCandidate.profileId,
      category: resolutionCandidate.category,
      content: resolutionCandidate.content,
      normalizedKey: resolutionCandidate.normalizedKey,
      polarity: resolutionCandidate.polarity,
      temporalScope: resolutionCandidate.temporalScope,
      status: "active",
      supersedesId: effectiveTarget?.id ?? null,
      createdAt: now,
      updatedAt: now,
    };
    nextMemories.push(resultMemory);
  }

  const resolution: StoredMemoryResolution = {
    id: createId("memory_resolution"),
    candidateId: candidate.id,
    action: effectiveAction,
    targetMemoryId: effectiveTarget?.id ?? null,
    resultMemoryId: resultMemory?.id ?? null,
    reasonCode: effectiveReason,
    actor: effectiveActor,
    reviewedContent: reviewed.reviewedContent,
    reviewedNormalizedKey: resolutionCandidate.normalizedKey,
    processedAt: now,
  };
  const resolvedCandidate: StoredMemoryCandidate = {
    ...candidate,
    status: effectiveAction === "IGNORE" ? "ignored" : "confirmed",
  };

  state.memories = nextMemories;
  state.memoryResolutions = [...state.memoryResolutions, resolution];
  state.memoryCandidates = state.memoryCandidates.map((item) =>
    item.id === candidate.id ? resolvedCandidate : item,
  );

  return {
    ok: true,
    outcome: "resolved",
    candidate: resolvedCandidate,
    resolution,
    memory: resultMemory,
    previousMemory: effectiveTarget
      ? targetMemory ?? effectiveTarget
      : null,
  };
}

export function getDemoMetrics(): MetricsSummary {
  const state = getState();
  const today = getTokyoDateKey();
  const conversations = [...state.conversations.values()].filter(
    (conversation) => getTokyoDateKey(conversation.startedAt) === today,
  );
  const messages = conversations.flatMap((conversation) => conversation.messages);
  const latestConversation = conversations
    .slice()
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  const riskEvents = state.riskEvents.filter(
    (event) => getTokyoDateKey(event.createdAt) === today,
  );
  const userMessages = messages.filter((message) => message.role === "user");
  const assistantMessages = messages.filter(
    (message) => message.role === "assistant",
  );

  return {
    date: today,
    conversationCount: conversations.length,
    userMessageCount: userMessages.length,
    assistantMessageCount: assistantMessages.length,
    userCharCount: userMessages.reduce(
      (total, message) => total + message.content.length,
      0,
    ),
    estimatedMinutes: Math.max(
      0,
      Math.ceil((userMessages.length + assistantMessages.length) * 0.75),
    ),
    latestMoodScore:
      latestConversation?.moodScoreEnd ?? latestConversation?.moodScoreStart ?? null,
    riskWatchCount: riskEvents.filter((event) => event.riskLevel === "watch")
      .length,
    riskUrgentCount: riskEvents.filter((event) => event.riskLevel === "urgent")
      .length,
    storageMode: "memory",
    aiMode:
      process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_MODEL?.trim()
        ? "openai"
        : "mock",
  };
}
