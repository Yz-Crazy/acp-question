import { ArrowRight, BookOpen, Brain, CalendarCheck, Flame, Layers3, Search, Target, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, queryString } from "../api";
import { useAuth } from "../auth";
import { ErrorState, LoadingState } from "../components/States";
import type { Meta, Stats } from "../types";

export function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const [statsData, metaData] = await Promise.all([api<Stats>("/api/stats"), api<Meta>("/api/meta")]);
      setStats(statsData);
      setMeta(metaData);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加载失败");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const hour = new Date().getHours();
  const greeting = hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  return (
    <div className="page dashboard-page">
      <header className="page-heading dashboard-heading">
        <div><p>{greeting}，{user?.nickname || user?.username}</p><h1>今天准备练哪部分？</h1></div>
        <Link className="search-shortcut" to="/search"><Search size={18} /><span>搜索题目</span></Link>
      </header>
      {error ? <ErrorState message={error} retry={() => void load()} /> : !stats || !meta ? <LoadingState label="正在汇总学习进度" /> : <>
        <section className="stats-strip" aria-label="学习概览">
          <div><span className="stat-icon green"><Target size={19} /></span><strong>{stats.practiced}<small> / {stats.totalQuestions}</small></strong><p>已练题目</p></div>
          <div><span className="stat-icon amber"><Flame size={19} /></span><strong>{stats.streak}<small> 天</small></strong><p>连续学习</p></div>
          <div><span className="stat-icon blue"><Brain size={19} /></span><strong>{stats.accuracy}<small>%</small></strong><p>累计正确率</p></div>
          <div><span className="stat-icon red"><TriangleAlert size={19} /></span><strong>{stats.activeMistakes}</strong><p>待掌握错题</p></div>
        </section>

        <section className="section-block">
          <div className="section-heading"><div><p className="eyebrow">快速开始</p><h2>选择练习范围</h2></div><Link to="/library">更多设置<ArrowRight size={16} /></Link></div>
          <div className="quick-grid">
            <Link className="quick-card primary-card" to={`/quiz?${queryString({ scope: "all", type: "all", review: "sequence" })}`}>
              <span className="quick-icon"><Layers3 size={23} /></span><span><strong>继续全量练习</strong><small>{stats.practiced} / {meta.totals.total} 道已刷</small></span><ArrowRight size={18} />
            </Link>
            <Link className="quick-card" to={`/quiz?${queryString({ scope: "core", type: "all", review: "sequence" })}`}>
              <span className="quick-icon core"><BookOpen size={23} /></span><span><strong>核心题库</strong><small>{meta.totals.core} 道重点题目</small></span><ArrowRight size={18} />
            </Link>
            <Link className="quick-card" to={`/quiz?${queryString({ scope: "wrong", review: "due" })}`}>
              <span className="quick-icon wrong"><CalendarCheck size={23} /></span><span><strong>今日错题复习</strong><small>{stats.dueMistakes} 道已到复习时间</small></span><ArrowRight size={18} />
            </Link>
          </div>
        </section>

        <section className="section-block categories-block">
          <div className="section-heading"><div><p className="eyebrow">知识分类</p><h2>按薄弱领域练习</h2></div></div>
          <div className="category-list">
            {meta.categories.slice(0, 8).map((item, index) => (
              <Link key={item.category} to={`/quiz?${queryString({ scope: "all", category: item.category, review: "sequence" })}`}>
                <span className={`category-index tone-${index % 4}`}>{String(index + 1).padStart(2, "0")}</span>
                <span><strong>{item.category}</strong><small>{item.count} 道 · 核心 {item.core_count} 道</small></span>
                <ArrowRight size={17} />
              </Link>
            ))}
            {!meta.categories.length && <p className="empty-inline">导入题目后，知识分类会显示在这里。</p>}
          </div>
        </section>
      </>}
    </div>
  );
}
