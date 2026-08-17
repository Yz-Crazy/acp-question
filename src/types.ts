export interface User {
  id: string;
  username: string;
  nickname: string;
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

export interface AdminQuestion {
  id: string;
  number: number | null;
  type: "single" | "multiple";
  question: string;
  options: Record<string, string>;
  correctAnswers: string[];
  explanation: string;
  category: string;
  core: boolean;
  referenceUrl: string | null;
  active: boolean;
  updatedAt: string | null;
}

export interface AdminUser {
  id: string;
  username: string;
  nickname: string;
  role: "admin" | "member";
  disabled: boolean;
  createdAt: string;
  attempts: number;
  practiced: number;
  accuracy: number;
  activeMistakes: number;
}

export interface MockExamTemplate {
  id: string;
  slot: number;
  title: string;
  questionCount: number;
  singleCount: number;
  multipleCount: number;
  updatedAt: string;
}

export interface MockExamSummary {
  id: string;
  title: string;
  source: "fixed" | "random";
  status: "in_progress" | "submitted";
  templateId: string | null;
  durationSeconds: number;
  remainingSeconds: number;
  score: number | null;
  passed: boolean | null;
  wrongCount: number | null;
  answeredCount: number;
  markedCount: number;
  startedAt: string;
  updatedAt: string;
  submittedAt: string | null;
}

export interface MockExamItem {
  id: string;
  position: number;
  type: "single" | "multiple";
  question: string;
  options: Record<string, string>;
  category: string;
  selectedAnswers: string[];
  marked: boolean;
  correctAnswers?: string[];
  correct?: boolean;
  explanation?: string;
  referenceUrl?: string | null;
}

export interface MockExamDetail extends MockExamSummary {
  currentItemId: string | null;
  currentSection: "single" | "multiple";
}

export interface RegistrationCode {
  code: string;
  maxUses: number;
  useCount: number;
  disabled: number;
  expiresAt: string;
  createdAt: string;
  createdBy: string;
}
