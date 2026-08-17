import { ArrowLeft, ArrowRight, BookmarkMinus, BookmarkPlus, Check, CheckCircle2, ExternalLink, ListChecks, RotateCcw, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ErrorState, LoadingState } from "../components/States";
import type { AnswerResult, Question } from "../types";

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
  const query = params.toString();
  const title = scopeTitle(params.get("scope"));

  const load = useCallback(async () => {
    setLoading(true); setError(""); setComplete(false); setSelected([]); setResult(null); setScore(0); setAnswered(0);
    try {
      const response = await api<{ questions: Question[]; total: number }>(`/api/questions?${query}`);
      setQuestions(response.questions);
      const start = params.get("start");
      const startIndex = start ? response.questions.findIndex((item) => item.id === start) : -1;
      setIndex(startIndex >= 0 ? startIndex : 0);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "题目加载失败"); }
    finally { setLoading(false); }
  }, [params, query]);
  useEffect(() => { void load(); }, [load]);

  const question = questions[index];
  const progress = questions.length ? ((index + (result ? 1 : 0)) / questions.length) * 100 : 0;
  const mode = params.get("scope") ?? "all";

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
      setQuestions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, progress: { ...item.progress, marked: response.mistakeActive } } : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "提交失败"); }
    finally { setSubmitting(false); }
  }

  function next() {
    if (index >= questions.length - 1) { setComplete(true); return; }
    setIndex((value) => value + 1); setSelected([]); setResult(null); setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
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
        <div><strong>{title}</strong><span>{index + 1} / {questions.length}</span></div>
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
      <footer className="quiz-footer"><div>{result ? <span className={result.correct ? "footer-result correct-text" : "footer-result wrong-text"}>{result.correct ? <CheckCircle2 size={18} /> : <XCircle size={18} />}{result.correct ? "回答正确" : "已加入错题本"}</span> : <span className="selected-count">已选择 {selected.length} 项</span>}</div>{result ? <button className="button primary" type="button" onClick={next}>{index === questions.length - 1 ? "查看结果" : "下一题"}<ArrowRight size={18} /></button> : <button className="button primary" type="button" disabled={!selected.length || submitting} onClick={() => void submit()}>{submitting ? "提交中" : "提交答案"}<ArrowRight size={18} /></button>}</footer>
    </div>
  );
}
