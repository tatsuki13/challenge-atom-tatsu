export type RiskLevel = "none" | "watch" | "urgent";

export type EmotionLabel =
  | "lonely"
  | "sad"
  | "anxious"
  | "positive"
  | "reminiscence"
  | "neutral";

export type ChatRole = "user" | "assistant";

export type StorageMode = "memory" | "database";

export type AiMode = "mock" | "openai";

export type ListeningStrategy =
  | "acknowledge"
  | "reflect_content"
  | "reflect_emotion"
  | "show_interest"
  | "ask_open_question"
  | "ask_clarification"
  | "allow_silence"
  | "change_topic";

export type PlanSource = "local" | "openai" | "safety";

export type GenerationSource = "openai" | "mock" | "safety";

export type MessageInputType = "text" | "speech" | "topic_starter";

export type MemoryCategory =
  | "person"
  | "place"
  | "experience"
  | "preference"
  | "routine"
  | "wish";

export type MemorySubject = "user" | "other" | "unknown";

export type MemoryAssertion =
  | "affirmed"
  | "uncertain"
  | "hypothetical"
  | "quoted";

export type MemoryPolarity = "positive" | "negative" | "neutral";

export type MemoryTemporalScope =
  | "past"
  | "current"
  | "future"
  | "timeless"
  | "unknown";

export type ExtractedMemoryCandidate = {
  category: MemoryCategory;
  content: string;
  normalizedKey: string;
  subject: MemorySubject;
  assertion: MemoryAssertion;
  polarity: MemoryPolarity;
  temporalScope: MemoryTemporalScope;
  confidence: number;
};

export type MemoryCandidateStatus =
  | "candidate"
  | "confirmed"
  | "ignored"
  | "pending_merge";

export type MemoryStatus = "active" | "superseded" | "archived";

export type MemoryRetrievalMode =
  | "none"
  | "topic_match"
  | "category_browse"
  | "clarification";

export type MemoryRetrievalNoSearchReason =
  | "none"
  | "general_knowledge"
  | "greeting"
  | "current_turn_sufficient"
  | "memory_would_be_unnatural"
  | "no_concrete_topic";

export type MemoryRetrievalClarificationReason =
  | "none"
  | "category_and_topic_unknown"
  | "ambiguous_prior_reference";

export type MemoryRetrievalSource = "openai_plan" | "local_fallback" | "none";

export type MemoryRetrievalRequest = {
  mode: MemoryRetrievalMode;
  categories: MemoryCategory[];
  searchTerms: string[];
  polarities: MemoryPolarity[];
  temporalScopes: MemoryTemporalScope[];
  purpose: string;
  noSearchReason: MemoryRetrievalNoSearchReason;
  clarificationReason: MemoryRetrievalClarificationReason;
};

export type MemoryPromptContext = Pick<
  StoredMemory,
  "category" | "content" | "polarity" | "temporalScope"
>;

export type MemorySearchResult = {
  memory: Pick<
    StoredMemory,
    "id" | "category" | "content" | "polarity" | "temporalScope"
  >;
  score: number;
  reason: string;
  scoreBreakdown: MemoryRetrievalScoreBreakdown;
};

export type MemoryRetrievalScoreBreakdown = {
  categoryMatch: number;
  normalizedKeyExact: number;
  normalizedKeyPartial: number;
  contentPartial: number;
  bigramSimilarity: number;
  bigramScore: number;
  polarityMatch: number;
  polarityMismatch: number;
  temporalScopeMatch: number;
  temporalScopeMismatch: number;
  finalScore: number;
};

export type MemoryRetrievalDisposition =
  | "selected"
  | "category_mismatch"
  | "polarity_mismatch"
  | "temporal_scope_mismatch"
  | "no_text_match"
  | "below_threshold"
  | "result_limit"
  | "character_limit"
  | "generation_discarded";

export type MemorySearchCandidate = {
  memory: Pick<
    StoredMemory,
    "id" | "category" | "content" | "polarity" | "temporalScope"
  >;
  scoreBreakdown: MemoryRetrievalScoreBreakdown;
  disposition: MemoryRetrievalDisposition;
};

export type MemorySearchEvaluation = {
  activeMemoryCount: number;
  thresholdPassedCount: number;
  results: MemorySearchResult[];
  candidates: MemorySearchCandidate[];
  selectionRequired: boolean;
};

export type MemoryUsageRole =
  | "answer_context"
  | "candidate_presentation"
  | "clarification";

export type MemoryUsageInput = {
  memoryId: string;
  retrievalScore: number;
  usageReason: string;
  usageRole: MemoryUsageRole;
};

export type StoredMemoryUsage = MemoryUsageInput & {
  id: string;
  assistantMessageId: string;
  conversationId: string;
  decisionId: string;
  createdAt: Date;
};

export type MemoryRetrievalStatus =
  | "not_requested"
  | "retrieved"
  | "no_match"
  | "clarification"
  | "candidate_selection_required"
  | "failed"
  | "skipped_safety"
  | "skipped_no_openai";

