import { describe, expect, it } from "vitest";
import { isAnswerCorrect, nextReviewDate, normalizeAnswers, normalizeQuestionType } from "./quiz";

describe("quiz helpers", () => {
  it("compares multi-select answers without depending on order", () => {
    expect(isAnswerCorrect(["C", "a"], ["A", "C"])).toBe(true);
    expect(isAnswerCorrect(["A"], ["A", "C"])).toBe(false);
  });

  it("normalizes duplicates and supported source labels", () => {
    expect(normalizeAnswers(["a", "A", " b "])).toEqual(["A", "B"]);
    expect(normalizeQuestionType("单选题")).toBe("single");
    expect(normalizeQuestionType("多选题")).toBe("multiple");
  });

  it("increases the spaced-review interval", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(nextReviewDate(0, now)).toBe("2026-01-02T00:00:00.000Z");
    expect(nextReviewDate(2, now)).toBe("2026-01-08T00:00:00.000Z");
  });
});
