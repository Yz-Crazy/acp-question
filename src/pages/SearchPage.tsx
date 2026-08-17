import { ArrowRight, BookMarked, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, queryString } from "../api";
import { ErrorState, LoadingState } from "../components/States";
import type { Meta, Question } from "../types";

export function SearchPage() {
  const [keyword, setKeyword] = useState("");
  const [debounced, setDebounced] = useState("");
  const [type, setType] = useState("all");
  const [scope, setScope] = useState("all");
  const [category, setCategory] = useState("");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { api<Meta>("/api/meta").then(setMeta).catch(() => undefined); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(keyword.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [keyword]);
  useEffect(() => {
    if (!debounced) { setQuestions([]); setTotal(0); return; }
    let active = true;
    setLoading(true); setError("");
    api<{ questions: Question[]; total: number }>(`/api/questions?${queryString({ search: debounced, type, scope, category, limit: 50 })}`)
      .then((response) => { if (active) { setQuestions(response.questions); setTotal(response.total); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "搜索失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [category, debounced, scope, type]);

  const sessionUrl = (start?: string) => `/quiz?${queryString({ search: debounced, type, scope, category, review: "sequence", limit: 50, start })}`;
  return (
    <div className="page search-page">
      <header className="page-heading"><div><p>题干、选项和解析均可检索</p><h1>搜索题目</h1></div></header>
      <section className="search-tool">
        <div className="large-search"><Search size={20} /><input autoFocus value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="输入关键词，例如 similarity_top_k" aria-label="搜索关键词" />{keyword && <button type="button" className="icon-button" title="清空搜索" onClick={() => setKeyword("")}><X size={18} /></button>}</div>
        <div className="search-filters">
          <span><SlidersHorizontal size={16} />筛选</span>
          <select aria-label="题库范围" value={scope} onChange={(event) => setScope(event.target.value)}><option value="all">全部题库</option><option value="core">仅核心题</option></select>
          <select aria-label="题目类型" value={type} onChange={(event) => setType(event.target.value)}><option value="all">全部题型</option><option value="single">单选题</option><option value="multiple">多选题</option></select>
          <select aria-label="知识分类" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">全部分类</option>{meta?.categories.map((item) => <option key={item.category}>{item.category}</option>)}</select>
        </div>
      </section>
      {loading ? <LoadingState label="正在搜索题库" /> : error ? <ErrorState message={error} /> : debounced ? <section className="search-results">
        <div className="result-heading"><p>找到 <strong>{total}</strong> 道相关题目</p>{questions.length > 0 && <Link className="button secondary small" to={sessionUrl()}>练习搜索结果<ArrowRight size={16} /></Link>}</div>
        <div className="result-list">{questions.map((question) => <Link key={question.id} to={sessionUrl(question.id)}><span className="result-main"><span className="tag-row"><small className={`type-tag ${question.type}`}>{question.type === "single" ? "单选" : "多选"}</small>{question.core && <small className="core-tag"><BookMarked size={12} />核心</small>}<small>{question.category}</small></span><strong>{question.question.replaceAll("\n", " ")}</strong></span><ArrowRight size={18} /></Link>)}</div>
      </section> : <div className="search-placeholder"><Search size={32} /><strong>从题库中定位知识点</strong><p>输入题干、选项或解析中的文字开始搜索。</p></div>}
    </div>
  );
}