export type MemoryRetrievalFailureReason =
  | "plan_unavailable"
  | "invalid_request"
  | "memory_read_failed"
  | "usage_write_failed";

export type ReplyRejectionReason =
  | "too_many_questions"
  | "missing_continuation_cue"
  | "missing_clarification"
  | "unsupported_memory_claim"
  | "mode_contract_violation"
  | "empty_response"
  | "generation_error";

export type MemoryRetrievalAuditInput = {
  profileId: string;
  executed: boolean;
  status: MemoryRetrievalStatus;
  requestSource: MemoryRetrievalSource;
  plannedMode: MemoryRetrievalMode;
  finalMode: MemoryRetrievalMode;
  noSearchReason: MemoryRetrievalNoSearchReason;
  clarificationReason: MemoryRetrievalClarificationReason;
  categories: MemoryCategory[];
  polarities: MemoryPolarity[];
  temporalScopes: MemoryTemporalScope[];
  activeMemoryCount: number;
  thresholdPassedCount: number;
  selectedCount: number;
  failureReason: MemoryRetrievalFailureReason | null;
  generationRejectionReason: ReplyRejectionReason | null;
  configVersion: string;
  minimumScore: number;
  maxResults: number;
  maxContextCharacters: number;
  attributeStrategy: "ignore" | "exclude" | "score";
  results: Array<{
    memoryId: string;
    scoreBreakdown: MemoryRetrievalScoreBreakdown;
    disposition: MemoryRetrievalDisposition;
  }>;
};

export type StoredMemoryRetrievalAudit = MemoryRetrievalAuditInput & {
  id: string;
  decisionId: string;
  createdAt: Date;
};

export type MemoryManagementIntent = "NONE" | "CORRECT" | "FORGET";

export type DetectedMemoryManagementRequest = {
  intent: MemoryManagementIntent;
  category: MemoryCategory | null;
  searchTerms: string[];
  correctedContent: string | null;
};

export type MemoryManagementActionType = "EDIT" | "ARCHIVE" | "RESTORE";
export type MemoryManagementActor = "user";
export type MemoryManagementReasonCode =
  | "user_edit"
  | "user_archive"
  | "user_restore"
  | "conversation_correction"
  | "conversation_forget";

export type StoredMemoryManagementAction = {
  id: string;
  requestKey: string;
  profileId: string;
  targetMemoryId: string;
  action: MemoryManagementActionType;
  resultMemoryId: string | null;
  actor: MemoryManagementActor;
  reasonCode: MemoryManagementReasonCode;
  createdAt: Date;
};

export type MemoryManagementInput = {
  profileId: string;
  requestKey: string;
  memoryId: string;
  action: MemoryManagementActionType;
  actor: MemoryManagementActor;
  reasonCode: MemoryManagementReasonCode;
  reviewedContent?: string;
};

export type MemoryManagementResult =
  | {
      ok: true;
      outcome: "applied" | "already_applied";
      action: StoredMemoryManagementAction;
      memory: StoredMemory;
      previousMemory: StoredMemory | null;
    }
  | {
      ok: false;
      reasonCode:
        | "invalid_input"
        | "memory_not_found"
        | "profile_mismatch"
        | "invalid_status"
        | "active_successor";
      message: string;
    };

export type PendingMemoryManagementRequestInput = {
  profileId: string;
  sourceMessageId: string;
  intent: Exclude<MemoryManagementIntent, "NONE">;
  category: MemoryCategory;
  searchTerms: string[];
  correctedContent: string | null;
  matches: Array<{ memoryId: string; score: number }>;
};

export type StoredMemoryManagementRequest = PendingMemoryManagementRequestInput & {
  id: string;
  conversationId: string;
  decisionId: string;
  status: "pending" | "approved" | "rejected";
  selectedMemoryId: string | null;
  managementActionId: string | null;
  createdAt: Date;
  processedAt: Date | null;
};

export type MemoryManagementRequestResolutionInput = {
  profileId: string;
  requestId: string;
  approve: boolean;
  selectedMemoryId?: string;
  reviewedContent?: string;
};

export type MemoryResolutionAction = "ADD" | "UPDATE" | "SUPERSEDE" | "IGNORE";

export type MemoryResolutionActor = "system" | "user";

export type MemoryResolutionReasonCode =
  | "new_memory"
  | "exact_duplicate"
  | "content_update"
  | "explicit_correction"
  | "explicit_replacement"
  | "user_rejected"
  | "invalid_candidate"
  | "already_resolved"
  | "target_not_found"
  | "profile_mismatch";

export type MemoryExtractionStatus =
  | "saved"
  | "awaiting_confirmation"
  | "confirmation_rejected"
  | "no_candidates"
  | "filtered"
  | "failed"
  | "skipped_safety"
  | "skipped_no_openai";

