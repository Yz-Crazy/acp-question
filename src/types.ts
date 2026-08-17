export interface User {
  id: string;
  username: string;
  role: "admin" | "member";
}

export interface Stats {
  attempts: number;
  correct: number;
  practiced: number;
  weekly: number;
  accuracy: number;
  activeMistakes: number;
  dueMistakes: number;
  totalQuestions: number;
  streak: number;
}

export interface Category {
  category: string;
  count: number;
  core_count: number;
}

export interface Meta {
  categories: Category[];
  totals: { total: number; core: number; single: number; multiple: number };
}

export interface Question {
  id: string;
  number: number | null;
  type: "single" | "multiple";
  question: string;
  options: Record<string, string>;
  category: string;
  core: boolean;
  progress: {
    attempts: number;
    lastCorrect: boolean | null;
    marked: boolean;
    wrongCount: number;
    nextReviewAt: string | null;
  };
}

export interface AnswerResult {
  correct: boolean;
  correctAnswers: string[];
  explanation: string;
  referenceUrl: string | null;
  mistakeActive: boolean;
}
