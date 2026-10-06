import assert from "node:assert/strict";
import test from "node:test";
import { emotionKeys, parseStateScores, parseEmotionState, resolveEmotionState, stateStatusLabel } from "../lib/emotionState.ts";
import { stateVectorDelta } from "../lib/stateVector.ts";

const empty = { loneliness: null, anxiety: null, positive_affect: null, interest: null };
const initial = resolveEmotionState({ ...empty, loneliness: 0.7, anxiety: 0 }, null, null, "openai", "test");

test("no initial evidence stays unestimated, never zero", () => {
  const state = resolveEmotionState(empty, null, null, "openai", "test");
  assert.deepEqual(parseStateScores(state), empty);
  for (const key of emotionKeys) assert.equal(state._analysis.axes[key].status, "unestimated");
});

test("equal estimates stay estimated; only missing evidence holds the previous axis", () => {
  const state = resolveEmotionState({ ...empty, loneliness: 0.7, interest: 0.83 }, initial, "message-1", "openai", "test");
  assert.equal(state._analysis.axes.loneliness.status, "estimated");
  assert.equal(state._analysis.axes.anxiety.status, "held");
  assert.equal(state.anxiety, 0);
  assert.equal(state._analysis.axes.anxiety.previousMessageId, "message-1");
  assert.equal(state._analysis.axes.positive_affect.status, "unestimated");
  assert.equal(state.interest, 0.83);
  assert.equal(stateVectorDelta(state, initial).loneliness, 0);
  assert.equal(stateVectorDelta(state, initial).interest, null);
});

test("repeated holds persist across JSON save and reload", () => {
  const firstHold = resolveEmotionState(empty, JSON.parse(JSON.stringify(initial)), "message-1", "openai", "test");
  const secondHold = resolveEmotionState(empty, JSON.parse(JSON.stringify(firstHold)), "message-2", "openai", "test");
  assert.equal(secondHold.loneliness, 0.7);
  assert.equal(secondHold._analysis.axes.loneliness.status, "held");
  assert.equal(secondHold._analysis.axes.loneliness.previousMessageId, "message-2");
  assert.deepEqual(parseEmotionState(JSON.parse(JSON.stringify(secondHold))), secondHold);
});

test("API failure and missing configuration are distinguished from insufficient evidence", () => {
  for (const [source, reason] of [["error", "api_error"], ["unavailable", "api_unavailable"]]) {
    const state = resolveEmotionState(null, initial, "message-1", source, "test");
    assert.equal(state.loneliness, initial.loneliness);
    assert.equal(state._analysis.axes.loneliness.reason, reason);
    assert.equal(state._analysis.axes.loneliness.status, "held");
    assert.doesNotMatch(stateStatusLabel(state, "loneliness"), /判断材料不足/);
  }
});

test("legacy values are displayed but cannot seed contextual inference", () => {
  const legacy = { loneliness: 0.65, anxiety: 0.45, positive_affect: 0, interest: 0 };
  assert.deepEqual(parseStateScores(legacy), legacy);
  assert.equal(parseEmotionState(legacy), null);
  assert.deepEqual(parseStateScores(resolveEmotionState(empty, legacy, "old-message", "openai", "test")), empty);
});

test("malformed values and inconsistent axis metadata are rejected", () => {
  for (const value of [undefined, [], {}, { ...empty, anxiety: -1 }, { ...empty, interest: 1.1 }, { ...empty, anxiety: NaN }, { ...empty, anxiety: "0.5" }]) assert.equal(parseStateScores(value), null);
  const corrupt = structuredClone(initial);
  corrupt._analysis.axes.loneliness.status = "unestimated";
  assert.equal(parseEmotionState(corrupt), null);
});
