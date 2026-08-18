export type QuestionType = "single" | "multiple";

export interface MockExamCategoryQuota {
  category: string;
  single: number;
  multiple: number;
}

// Official mock-exam distribution rounded to exactly 75 questions.
export const MOCK_EXAM_CATEGORY_QUOTAS: readonly MockExamCategoryQuota[] = [
  { category: "大模型应用开发", single: 9, multiple: 4 },
  { category: "大模型提示词工程", single: 7, multiple: 4 },
  { category: "大模型检索增强", single: 10, multiple: 5 },
  { category: "大模型微调", single: 8, multiple: 4 },
  { category: "多Agent及多模态应用", single: 8, multiple: 4 },
  { category: "大模型应用生产实践", single: 8, multiple: 4 }
];

export function normalizeAnswers(answers: unknown): string[] {
  if (!Array.isArray(answers)) return [];
  return [...new Set(answers.filter((item): item is string => typeof item === "string").map((item) => item.trim().toUpperCase()))].sort();
}

export function isAnswerCorrect(submitted: unknown, expected: unknown): boolean {
  const left = normalizeAnswers(submitted);
  const right = normalizeAnswers(expected);
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function normalizeQuestionType(value: string): QuestionType | null {
  if (value === "single" || value === "单选题") return "single";
  if (value === "multiple" || value === "多选题") return "multiple";
  return null;
}

export function scoreMockExam(items: Array<{ type: QuestionType; submitted: unknown; expected: unknown }>) {
  let score = 0;
  let correctCount = 0;
  for (const item of items) {
    if (!isAnswerCorrect(item.submitted, item.expected)) continue;
    correctCount += 1;
    score += item.type === "single" ? 1 : 2;
  }
  return { score, correctCount, wrongCount: items.length - correctCount, passed: score >= 80 };
}

export function nextReviewDate(correctStreak: number, now = new Date()): string {
  const intervals = [1, 3, 7, 14, 30];
  const days = intervals[Math.min(Math.max(correctStreak, 0), intervals.length - 1)];
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}
