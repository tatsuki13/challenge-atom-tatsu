import assert from "node:assert/strict";
import test from "node:test";
import { parseStateVector, stateVectorDelta } from "../lib/stateVector.ts";

test("missing and corrupt historical scores are not converted to neutral observations", () => {
  for (const value of [null, [], {}, { loneliness: 0, anxiety: 0, positive_affect: 0 }, { loneliness: 2, anxiety: 0, positive_affect: 0, interest: 0 }, { loneliness: NaN, anxiety: 0, positive_affect: 0, interest: 0 }]) {
    assert.equal(parseStateVector(value), null);
  }
  assert.deepEqual(parseStateVector({ loneliness: 0, anxiety: 0, positive_affect: 0, interest: 0 }), { loneliness: 0, anxiety: 0, positive_affect: 0, interest: 0 });
});

test("changes preserve decreases and refuse a comparison through missing data", () => {
  const previous = { loneliness: 0.65, anxiety: 0.45, positive_affect: 0, interest: 0.45 };
  const current = { loneliness: 0.45, anxiety: 0, positive_affect: 0.65, interest: 0.45 };
  const delta = stateVectorDelta(current, previous);
  assert.ok(Math.abs(delta.loneliness + 0.2) < 1e-10);
  assert.equal(delta.anxiety, -0.45);
  assert.equal(delta.positive_affect, 0.65);
  assert.equal(delta.interest, 0);
  assert.equal(stateVectorDelta(current, null), null);
  assert.equal(stateVectorDelta(null, previous), null);
});
