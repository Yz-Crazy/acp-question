import { AlertTriangle, BookMarked, BookOpenCheck, CheckCircle2, FileJson, Pencil, Plus, RefreshCw, Save, Search, UploadCloud, UserCheck, Users, UserX, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, queryString } from "../api";
import { useAuth } from "../auth";
import { ErrorState, LoadingState } from "../components/States";
import { parseQuestionSource } from "../lib/questionImport";
import type { AdminQuestion, AdminUser } from "../types";

export function AdminPage() {
  const [tab, setTab] = useState<"questions" | "users">("questions");
  return (
    <div className="page admin-page">
      <header className="page-heading"><div><p>题库、用户与权限</p><h1>系统管理</h1></div></header>
      <div className="segmented admin-tabs" aria-label="管理内容">
        <button type="button" className={tab === "questions" ? "active" : ""} onClick={() => setTab("questions")}><BookOpenCheck size={16} />题库管理</button>
        <button type="button" className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}><Users size={16} />用户管理</button>
      </div>
      {tab === "questions" ? <QuestionManagement /> : <UserManagement />}
    </div>
  );
}

function QuestionManagement() {
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<AdminQuestion | null>(null);
  const [pending, setPending] = useState<unknown[]>([]);
  const [fileName, setFileName] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await api<{ questions: AdminQuestion[]; total: number }>(`/api/admin/questions?${queryString({ search: debounced, status, limit: 100 })}`);
      setQuestions(response.questions); setTotal(response.total);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "题库加载失败"); }
    finally { setLoading(false); }
  }, [debounced, status]);
  useEffect(() => { void load(); }, [load]);

  async function chooseFile(file?: File) {
    if (!file) return;
    setImportMessage("");
    try {
      const parsed = parseQuestionSource(await file.text());
      if (parsed.length > 500) throw new Error("单次最多导入 500 道题");
      setPending(parsed); setFileName(file.name);
    } catch (reason) {
      setPending([]); setFileName("");
      setImportMessage(reason instanceof Error ? reason.message : "文件解析失败");
    }
  }

  async function runImport() {
    if (!pending.length) return;
    setImporting(true); setImportMessage("");
    try {
      const response = await api<{ imported: number; mode: string }>("/api/admin/questions/import", {
        method: "POST", body: JSON.stringify({ questions: pending, replaceExisting })
      });
      setImportMessage(`已成功导入 ${response.imported} 道题`);
      setPending([]); setFileName("");
      await load();
    } catch (reason) { setImportMessage(reason instanceof Error ? reason.message : "导入失败"); }
    finally { setImporting(false); }
  }

  return <>
    <section className="admin-import-band">
      <div className="import-copy"><span className="admin-section-icon"><UploadCloud size={22} /></span><span><strong>导入或更新题库</strong><small>支持 JSON 数组、单个对象或包含连续 JSON 对象的 Markdown，字段与 lizi.md 一致</small></span></div>
      <div className="import-actions">
        <label className="button secondary small file-button"><FileJson size={16} />选择题库文件<input type="file" accept=".json,.md,.txt,application/json" onChange={(event) => void chooseFile(event.target.files?.[0])} /></label>
        {pending.length > 0 && <button className="button primary small" type="button" onClick={() => void runImport()} disabled={importing}>{importing ? "导入中" : `导入 ${pending.length} 道题`}</button>}
      </div>
      {pending.length > 0 && <div className="import-preview"><span><CheckCircle2 size={16} /><strong>{fileName}</strong> · 已识别 {pending.length} 道题</span><label className="check-control"><input type="checkbox" checked={replaceExisting} onChange={(event) => setReplaceExisting(event.target.checked)} /><span>覆盖题库：未包含的旧题将停用</span></label></div>}
      {importMessage && <p className={importMessage.includes("成功") ? "form-success" : "form-error"} role="status">{importMessage}</p>}
    </section>

    <section className="section-block admin-list-section">
      <div className="section-heading"><div><p className="eyebrow">题目维护</p><h2>题库共 {total} 道</h2></div><button className="icon-button" type="button" title="刷新题库" onClick={() => void load()}><RefreshCw size={18} /></button></div>
      <div className="admin-toolbar"><div className="compact-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索题干、分类或编号" aria-label="搜索管理题库" /></div><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="题目状态"><option value="all">全部状态</option><option value="active">使用中</option><option value="inactive">已停用</option></select></div>
      {error ? <ErrorState message={error} retry={() => void load()} /> : loading ? <LoadingState label="正在加载题库" /> : <div className="admin-question-list">
        {questions.map((question) => <div className={`admin-question-row ${question.active ? "" : "inactive"}`} key={question.id}><span className={`question-state ${question.active ? "active" : ""}`}>{question.active ? "使用中" : "已停用"}</span><span className="admin-question-main"><span><small>{question.type === "single" ? "单选" : "多选"}</small>{question.core && <small className="core-text"><BookMarked size={12} />核心</small>}<small>{question.category}</small>{question.number != null && <small>#{question.number}</small>}</span><strong>{question.question.replaceAll("\n", " ")}</strong></span><button className="icon-button" type="button" title="编辑题目" onClick={() => setEditing(question)}><Pencil size={17} /></button></div>)}
        {!questions.length && <p className="empty-inline">没有符合条件的题目。</p>}
      </div>}
    </section>
    {editing && <QuestionEditor question={editing} onClose={() => setEditing(null)} onSaved={(question) => { setQuestions((current) => current.map((item) => item.id === question.id ? question : item)); setEditing(null); }} />}
  </>;
}

function QuestionEditor({ question, onClose, onSaved }: { question: AdminQuestion; onClose: () => void; onSaved: (question: AdminQuestion) => void }) {
  const [type, setType] = useState(question.type);
  const [number, setNumber] = useState(question.number?.toString() ?? "");
  const [stem, setStem] = useState(question.question);
  const [options, setOptions] = useState<Record<string, string>>({ ...question.options });
  const [answers, setAnswers] = useState([...question.correctAnswers]);
  const [explanation, setExplanation] = useState(question.explanation);
  const [category, setCategory] = useState(question.category);
  const [core, setCore] = useState(question.core);
  const [active, setActive] = useState(question.active);
  const [referenceUrl, setReferenceUrl] = useState(question.referenceUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const optionEntries = useMemo(() => Object.entries(options), [options]);

  function toggleAnswer(key: string) {
    if (type === "single") setAnswers([key]);
    else setAnswers((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }
  function addOption() {
    const key = "ABCDEFGHIJ".split("").find((item) => !(item in options));
    if (key) setOptions((current) => ({ ...current, [key]: "" }));
  }
  function removeOption(key: string) {
    if (optionEntries.length <= 2) return;
    setOptions((current) => Object.fromEntries(Object.entries(current).filter(([item]) => item !== key)));
    setAnswers((current) => current.filter((item) => item !== key));
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await api<{ question: AdminQuestion }>(`/api/admin/questions/${encodeURIComponent(question.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ number: number === "" ? null : Number(number), type, question: stem, options, correctAnswers: answers, explanation, category, core, active, referenceUrl })
      });
      onSaved(response.question);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setSaving(false); }
  }
  return <div className="modal-backdrop" role="presentation"><section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title"><header><div><p className="eyebrow">题目编辑</p><h2 id="editor-title">{question.number != null ? `题目 #${question.number}` : "自定义题目"}</h2></div><button className="icon-button" type="button" title="关闭编辑" onClick={onClose}><X size={20} /></button></header><form onSubmit={save}>
    <div className="editor-grid"><div><label className="field-label" htmlFor="edit-type">题型</label><select className="text-input" id="edit-type" value={type} onChange={(event) => { const value = event.target.value as "single" | "multiple"; setType(value); if (value === "single" && answers.length > 1) setAnswers(answers.slice(0, 1)); }}><option value="single">单选题</option><option value="multiple">多选题</option></select></div><div><label className="field-label" htmlFor="edit-number">原题编号</label><input className="text-input" id="edit-number" type="number" min="0" value={number} onChange={(event) => setNumber(event.target.value)} /></div><div className="span-two"><label className="field-label" htmlFor="edit-category">知识分类</label><input className="text-input" id="edit-category" value={category} onChange={(event) => setCategory(event.target.value)} required /></div></div>
    <label className="field-label" htmlFor="edit-question">题干</label><textarea className="text-area question-input" id="edit-question" value={stem} onChange={(event) => setStem(event.target.value)} required />
    <div className="editor-options-heading"><label className="field-label">选项与正确答案</label><button className="button secondary small" type="button" onClick={addOption} disabled={optionEntries.length >= 10}><Plus size={15} />添加选项</button></div>
    <div className="editor-option-list">{optionEntries.map(([key, text]) => <div key={key}><button className={`answer-key ${answers.includes(key) ? "selected" : ""}`} type="button" title={`设为正确答案 ${key}`} onClick={() => toggleAnswer(key)}>{key}</button><input className="text-input" value={text} onChange={(event) => setOptions((current) => ({ ...current, [key]: event.target.value }))} required /><button className="icon-button" type="button" title={`删除选项 ${key}`} onClick={() => removeOption(key)} disabled={optionEntries.length <= 2}><X size={16} /></button></div>)}</div>
    <label className="field-label" htmlFor="edit-explanation">答案解析</label><textarea className="text-area" id="edit-explanation" value={explanation} onChange={(event) => setExplanation(event.target.value)} />
    <label className="field-label" htmlFor="edit-reference">参考链接</label><input className="text-input" id="edit-reference" type="url" value={referenceUrl} onChange={(event) => setReferenceUrl(event.target.value)} />
    <div className="editor-checks"><label className="check-control"><input type="checkbox" checked={core} onChange={(event) => setCore(event.target.checked)} />核心题</label><label className="check-control"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />题目启用</label></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer><button className="button secondary" type="button" onClick={onClose}>取消</button><button className="button primary" type="submit" disabled={saving}><Save size={17} />{saving ? "保存中" : "保存题目"}</button></footer>
  </form></section></div>;
}

function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(search.trim()), 250); return () => window.clearTimeout(timer); }, [search]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await api<{ users: AdminUser[]; total: number }>(`/api/admin/users?${queryString({ search: debounced, limit: 100 })}`);
      setUsers(response.users); setTotal(response.total);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "用户加载失败"); }
    finally { setLoading(false); }
  }, [debounced]);
  useEffect(() => { void load(); }, [load]);

  async function updateUser(target: AdminUser, changes: Partial<Pick<AdminUser, "role" | "disabled">>) {
    setUpdating(target.id); setError("");
    try {
      const response = await api<{ user: Pick<AdminUser, "id" | "username" | "nickname" | "role" | "disabled"> }>(`/api/admin/users/${encodeURIComponent(target.id)}`, { method: "PATCH", body: JSON.stringify(changes) });
      setUsers((current) => current.map((item) => item.id === target.id ? { ...item, ...response.user } : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "用户更新失败"); }
    finally { setUpdating(""); }
  }

  return <section className="section-block admin-list-section">
    <div className="section-heading"><div><p className="eyebrow">账户权限</p><h2>注册用户 {total} 人</h2></div><button className="icon-button" type="button" title="刷新用户" onClick={() => void load()}><RefreshCw size={18} /></button></div>
    <div className="admin-toolbar"><div className="compact-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索用户名或昵称" aria-label="搜索用户" /></div></div>
    <div className="admin-notice"><AlertTriangle size={16} /><span>禁用用户后，其所有登录会话会立即失效；系统始终保留至少一个有效管理员。</span></div>
    {error && <ErrorState message={error} retry={() => void load()} />}
    {loading ? <LoadingState label="正在加载用户" /> : <div className="admin-user-list">{users.map((item) => {
      const self = item.id === currentUser?.id;
      return <div className={`admin-user-row ${item.disabled ? "disabled" : ""}`} key={item.id}><span className="user-admin-avatar">{(item.nickname || item.username).slice(0, 1).toUpperCase()}</span><span className="admin-user-main"><span><strong>{item.nickname || item.username}</strong><small className="account-username">@{item.username}</small>{self && <small>当前账户</small>}{item.disabled && <small className="disabled-tag">已禁用</small>}</span><small>答题 {item.attempts} 次 · 正确率 {item.accuracy}% · 错题 {item.activeMistakes} 道</small><small>注册于 {new Date(item.createdAt).toLocaleDateString("zh-CN")}</small></span><select value={item.role} aria-label={`${item.nickname || item.username}的角色`} disabled={self || updating === item.id} onChange={(event) => void updateUser(item, { role: event.target.value as AdminUser["role"] })}><option value="member">学习者</option><option value="admin">管理员</option></select><button className={`button small ${item.disabled ? "secondary" : "danger-text"}`} type="button" disabled={self || updating === item.id} onClick={() => void updateUser(item, { disabled: !item.disabled })}>{item.disabled ? <UserCheck size={16} /> : <UserX size={16} />}{updating === item.id ? "处理中" : item.disabled ? "启用" : "禁用"}</button></div>;
    })}{!users.length && <p className="empty-inline">没有符合条件的用户。</p>}</div>}
  </section>;
}
