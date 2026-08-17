import { ArrowRight, CalendarClock, CheckCircle2, Dice5, Flame, History, ListRestart, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, queryString } from "../api";
import { ErrorState, LoadingState } from "../components/States";
import type { Question, Stats } from "../types";

const reviewModes = [
  { review: "due", title: "到期复习", description: "按记忆节奏复习今天到期的题", icon: CalendarClock, tone: "green" },
  { review: "frequency", title: "高频攻坚", description: "从答错次数最多的题开始", icon: Flame, tone: "red" },
  { review: "random", title: "随机抽查", description: "打乱顺序，减少位置记忆", icon: Dice5, tone: "amber" },
  { review: "sequence", title: "全部重做", description: "完整重做当前错题本", icon: ListRestart, tone: "blue" }
];

export function WrongPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const [statsData, list] = await Promise.all([
        api<Stats>("/api/stats"),
        api<{ questions: Question[] }>("/api/questions?scope=wrong&review=frequency&limit=6")
      ]);
      setStats(statsData);
      setQuestions(list.questions);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "加载失败"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="page wrong-page">
      <header className="page-heading"><div><p>针对薄弱点重复练习</p><h1>错题复习</h1></div></header>
      {error ? <ErrorState message={error} retry={() => void load()} /> : !stats ? <LoadingState label="正在整理错题本" /> : <>
        <section className="wrong-overview">
          <div className="wrong-number"><span><TriangleAlert size={22} /></span><strong>{stats.activeMistakes}</strong><p>待掌握错题</p></div>
          <div className="wrong-progress"><div><span>今日到期</span><strong>{stats.dueMistakes} 道</strong></div><div className="meter"><span style={{ width: `${stats.activeMistakes ? Math.min((stats.dueMistakes / stats.activeMistakes) * 100, 100) : 0}%` }} /></div><small>连续答对 2 次后，题目会自动移出错题本</small></div>
        </section>
        <section className="section-block">
          <div className="section-heading"><div><p className="eyebrow">复习模式</p><h2>换一种方式巩固</h2></div></div>
          <div className="review-grid">
            {reviewModes.map(({ review, title, description, icon: Icon, tone }) => (
              <Link key={review} className="review-card" to={`/quiz?${queryString({ scope: "wrong", review })}`}>
                <span className={`review-icon ${tone}`}><Icon size={21} /></span><span><strong>{title}</strong><small>{description}</small></span><ArrowRight size={18} />
              </Link>
            ))}
          </div>
        </section>
        <section className="section-block">
          <div className="section-heading"><div><p className="eyebrow">错题预览</p><h2>优先处理高频错题</h2></div>{questions.length > 0 && <Link to="/quiz?scope=wrong&review=frequency">开始重做<ArrowRight size={16} /></Link>}</div>
          <div className="question-preview-list">
            {questions.map((question) => <Link key={question.id} to={`/quiz?${queryString({ scope: "wrong", review: "frequency", start: question.id })}`}><span className="preview-status"><History size={17} /></span><span><strong>{question.question.replaceAll("\n", " ")}</strong><small>{question.category} · 答错 {question.progress.wrongCount} 次</small></span><ArrowRight size={17} /></Link>)}
            {!questions.length && <div className="empty-state compact"><CheckCircle2 size={28} /><strong>当前没有待掌握错题</strong><p>答错或手动标记的题目会出现在这里。</p></div>}
          </div>
        </section>
      </>}
    </div>
  );
}
