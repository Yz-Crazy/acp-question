import { ArrowRight, CheckCircle2, Clock3, FileCheck2, PauseCircle, Plus, Shuffle, Trophy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { ErrorState, LoadingState } from "../components/States";
import type { MockExamSummary, MockExamTemplate } from "../types";

interface MockExamCatalog {
  templates: MockExamTemplate[];
  exams: MockExamSummary[];
  coreAvailability: { single: number; multiple: number };
}

function remainingLabel(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${minutes} 分钟`;
}

export function MockExamsPage() {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<MockExamCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setCatalog(await api<MockExamCatalog>("/api/mock-exams")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "模拟题加载失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(source: "fixed" | "random", templateId?: string) {
    const key = templateId ?? "random";
    setCreating(key); setError("");
    try {
      const response = await api<{ exam: { id: string } }>("/api/mock-exams", {
        method: "POST",
        body: JSON.stringify({ source, templateId })
      });
      navigate(`/mock-exams/${response.exam.id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "模拟题生成失败"); }
    finally { setCreating(""); }
  }

  const randomReady = Boolean(catalog && catalog.coreAvailability.single >= 50 && catalog.coreAvailability.multiple >= 25);
  return (
    <div className="page mock-exams-page">
      <header className="page-heading"><div><p>正式计时、暂停续答与交卷复盘</p><h1>模拟题</h1></div></header>
      {error && <ErrorState message={error} retry={() => void load()} />}
      {loading || !catalog ? <LoadingState label="正在整理模拟题" /> : <>
        <section className="mock-overview">
          <div className="mock-overview-copy"><span><FileCheck2 size={25} /></span><div><p className="eyebrow">考试规则</p><h2>75 道题，满分 100 分</h2><small>单选 50 道，每题 1 分；多选 25 道，每题 2 分；80 分及格。</small></div></div>
          <dl><div><Clock3 size={18} /><dt>考试时间</dt><dd>120 分钟</dd></div><div><Trophy size={18} /><dt>及格分数</dt><dd>80 分</dd></div></dl>
        </section>

        <section className="section-block">
          <div className="section-heading"><div><p className="eyebrow">固定套卷</p><h2>管理员上传的模拟题</h2></div></div>
          {catalog.templates.length ? <div className="mock-template-grid">{catalog.templates.map((template) => (
            <article className="mock-template-card" key={template.id}>
              <span className="mock-template-number">{String(template.slot).padStart(2, "0")}</span>
              <div><strong>{template.title}</strong><small>50 道单选 · 25 道多选</small></div>
              <button className="button secondary small" type="button" disabled={Boolean(creating)} onClick={() => void create("fixed", template.id)}>{creating === template.id ? "创建中" : "开始新答卷"}<ArrowRight size={16} /></button>
            </article>
          ))}</div> : <div className="empty-state compact"><FileCheck2 size={28} /><strong>固定套卷尚未上传</strong><p>管理员上传套卷后会显示在这里。</p></div>}
        </section>

        <section className="random-exam-band">
          <div><span className="random-exam-icon"><Shuffle size={22} /></span><span><strong>核心题库随机组卷</strong><small>每次重新抽取 50 道核心单选题和 25 道核心多选题</small></span></div>
          <button className="button primary" type="button" disabled={!randomReady || Boolean(creating)} onClick={() => void create("random")}><Plus size={17} />{creating === "random" ? "生成中" : "生成随机模拟题"}</button>
          {!randomReady && <p>核心题量不足：当前 {catalog.coreAvailability.single} 道单选、{catalog.coreAvailability.multiple} 道多选。</p>}
        </section>

        <section className="section-block">
          <div className="section-heading"><div><p className="eyebrow">个人记录</p><h2>我的模拟答卷</h2></div></div>
          <div className="mock-history-list">{catalog.exams.map((exam) => (
            <Link to={`/mock-exams/${exam.id}`} key={exam.id}>
              <span className={`mock-history-state ${exam.status}`}>{exam.status === "submitted" ? <CheckCircle2 size={19} /> : <PauseCircle size={19} />}</span>
              <span className="mock-history-main"><span><strong>{exam.title}</strong><small>{exam.source === "fixed" ? "固定套卷" : "随机组卷"}</small></span><small>{exam.status === "submitted" ? `${new Date(exam.submittedAt ?? exam.updatedAt).toLocaleDateString("zh-CN")}交卷 · 错题 ${exam.wrongCount ?? 0} 道` : `已答 ${exam.answeredCount}/75 · 剩余 ${remainingLabel(exam.remainingSeconds)}`}</small></span>
              {exam.status === "submitted" ? <span className={`mock-score ${exam.passed ? "passed" : "failed"}`}><strong>{exam.score}</strong><small>{exam.passed ? "已及格" : "未及格"}</small></span> : <span className="mock-resume">继续答题<ArrowRight size={16} /></span>}
            </Link>
          ))}{!catalog.exams.length && <p className="empty-inline">还没有模拟答卷。固定套卷和随机组卷创建后会永久保留在这里。</p>}</div>
        </section>
      </>}
    </div>
  );
}
