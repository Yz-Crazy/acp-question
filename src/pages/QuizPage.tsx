import { ArrowLeft, ArrowRight, BookmarkMinus, BookmarkPlus, Check, CheckCircle2, ExternalLink, ListChecks, RotateCcw, Send, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ErrorState, LoadingState } from "../components/States";
import type { AnswerResult, Question } from "../types";

interface QuestionsResponse {
  questions: Question[];
  total: number;
  practiced: number;
  resumeQuestionId: string | null;
}

const QUESTION_PAGE_SIZE = 100;

function scopeTitle(scope: string | null) {
  if (scope === "core") return "核心题库";
  if (scope === "wrong") return "错题复习";
  return "题库练习";
}

function QuestionStem({ value }: { value: string }) {
  const [lead, ...rest] = value.split("\n");
  if (rest.length < 2) return <h1>{value}</h1>;
  return <div className="question-stem"><h1>{lead}</h1><pre>{rest.join("\n")}</pre></div>;
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function resumeIndex(questions: Question[], resumeQuestionId: string | null, explicitStart: string | null): number {
  const explicitIndex = explicitStart ? questions.findIndex((item) => item.id === explicitStart) : -1;
  if (explicitIndex >= 0) return explicitIndex;
  const cursorIndex = resumeQuestionId ? questions.findIndex((item) => item.id === resumeQuestionId) : -1;
  if (cursorIndex >= 0 && questions[cursorIndex].progress.attempts === 0) return cursorIndex;
  if (cursorIndex >= 0) {
    for (let step = 1; step <= questions.length; step += 1) {
      const candidate = (cursorIndex + step) % questions.length;
      if (questions[candidate].progress.attempts === 0) return candidate;
    }
    return cursorIndex;
  }
  const firstUnanswered = questions.findIndex((item) => item.progress.attempts === 0);
  return firstUnanswered >= 0 ? firstUnanswered : 0;
}

export function QuizPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [marking, setMarking] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const query = params.toString();
  const title = scopeTitle(params.get("scope"));
  const mode = params.get("scope") ?? "all";

  const load = useCallback(async () => {
    setLoading(true); setError(""); setComplete(false); setNavigatorOpen(false); setSelected([]); setResult(null); setScore(0); setAnswered(0);
    try {
      const requestParams = new URLSearchParams(query);
      requestParams.delete("start");
      requestParams.set("catalog", "1");
      requestParams.set("limit", String(QUESTION_PAGE_SIZE));
      requestParams.set("offset", "0");
      const firstPage = await api<QuestionsResponse>(`/api/questions?${requestParams.toString()}`);
      const offsets = Array.from(
        { length: Math.max(Math.ceil(firstPage.total / QUESTION_PAGE_SIZE) - 1, 0) },
        (_, page) => (page + 1) * QUESTION_PAGE_SIZE
      );
      const remainingPages = await Promise.all(offsets.map((offset) => {
        const pageParams = new URLSearchParams(requestParams);
        pageParams.set("offset", String(offset));
        return api<QuestionsResponse>(`/api/questions?${pageParams.toString()}`);
      }));
      const catalog = [firstPage, ...remainingPages].flatMap((page) => page.questions);
      const loadedQuestions = requestParams.get("review") === "random" ? shuffled(catalog) : catalog;
      setQuestions(loadedQuestions);
      const unansweredIds = new Set(loadedQuestions.filter((item) => item.progress.attempts === 0).map((item) => item.id));
      setPendingIds(mode === "wrong" || unansweredIds.size === 0 ? new Set(loadedQuestions.map((item) => item.id)) : unansweredIds);
      setIndex(resumeIndex(loadedQuestions, firstPage.resumeQuestionId, new URLSearchParams(query).get("start")));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "题目加载失败"); }
    finally { setLoading(false); }
  }, [mode, query]);
  useEffect(() => { void load(); }, [load]);

  const question = questions[index];
  const questionId = question?.id;
  const practicedCount = useMemo(() => questions.filter((item) => item.progress.attempts > 0).length, [questions]);
  const progress = questions.length ? (practicedCount / questions.length) * 100 : 0;

  useEffect(() => {
    if (loading || !questionId) return;
    const timer = window.setTimeout(() => {
      void api("/api/practice/cursor", {
        method: "PATCH",
        body: JSON.stringify({ query, questionId })
      }).catch(() => undefined);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [loading, query, questionId]);

  function choose(key: string) {
    if (!question || result) return;
    if (question.type === "single") setSelected([key]);
    else setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  async function submit() {
    if (!question || !selected.length || submitting) return;
    setSubmitting(true); setError("");
    try {
      const response = await api<AnswerResult>(`/api/questions/${encodeURIComponent(question.id)}/answer`, {
        method: "POST",
        body: JSON.stringify({ answers: selected, mode })
      });
      setResult(response);
      setAnswered((value) => value + 1);
      if (response.correct) setScore((value) => value + 1);
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(question.id);
        return next;
      });
      setQuestions((current) => current.map((item, itemIndex) => itemIndex === index ? {
        ...item,
        progress: {
          ...item.progress,
          attempts: item.progress.attempts + 1,
          lastCorrect: response.correct,
          marked: response.mistakeActive,
          wrongCount: item.progress.wrongCount + (response.correct ? 0 : 1)
        }
      } : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "提交失败"); }
    finally { setSubmitting(false); }
  }

  function goToQuestion(targetIndex: number) {
    setIndex(targetIndex); setSelected([]); setResult(null); setError(""); setNavigatorOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function previousQuestion() {
    if (index > 0) goToQuestion(index - 1);
  }

  function nextQuestion() {
    if (index < questions.length - 1) goToQuestion(index + 1);
  }

  function next() {
    for (let step = 1; step <= questions.length; step += 1) {
      const candidate = (index + step) % questions.length;
      if (pendingIds.has(questions[candidate].id)) { goToQuestion(candidate); return; }
    }
    setComplete(true);
  }

  async function toggleMark() {
    if (!question || marking) return;
    const marked = question.progress.marked;
    setMarking(true);
    try {
      const response = await api<{ marked: boolean }>(`/api/questions/${encodeURIComponent(question.id)}/mark`, {
        method: "POST", body: JSON.stringify({ action: marked ? "remove" : "add" })
      });
      setQuestions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, progress: { ...item.progress, marked: response.marked } } : item));
      if (result) setResult({ ...result, mistakeActive: response.marked });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "标记失败"); }
    finally { setMarking(false); }
  }

  const optionEntries = useMemo(() => question ? Object.entries(question.options) : [], [question]);
  useEffect(() => {
    if (!navigatorOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setNavigatorOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [navigatorOpen]);

  if (loading) return <div className="quiz-shell"><LoadingState label="正在准备本次练习" /></div>;
  if (error && !question) return <div className="quiz-shell"><ErrorState message={error} retry={() => void load()} /></div>;
  if (!questions.length) return (
    <div className="quiz-shell centered-shell"><div className="empty-state"><CheckCircle2 size={38} /><h1>这里暂时没有题目</h1><p>{params.get("scope") === "wrong" ? "当前模式下没有待复习错题，可以换一种复习方式。" : "请调整题库范围或筛选条件后再试。"}</p><button className="button primary" type="button" onClick={() => navigate(params.get("scope") === "wrong" ? "/wrong" : "/library")}><ArrowLeft size={17} />返回调整</button></div></div>
  );
  if (complete) {
    const accuracy = answered ? Math.round((score / answered) * 100) : 0;
    return <div className="quiz-shell centered-shell"><section className="completion-panel"><span className="completion-icon"><Check size={31} /></span><p className="eyebrow">本次练习完成</p><h1>{accuracy >= 80 ? "掌握得不错" : "再巩固一轮"}</h1><p>本次答对 {score} 道，共作答 {answered} 道。</p><div className="completion-stats"><div><strong>{accuracy}%</strong><small>正确率</small></div><div><strong>{questions.length}</strong><small>题目数</small></div></div><div className="completion-actions"><button className="button primary" type="button" onClick={() => void load()}><RotateCcw size={17} />再练一次</button><Link className="button secondary" to={mode === "wrong" ? "/wrong" : "/library"}>返回题库</Link></div></section></div>;
  }

  return (
    <div className="quiz-page">
      <header className="quiz-header">
        <button className="icon-button" type="button" title="退出练习" onClick={() => navigate(mode === "wrong" ? "/wrong" : "/library")}><X size={21} /></button>
        <button className="quiz-position-button" type="button" onClick={() => setNavigatorOpen(true)} aria-expanded={navigatorOpen}><span><strong>{title}</strong><small>{question.number != null ? `#${question.number}` : `第 ${index + 1} 题`} · 已刷 {practicedCount}/{questions.length}</small></span><ListChecks size={18} /></button>
        <button className={`icon-button mark-button ${question.progress.marked ? "active" : ""}`} type="button" title={question.progress.marked ? "移出错题本" : "加入错题本"} onClick={() => void toggleMark()} disabled={marking}>{question.progress.marked ? <BookmarkMinus size={20} /> : <BookmarkPlus size={20} />}</button>
        <span className="quiz-progress"><i style={{ width: `${progress}%` }} /></span>
      </header>
      <main className="quiz-main">
        <article className="question-area">
          <div className="question-meta"><span className={`type-tag ${question.type}`}>{question.type === "single" ? "单选题" : "多选题"}</span>{question.core && <span className="core-tag">核心</span>}<span>{question.category}</span>{question.number != null && <span>#{question.number}</span>}</div>
          <QuestionStem value={question.question} />
          <p className="answer-hint"><ListChecks size={16} />{question.type === "single" ? "请选择一个答案" : "请选择所有正确答案后提交"}</p>
          <div className="option-list">
            {optionEntries.map(([key, text]) => {
              const isSelected = selected.includes(key);
              const isCorrectOption = result?.correctAnswers.includes(key);
              const isWrongSelected = Boolean(result && isSelected && !isCorrectOption);
              const classNames = ["option-button", isSelected ? "selected" : "", isCorrectOption ? "correct" : "", isWrongSelected ? "wrong" : ""].filter(Boolean).join(" ");
              return <button type="button" className={classNames} key={key} onClick={() => choose(key)} disabled={Boolean(result)}><span className="option-key">{result && isCorrectOption ? <Check size={17} /> : result && isWrongSelected ? <X size={17} /> : key}</span><span>{text}</span></button>;
            })}
          </div>
          {error && <p className="form-error quiz-error" role="alert">{error}</p>}
          {result && <section className={`answer-panel ${result.correct ? "success" : "failure"}`}>
            <div className="answer-title">{result.correct ? <CheckCircle2 size={22} /> : <XCircle size={22} />}<span><strong>{result.correct ? "回答正确" : "回答错误"}</strong><small>{result.correct ? "这道题已记录为正确" : `正确答案：${result.correctAnswers.join("、")}`}</small></span></div>
            <div className="explanation"><h2>答案解析</h2><p>{result.explanation || "这道题暂时没有解析。"}</p>{result.referenceUrl && <a href={result.referenceUrl} target="_blank" rel="noreferrer">查看参考资料<ExternalLink size={15} /></a>}</div>
          </section>}
        </article>
      </main>
      <footer className="quiz-footer"><div className="quiz-footer-side quiz-footer-prev"><button className="button secondary small quiz-nav-button" type="button" disabled={index <= 0} onClick={previousQuestion}><ArrowLeft size={17} />上一题</button></div><div className="quiz-footer-center">{result ? <span className={result.correct ? "footer-result correct-text" : "footer-result wrong-text"}>{result.correct ? <CheckCircle2 size={18} /> : <XCircle size={18} />}{result.correct ? "回答正确" : "已加入错题本"}</span> : <button className="button primary quiz-footer-submit" type="button" disabled={!selected.length || submitting} onClick={() => void submit()}><Send size={17} />{submitting ? "提交中" : "提交答案"}</button>}</div><div className="quiz-footer-side quiz-footer-next">{result ? <button className="button secondary small quiz-nav-button" type="button" onClick={next}>{pendingIds.size ? "下一道未刷" : "查看结果"}<ArrowRight size={17} /></button> : <button className="button secondary small quiz-nav-button" type="button" disabled={index >= questions.length - 1} onClick={nextQuestion}>下一题<ArrowRight size={17} /></button>}</div></footer>
      {navigatorOpen && <div className="question-navigator-backdrop" role="presentation" onMouseDown={() => setNavigatorOpen(false)}><section className="question-navigator" role="dialog" aria-modal="true" aria-labelledby="question-navigator-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p className="eyebrow">练习进度</p><h2 id="question-navigator-title">浏览题号</h2></div><button className="icon-button" type="button" title="关闭题号列表" onClick={() => setNavigatorOpen(false)}><X size={20} /></button></header>
        <div className="question-navigator-summary"><strong>{practicedCount} / {questions.length}</strong><span>已刷题目</span></div>
        <div className="question-status-legend"><span><i className="unanswered" />未刷</span><span><i className="correct" />已刷正确</span><span><i className="wrong" />已刷错误</span><span><i className="current" />当前题</span></div>
        <div className="question-number-grid">{questions.map((item, itemIndex) => {
          const answeredQuestion = item.progress.attempts > 0;
          const status = answeredQuestion ? item.progress.lastCorrect ? "correct" : "wrong" : "unanswered";
          const label = item.number != null ? String(item.number) : String(itemIndex + 1);
          return <button key={item.id} type="button" className={`${status} ${itemIndex === index ? "current" : ""}`} aria-current={itemIndex === index ? "true" : undefined} aria-label={`题号 ${label}，${answeredQuestion ? item.progress.lastCorrect ? "已刷正确" : "已刷错误" : "未刷"}`} onClick={() => goToQuestion(itemIndex)}><span>{label}</span>{answeredQuestion && (item.progress.lastCorrect ? <Check size={12} /> : <X size={12} />)}</button>;
        })}</div>
      </section></div>}
    </div>
  );
}
