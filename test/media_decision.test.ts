import assert from "node:assert/strict";
import test from "node:test";
import { decideCompletedUpload } from "../src/media_decision.js";

test("a complete diagnostic upload requests technician follow-up", () => {
  assert.deepEqual(decideCompletedUpload("diagnostic", 3, [3, 1, 2]), {
    dispatchStatus: "awaiting_review",
    technicianFollowUp: "required",
  });
});

test("completion is rejected when a part number is duplicated", () => {
  assert.throws(
    () => decideCompletedUpload("completion", 3, [1, 2, 2]),
    /Every expected part must be reported exactly once/,
  );
});
