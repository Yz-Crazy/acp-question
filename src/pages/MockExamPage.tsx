import { ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, Check, CheckCircle2, Clock3, ExternalLink, ListChecks, Send, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { ErrorState, LoadingState } from "../components/States";
import type { MockExamDetail, MockExamItem } from "../types";

interface MockExamResponse { exam: MockExamDetail; items: MockExamItem[] }
type ReviewFilter = "all" | "wrong" | "marked";

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest].map((value) => String(value).padStart(2, "0")).join(":");
}

function QuestionStem({ value }: { value: string }) {
  const [lead, ...rest] = value.split("\n");
  if (rest.length < 2) return <h1>{value}</h1>;
  return <div className="question-stem"><h1>{lead}</h1><pre>{rest.join("\n")}</pre></div>;
}

export function MockExamPage() {
  const { examId = "" } = useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState<MockExamDetail | null>(null);
  const [items, setItems] = useState<MockExamItem[]>([]);
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [visible, setVisible] = useState(() => !document.hidden);
  const [submitting, setSubmitting] = useState(false);
  const remainingRef = useRef(0);
  const indexRef = useRef(0);
  const itemsRef = useRef<MockExamItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await api<MockExamResponse>(`/api/mock-exams/${encodeURIComponent(examId)}`);
      setExam(response.exam); setItems(response.items); setRemaining(response.exam.remainingSeconds);
      remainingRef.current = response.exam.remainingSeconds;
      itemsRef.current = response.items;
      const savedIndex = response.exam.currentItemId ? response.items.findIndex((item) => item.id === response.exam.currentItemId) : -1;
      const firstUnanswered = response.items.findIndex((item) => item.type === response.exam.currentSection && !item.selectedAnswers.length);
      const nextIndex = savedIndex >= 0 ? savedIndex : firstUnanswered >= 0 ? firstUnanswered : 0;
      setIndex(nextIndex); indexRef.current = nextIndex;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "模拟题加载失败"); }
    finally { setLoading(false); }
  }, [examId]);
  useEffect(() => { void load(); }, [load]);

  const item = items[index];
  const submitted = exam?.status === "submitted";
  const answeredCount = useMemo(() => items.filter((entry) => entry.selectedAnswers.length > 0).length, [items]);
  const markedCount = useMemo(() => items.filter((entry) => entry.marked).length, [items]);
  const sectionItems = useMemo(() => items.filter((entry) => entry.type === item?.type), [item?.type, items]);
  const sectionIndex = item ? sectionItems.findIndex((entry) => entry.id === item.id) : 0;
  const eligible = useMemo(() => items.map((entry, itemIndex) => ({ entry, itemIndex })).filter(({ entry }) => {
    if (reviewFilter === "wrong") return entry.correct === false;
    if (reviewFilter === "marked") return entry.marked;
    return true;
  }), [items, reviewFilter]);

  useEffect(() => { indexRef.current = index; }, [index]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { remainingRef.current = remaining; }, [remaining]);

  const persistPosition = useCallback((keepalive = false) => {
    const current = itemsRef.current[indexRef.current];
    if (!current || exam?.status !== "in_progress") return;
    const body = JSON.stringify({
      remainingSeconds: remainingRef.current,
      currentItemId: current.id,
      currentSection: current.type,
      ...(keepalive ? { responses: itemsRef.current.map((entry) => ({ itemId: entry.id, answers: entry.selectedAnswers, marked: entry.marked })) } : {})
    });
    if (keepalive) {
      void fetch(`/api/mock-exams/${encodeURIComponent(examId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body, keepalive: true
      }).catch(() => undefined);
      return;
    }
    void api(`/api/mock-exams/${encodeURIComponent(examId)}`, { method: "PATCH", body }).catch(() => undefined);
  }, [exam?.status, examId]);

  useEffect(() => {
    const onPageHide = () => persistPosition(true);
    const onVisibility = () => {
      const isVisible = !document.hidden;
      setVisible(isVisible);
      if (!isVisible) persistPosition(true);
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      persistPosition(true);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [persistPosition]);

  useEffect(() => {
    if (exam?.status !== "in_progress" || !visible || remaining <= 0) return;
    const timer = window.setInterval(() => setRemaining((value) => Math.max(value - 1, 0)), 1000);
    return () => window.clearInterval(timer);
  }, [exam?.status, remaining <= 0, visible]);

  useEffect(() => {
    if (exam?.status !== "in_progress" || !visible) return;
    const timer = window.setInterval(() => persistPosition(), 15_000);
    return () => window.clearInterval(timer);
  }, [exam?.status, persistPosition, visible]);

  async function finish(automatic = false) {
    if (!exam || exam.status !== "in_progress" || submitting) return;
    const unanswered = items.filter((entry) => !entry.selectedAnswers.length).length;
    if (!automatic && !window.confirm(unanswered ? `还有 ${unanswered} 道题未作答，确定交卷吗？` : "确定提交答卷吗？")) return;
    setSubmitting(true); setError("");
    try {
      await api(`/api/mock-exams/${encodeURIComponent(examId)}/submit`, {
        method: "POST",
        body: JSON.stringify({
          remainingSeconds: remainingRef.current,
          responses: items.map((entry) => ({ itemId: entry.id, answers: entry.selectedAnswers, marked: entry.marked }))
        })
      });
      setReviewFilter("all");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "交卷失败"); }
    finally { setSubmitting(false); }
  }

  useEffect(() => {
    if (exam?.status === "in_progress" && remaining === 0 && !submitting) void finish(true);
  }, [exam?.status, remaining, submitting]);

  async function choose(key: string) {
    if (!item || submitted) return;
    const previous = item.selectedAnswers;
    const answers = item.type === "single" ? [key] : previous.includes(key) ? previous.filter((entry) => entry !== key) : [...previous, key];
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, selectedAnswers: answers } : entry));
    try {
      await api(`/api/mock-exams/${encodeURIComponent(examId)}`, {
        method: "PATCH",
        body: JSON.stringify({ itemId: item.id, answers, remainingSeconds: remainingRef.current, currentItemId: item.id, currentSection: item.type })
      });
    } catch (reason) {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, selectedAnswers: previous } : entry));
      setError(reason instanceof Error ? reason.message : "答案保存失败");
    }
  }

  async function toggleMark() {
    if (!item || submitted) return;
    const marked = !item.marked;
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, marked } : entry));
    try {
      await api(`/api/mock-exams/${encodeURIComponent(examId)}`, {
        method: "PATCH",
        body: JSON.stringify({ itemId: item.id, marked, remainingSeconds: remainingRef.current, currentItemId: item.id, currentSection: item.type })
      });
    } catch (reason) {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, marked: !marked } : entry));
      setError(reason instanceof Error ? reason.message : "标记保存失败");
    }
  }

  function goTo(target: number) {
    const next = items[target];
    if (!next) return;
    setIndex(target); setNavigatorOpen(false); setError("");
    indexRef.current = target;
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (!submitted) void api(`/api/mock-exams/${encodeURIComponent(examId)}`, {
      method: "PATCH",
      body: JSON.stringify({ remainingSeconds: remainingRef.current, currentItemId: next.id, currentSection: next.type })
    }).catch(() => undefined);
  }

  function switchSection(type: "single" | "multiple") {
    const target = eligible.find(({ entry }) => entry.type === type) ?? items.map((entry, itemIndex) => ({ entry, itemIndex })).find(({ entry }) => entry.type === type);
    if (target) goTo(target.itemIndex);
  }

  function changeFilter(filter: ReviewFilter) {
    setReviewFilter(filter);
    const target = items.findIndex((entry) => filter === "all" || (filter === "wrong" ? entry.correct === false : entry.marked));
    if (target >= 0) goTo(target);
  }

  const filteredSection = eligible.filter(({ entry }) => entry.type === item?.type);
  const filteredPosition = filteredSection.findIndex(({ entry }) => entry.id === item?.id);
  const previousTarget = filteredPosition > 0 ? filteredSection[filteredPosition - 1].itemIndex : -1;
  const nextTarget = filteredPosition >= 0 && filteredPosition < filteredSection.length - 1 ? filteredSection[filteredPosition + 1].itemIndex : -1;

  if (loading) return <div className="quiz-shell"><LoadingState label="正在打开模拟题" /></div>;
  if (error && (!exam || !item)) return <div className="quiz-shell"><ErrorState message={error} retry={() => void load()} /></div>;
  if (!exam || !item) return <div className="quiz-shell"><ErrorState message="模拟题数据不完整" /></div>;

  return (
    <div className="mock-exam-page">
      <header className="mock-exam-header">
        <button className="icon-button" type="button" title={submitted ? "返回模拟题" : "暂停并退出"} onClick={() => { persistPosition(true); navigate("/mock-exams"); }}><X size={21} /></button>
        <button className="mock-exam-position" type="button" aria-label="浏览模拟题" onClick={() => setNavigatorOpen(true)}><span><strong>{exam.title}</strong><small>{item.type === "single" ? "单选题" : "多选题"} {sectionIndex + 1}/{sectionItems.length} · 已答 {answeredCount}/75</small></span><ListChecks size={18} /></button>
        <span className={`mock-timer ${remaining <= 600 && !submitted ? "warning" : ""}`}>{submitted ? <><strong>{exam.score}</strong><small>分</small></> : <><Clock3 size={16} /><strong>{formatTime(remaining)}</strong></>}</span>
        <button className={`icon-button mock-mark-button ${item.marked ? "active" : ""}`} type="button" title={submitted ? "本题标记状态" : item.marked ? "取消存疑标记" : "标记为存疑"} onClick={() => void toggleMark()} disabled={submitted}>{item.marked ? <BookmarkCheck size={20} /> : <Bookmark size={20} />}</button>
      </header>

      <div className="mock-section-bar">
        <div className="segmented" aria-label="答题部分"><button type="button" className={item.type === "single" ? "active" : ""} onClick={() => switchSection("single")} disabled={!eligible.some(({ entry }) => entry.type === "single")}>单选题 <span>{items.filter((entry) => entry.type === "single" && entry.selectedAnswers.length).length}/50</span></button><button type="button" className={item.type === "multiple" ? "active" : ""} onClick={() => switchSection("multiple")} disabled={!eligible.some(({ entry }) => entry.type === "multiple")}>多选题 <span>{items.filter((entry) => entry.type === "multiple" && entry.selectedAnswers.length).length}/25</span></button></div>
        {submitted && <div className="segmented mock-review-filter" aria-label="复盘筛选"><button type="button" className={reviewFilter === "all" ? "active" : ""} onClick={() => changeFilter("all")}>全部</button><button type="button" className={reviewFilter === "wrong" ? "active" : ""} onClick={() => changeFilter("wrong")} disabled={!exam.wrongCount}>错题 {exam.wrongCount}</button><button type="button" className={reviewFilter === "marked" ? "active" : ""} onClick={() => changeFilter("marked")} disabled={!markedCount}>存疑 {markedCount}</button></div>}
      </div>

      {submitted && <section className={`mock-result-strip ${exam.passed ? "passed" : "failed"}`}><span>{exam.passed ? <CheckCircle2 size={24} /> : <XCircle size={24} />}</span><div><strong>{exam.passed ? "考试通过" : "未达到及格线"}</strong><small>得分 {exam.score} / 100 · 答错或未答 {exam.wrongCount} 道</small></div></section>}

      <main className="mock-exam-main"><article className="question-area">
        <div className="question-meta"><span className={`type-tag ${item.type}`}>{item.type === "single" ? "单选题 · 1 分" : "多选题 · 2 分"}</span><span>{item.category}</span><span>总题号 {item.position}</span>{item.marked && <span className="mock-marked-tag"><Bookmark size={12} />存疑</span>}</div>
        <QuestionStem value={item.question} />
        <p className="answer-hint"><ListChecks size={16} />{item.type === "single" ? "请选择一个答案" : "请选择所有正确答案"}</p>
        <div className="option-list">{Object.entries(item.options).map(([key, text]) => {
          const selected = item.selectedAnswers.includes(key);
          const correctOption = submitted && item.correctAnswers?.includes(key);
          const wrongSelected = submitted && selected && !correctOption;
          const className = ["option-button", selected ? "selected" : "", correctOption ? "correct" : "", wrongSelected ? "wrong" : ""].filter(Boolean).join(" ");
          return <button type="button" className={className} key={key} onClick={() => void choose(key)} disabled={submitted}><span className="option-key">{correctOption ? <Check size={17} /> : wrongSelected ? <X size={17} /> : key}</span><span>{text}</span></button>;
        })}</div>
        {error && <p className="form-error quiz-error" role="alert">{error}</p>}
        {submitted && <section className={`answer-panel ${item.correct ? "success" : "failure"}`}><div className="answer-title">{item.correct ? <CheckCircle2 size={22} /> : <XCircle size={22} />}<span><strong>{item.correct ? "回答正确" : item.selectedAnswers.length ? "回答错误" : "本题未作答"}</strong><small>正确答案：{item.correctAnswers?.join("、")}</small></span></div><div className="explanation"><h2>答案解析</h2><p>{item.explanation || "这道题暂时没有解析。"}</p>{item.referenceUrl && <a href={item.referenceUrl} target="_blank" rel="noreferrer">查看参考资料<ExternalLink size={15} /></a>}</div></section>}
      </article></main>

      <footer className="mock-exam-footer">
        <button className="button secondary small" type="button" disabled={previousTarget < 0} onClick={() => goTo(previousTarget)}><ArrowLeft size={17} />上一题</button>
        {!submitted && <button className="button primary small mock-submit-button" type="button" onClick={() => void finish()} disabled={submitting}><Send size={16} />{submitting ? "交卷中" : "提交答卷"}</button>}
        <button className="button secondary small" type="button" disabled={nextTarget < 0} onClick={() => goTo(nextTarget)}>下一题<ArrowRight size={17} /></button>
      </footer>

      {navigatorOpen && <div className="question-navigator-backdrop" role="presentation" onMouseDown={() => setNavigatorOpen(false)}><section className="question-navigator mock-navigator" role="dialog" aria-modal="true" aria-labelledby="mock-navigator-title" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">答题进度</p><h2 id="mock-navigator-title">浏览模拟题</h2></div><button className="icon-button" type="button" title="关闭题号列表" onClick={() => setNavigatorOpen(false)}><X size={20} /></button></header><div className="question-navigator-summary"><strong>{answeredCount} / 75</strong><span>已作答 · 存疑 {markedCount} 道</span></div><div className="question-status-legend"><span><i className="unanswered" />未答</span><span><i className="correct" />已答</span>{submitted && <span><i className="wrong" />答错</span>}<span><i className="current" />当前题</span></div>{(["single", "multiple"] as const).map((type) => <div className="mock-number-section" key={type}><h3>{type === "single" ? "单选题" : "多选题"}</h3><div className="question-number-grid">{items.map((entry, itemIndex) => ({ entry, itemIndex })).filter(({ entry }) => entry.type === type).map(({ entry, itemIndex }, sectionNumber) => {
          const answered = entry.selectedAnswers.length > 0;
          const status = submitted && entry.correct === false ? "wrong" : answered ? "correct" : "unanswered";
          return <button key={entry.id} type="button" className={`${status} ${itemIndex === index ? "current" : ""}`} aria-label={`${type === "single" ? "单选" : "多选"}第 ${sectionNumber + 1} 题，${answered ? "已答" : "未答"}${entry.marked ? "，已标记存疑" : ""}`} onClick={() => goTo(itemIndex)}><span>{sectionNumber + 1}</span>{entry.marked ? <Bookmark size={12} /> : answered ? <Check size={12} /> : null}</button>;
        })}</div></div>)}</section></div>}
    </div>
  );
}