export type MemoryRejectionReasonCode =
  | "invalid_shape"
  | "invalid_category"
  | "invalid_content"
  | "invalid_normalized_key"
  | "invalid_subject"
  | "invalid_assertion"
  | "invalid_polarity"
  | "invalid_temporal_scope"
  | "invalid_confidence"
  | "too_many_candidates"
  | "unsupported_subject"
  | "unsupported_assertion"
  | "low_confidence"
  | "no_current_utterance_evidence"
  | "sensitive_content"
  | "category_mismatch"
  | "empty_meaning"
  | "openai_extraction_failed"
  | "memory_write_failed";

export type MemoryExtractionResult = {
  status: MemoryExtractionStatus;
  candidateCount: number;
  candidateIds: string[];
  categories: MemoryCategory[];
  rejectedCount: number;
  rejectionReasonCodes: MemoryRejectionReasonCode[];
};

export type MemoryCandidateInput = ExtractedMemoryCandidate & {
  sourceUtteranceIds: string[];
};

export type StoredMemoryCandidate = MemoryCandidateInput & {
  id: string;
  profileId: string;
  conversationId: string;
  decisionId: string;
  status: MemoryCandidateStatus;
  extractionVersion: string;
  createdAt: Date;
};

export type StoredMemory = {
  id: string;
  profileId: string;
  category: MemoryCategory;
  content: string;
  normalizedKey: string;
  polarity: MemoryPolarity;
  temporalScope: MemoryTemporalScope;
  status: MemoryStatus;
  supersedesId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredMemoryResolution = {
  id: string;
  candidateId: string;
  action: MemoryResolutionAction;
  targetMemoryId: string | null;
  resultMemoryId: string | null;
  reasonCode: MemoryResolutionReasonCode;
  actor: MemoryResolutionActor;
  reviewedContent: string | null;
  reviewedNormalizedKey: string | null;
  processedAt: Date;
};

export type MemoryResolutionInput = {
  profileId: string;
  candidateId: string;
  action: MemoryResolutionAction;
  targetMemoryId?: string | null;
  actor: MemoryResolutionActor;
  reasonCode: MemoryResolutionReasonCode;
  reviewedContent?: string;
};

export type MemoryResolutionResult =
  | {
      ok: true;
      outcome: "resolved" | "already_resolved";
      candidate: StoredMemoryCandidate;
      resolution: StoredMemoryResolution;
      memory: StoredMemory | null;
      previousMemory: StoredMemory | null;
    }
  | {
      ok: false;
      reasonCode:
        | "invalid_candidate"
        | "already_resolved"
        | "target_not_found"
        | "profile_mismatch";
      message: string;
    };

const listeningStrategies = new Set<ListeningStrategy>([
  "acknowledge",
  "reflect_content",
  "reflect_emotion",
  "show_interest",
  "ask_open_question",
  "ask_clarification",
  "allow_silence",
  "change_topic",
]);

const messageInputTypes = new Set<MessageInputType>([
  "text",
  "speech",
  "topic_starter",
]);

export function isMessageInputType(value: unknown): value is MessageInputType {
  return typeof value === "string" && messageInputTypes.has(value as MessageInputType);
}

export function isListeningStrategy(value: unknown): value is ListeningStrategy {
  return typeof value === "string" && listeningStrategies.has(value as ListeningStrategy);
}

export function dedupeSourceUtteranceIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

export type StoredChatMessage = {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  emotionLabel: EmotionLabel | null;
  emotionScores?: unknown;
  riskLevel: RiskLevel;
  rawContent: string | null;
  inputType: MessageInputType;
  clientMessageId: string | null;
  createdAt: Date;
};

export type ConversationSession = {
  conversationId: string;
  startedAt: Date;
  messages: StoredChatMessage[];
  storageBackend: StorageMode;
};

export type ConversationDecisionInput = {
  conversationId: string;
  responseMessageId?: string;
  listeningStrategy: ListeningStrategy | null;
  planSource: PlanSource;
  generationSource: GenerationSource;
  mode: string;
  mainFocus: string | null;
  shouldAskQuestion: boolean;
  sourceUtteranceIds: string[];
  memoryUsages?: MemoryUsageInput[];
  memoryRetrievalAudit: MemoryRetrievalAuditInput;
  memoryManagementRequest?: PendingMemoryManagementRequestInput;
};

export type StoredConversationDecision = Omit<
  ConversationDecisionInput,
  "memoryUsages" | "memoryManagementRequest" | "memoryRetrievalAudit"
> & {
  id: string;
  responseMessageId: string;
  createdAt: Date;
};

export type MetricsSummary = {
  date: string;
  conversationCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  userCharCount: number;
  estimatedMinutes: number;
  latestMoodScore: number | null;
  riskWatchCount: number;
  riskUrgentCount: number;
  storageMode: StorageMode;
  aiMode: AiMode;
};

export const DEMO_PROFILE_ID = "demo-profile";
export const RECENT_MESSAGE_LIMIT = 20;
