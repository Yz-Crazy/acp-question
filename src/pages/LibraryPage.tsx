import { ArrowRight, BookMarked, CheckCircle2, Layers3, ListChecks, Shuffle } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, queryString } from "../api";
import { ErrorState, LoadingState } from "../components/States";
import type { Meta } from "../types";

export function LibraryPage() {
  const navigate = useNavigate();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState("");
  const [scope, setScope] = useState("all");
  const [type, setType] = useState("all");
  const [category, setCategory] = useState("");
  const [review, setReview] = useState("sequence");
  const [progress, setProgress] = useState({ total: 0, practiced: 0 });
  useEffect(() => {
    api<Meta>("/api/meta").then(setMeta).catch((reason) => setError(reason instanceof Error ? reason.message : "加载失败"));
  }, []);
  useEffect(() => {
    let active = true;
    api<{ total: number; practiced: number }>(`/api/questions?${queryString({ scope, type, category, review: "sequence", limit: 1 })}`)
      .then((response) => { if (active) setProgress({ total: response.total, practiced: response.practiced }); })
      .catch(() => { if (active) setProgress({ total: 0, practiced: 0 }); });
    return () => { active = false; };
  }, [category, scope, type]);

  function start() {
    navigate(`/quiz?${queryString({ scope, type, category, review })}`);
  }

  const startLabel = progress.practiced > 0 && progress.practiced < progress.total ? "继续练习" : progress.total > 0 && progress.practiced >= progress.total ? "重新练习" : "开始练习";

  return (
    <div className="page library-page">
      <header className="page-heading"><div><p>自由组合题库范围</p><h1>开始刷题</h1></div></header>
      {error ? <ErrorState message={error} /> : !meta ? <LoadingState /> : <div className="builder-layout">
        <section className="practice-builder">
          <div className="builder-group">
            <div className="group-title"><Layers3 size={19} /><span><strong>题库范围</strong><small>选择全部或核心题目</small></span></div>
            <div className="choice-grid two">
              <button type="button" className={`choice-tile ${scope === "all" ? "selected" : ""}`} onClick={() => setScope("all")}><Layers3 size={20} /><strong>全部题库</strong><small>{meta.totals.total} 道</small><CheckCircle2 className="choice-check" size={18} /></button>
              <button type="button" className={`choice-tile ${scope === "core" ? "selected" : ""}`} onClick={() => setScope("core")}><BookMarked size={20} /><strong>核心题库</strong><small>{meta.totals.core} 道</small><CheckCircle2 className="choice-check" size={18} /></button>
            </div>
          </div>
          <div className="builder-group">
            <div className="group-title"><ListChecks size={19} /><span><strong>题目类型</strong><small>可专项练习单选或多选</small></span></div>
            <div className="segmented option-segment" aria-label="题目类型">
              {[{ value: "all", label: "不限" }, { value: "single", label: `单选 ${meta.totals.single}` }, { value: "multiple", label: `多选 ${meta.totals.multiple}` }].map((item) => <button key={item.value} type="button" className={type === item.value ? "active" : ""} onClick={() => setType(item.value)}>{item.label}</button>)}
            </div>
          </div>
          <div className="builder-group">
            <div className="group-title"><BookMarked size={19} /><span><strong>知识分类</strong><small>聚焦一个知识领域</small></span></div>
            <div className="chip-list">
              <button type="button" className={!category ? "active" : ""} onClick={() => setCategory("")}>全部分类</button>
              {meta.categories.map((item) => <button type="button" key={item.category} className={category === item.category ? "active" : ""} onClick={() => setCategory(item.category)}>{item.category}<small>{item.count}</small></button>)}
            </div>
          </div>
          <div className="builder-group"><div className="group-title"><Shuffle size={19} /><span><strong>出题顺序</strong><small>自动从未刷题位置继续</small></span></div><div className="segmented option-segment"><button type="button" className={review === "sequence" ? "active" : ""} onClick={() => setReview("sequence")}>顺序</button><button type="button" className={review === "random" ? "active" : ""} onClick={() => setReview("random")}>随机</button></div></div>
        </section>
        <aside className="start-summary">
          <p className="eyebrow">本次练习</p><h2>{scope === "core" ? "核心" : "全部"}{type === "single" ? "单选题" : type === "multiple" ? "多选题" : "题目"}</h2>
          <dl><div><dt>知识分类</dt><dd>{category || "全部"}</dd></div><div><dt>出题顺序</dt><dd>{review === "random" ? "随机" : "顺序"}</dd></div><div><dt>题库进度</dt><dd>{progress.practiced} / {progress.total} 已刷</dd></div></dl>
          <button className="button primary" type="button" onClick={start}>{startLabel}<ArrowRight size={18} /></button>
        </aside>
      </div>}
    </div>
  );
}
