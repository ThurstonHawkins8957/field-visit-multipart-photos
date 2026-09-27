export type PhotoKind = "arrival" | "diagnostic" | "completion";

export type UploadDecision = {
  dispatchStatus: "awaiting_review";
  technicianFollowUp: "required" | "none";
};

export function decideCompletedUpload(photoKind: PhotoKind, expectedParts: number, receivedParts: number[]): UploadDecision {
  const unique = new Set(receivedParts);
  const completeSequence =
    unique.size === expectedParts &&
    receivedParts.length === expectedParts &&
    Array.from({ length: expectedParts }, (_, index) => index + 1).every((part) => unique.has(part));

  if (!completeSequence) throw new Error("Every expected part must be reported exactly once");

  return {
    dispatchStatus: "awaiting_review",
    technicianFollowUp: photoKind === "diagnostic" ? "required" : "none",
  };
}
