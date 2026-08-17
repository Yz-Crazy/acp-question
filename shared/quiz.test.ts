import { describe, expect, it } from "vitest";
import { isAnswerCorrect, nextReviewDate, normalizeAnswers, normalizeQuestionType, scoreMockExam } from "./quiz";

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

  it("scores mock exams with the 80 point passing line", () => {
    const singles = Array.from({ length: 50 }, () => ({ type: "single" as const, submitted: ["A"], expected: ["A"] }));
    const multiples = Array.from({ length: 25 }, () => ({ type: "multiple" as const, submitted: ["A", "B"], expected: ["A", "B"] }));
    expect(scoreMockExam([...singles, ...multiples])).toMatchObject({ score: 100, passed: true, wrongCount: 0 });
    expect(scoreMockExam([...singles, ...multiples.slice(0, 15), ...multiples.slice(15).map((item) => ({ ...item, submitted: [] }))])).toMatchObject({ score: 80, passed: true });
    expect(scoreMockExam([...singles.slice(0, 49), { ...singles[49], submitted: [] }, ...multiples.slice(0, 15), ...multiples.slice(15).map((item) => ({ ...item, submitted: [] }))])).toMatchObject({ score: 79, passed: false });
  });
});
