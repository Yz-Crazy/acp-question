import { AlertTriangle, BookMarked, BookOpenCheck, Check, CheckCircle2, Copy, FileCheck2, FileJson, KeyRound, Pencil, Plus, RefreshCw, Save, Search, UploadCloud, UserCheck, Users, UserX, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, queryString } from "../api";
import { useAuth } from "../auth";
import { ErrorState, LoadingState } from "../components/States";
import { parseQuestionSource } from "../lib/questionImport";
import type { AdminQuestion, AdminUser, MockExamTemplate, RegistrationCode } from "../types";

export function AdminPage() {
  const [tab, setTab] = useState<"questions" | "mock" | "codes" | "users">("questions");
  return (
    <div className="page admin-page">
      <header className="page-heading"><div><p>题库、套卷、注册码与用户权限</p><h1>系统管理</h1></div></header>
      <div className="segmented admin-tabs" aria-label="管理内容">
        <button type="button" className={tab === "questions" ? "active" : ""} onClick={() => setTab("questions")}><BookOpenCheck size={16} />题库管理</button>
        <button type="button" className={tab === "mock" ? "active" : ""} onClick={() => setTab("mock")}><FileCheck2 size={16} />模拟套卷</button>
        <button type="button" className={tab === "codes" ? "active" : ""} onClick={() => setTab("codes")}><KeyRound size={16} />注册码</button>
        <button type="button" className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}><Users size={16} />用户管理</button>
      </div>
      {tab === "questions" ? <QuestionManagement /> : tab === "mock" ? <MockTemplateManagement /> : tab === "codes" ? <RegistrationCodeManagement /> : <UserManagement />}
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

function MockTemplateManagement() {
  const [templates, setTemplates] = useState<MockExamTemplate[]>([]);
  const [slot, setSlot] = useState(1);
  const [title, setTitle] = useState("ACP 模拟题第 1 套");
  const [pending, setPending] = useState<unknown[]>([]);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async (clearMessage = true) => {
    setLoading(true);
    if (clearMessage) setMessage("");
    try {
      const response = await api<{ templates: MockExamTemplate[] }>("/api/admin/mock-templates");
      setTemplates(response.templates);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "套卷加载失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function chooseSlot(nextSlot: number) {
    setSlot(nextSlot);
    setTitle(templates.find((item) => item.slot === nextSlot)?.title ?? `ACP 模拟题第 ${nextSlot} 套`);
  }

  async function chooseFile(file?: File) {
    if (!file) return;
    setMessage("");
    try {
      const parsed = parseQuestionSource(await file.text());
      const counts = parsed.reduce<{ single: number; multiple: number }>((current, value) => {
        const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
        const type = String(record.t ?? record.type ?? "");
        if (type === "单选题" || type === "single") current.single += 1;
        if (type === "多选题" || type === "multiple") current.multiple += 1;
        return current;
      }, { single: 0, multiple: 0 });
      if (parsed.length !== 75 || counts.single !== 50 || counts.multiple !== 25) {
        throw new Error(`套卷必须包含 50 道单选和 25 道多选，当前识别 ${counts.single} 道单选、${counts.multiple} 道多选`);
      }
      setPending(parsed); setFileName(file.name);
    } catch (reason) {
      setPending([]); setFileName("");
      setMessage(reason instanceof Error ? reason.message : "套卷文件解析失败");
    }
  }

  async function upload() {
    if (!pending.length || !title.trim()) return;
    setUploading(true); setMessage("");
    try {
      await api(`/api/admin/mock-templates/${slot}`, {
        method: "PUT", body: JSON.stringify({ title, questions: pending })
      });
      setMessage(`第 ${slot} 套模拟题已更新`); setPending([]); setFileName("");
      await load(false);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "套卷上传失败"); }
    finally { setUploading(false); }
  }

  return <>
    <section className="admin-import-band mock-template-upload">
      <div className="import-copy"><span className="admin-section-icon"><UploadCloud size={22} /></span><span><strong>上传固定模拟套卷</strong><small>每套必须包含 50 道单选题和 25 道多选题，文件字段与题库导入格式一致</small></span></div>
      <div className="mock-upload-fields"><div><label className="field-label" htmlFor="mock-slot">套卷编号</label><select className="text-input" id="mock-slot" value={slot} onChange={(event) => chooseSlot(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>第 {value} 套</option>)}</select></div><div><label className="field-label" htmlFor="mock-title">套卷名称</label><input className="text-input" id="mock-title" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} /></div></div>
      <div className="import-actions"><label className="button secondary small file-button"><FileJson size={16} />选择套卷文件<input type="file" accept=".json,.md,.txt,application/json" onChange={(event) => void chooseFile(event.target.files?.[0])} /></label>{pending.length > 0 && <button className="button primary small" type="button" onClick={() => void upload()} disabled={uploading || !title.trim()}>{uploading ? "上传中" : `更新第 ${slot} 套`}</button>}</div>
      {pending.length > 0 && <div className="import-preview"><span><CheckCircle2 size={16} /><strong>{fileName}</strong> · 75 道题已校验</span></div>}
      {message && <p className={message.includes("已更新") ? "form-success" : "form-error"} role="status">{message}</p>}
    </section>
    <section className="section-block admin-list-section"><div className="section-heading"><div><p className="eyebrow">固定套卷</p><h2>6 个模拟题槽位</h2></div><button className="icon-button" type="button" title="刷新套卷" onClick={() => void load()}><RefreshCw size={18} /></button></div>{loading ? <LoadingState label="正在加载模拟套卷" /> : <div className="admin-template-list">{[1, 2, 3, 4, 5, 6].map((value) => {
      const template = templates.find((item) => item.slot === value);
      return <button type="button" key={value} className={slot === value ? "selected" : ""} onClick={() => chooseSlot(value)}><span>{String(value).padStart(2, "0")}</span><span><strong>{template?.title ?? `第 ${value} 套尚未上传`}</strong><small>{template ? `75 道题 · 更新于 ${new Date(template.updatedAt).toLocaleDateString("zh-CN")}` : "选择此槽位后上传套卷文件"}</small></span><span className={`question-state ${template ? "active" : ""}`}>{template ? "已上传" : "空槽位"}</span></button>;
    })}</div>}</section>
  </>;
}

function RegistrationCodeManagement() {
  const [codes, setCodes] = useState<RegistrationCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setCodes((await api<{ registrationCodes: RegistrationCode[] }>("/api/admin/registration-codes")).registrationCodes); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "注册码加载失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function createCode() {
    setCreating(true); setError("");
    try {
      const response = await api<{ registrationCode: RegistrationCode }>("/api/admin/registration-codes", { method: "POST" });
      setCodes((current) => [response.registrationCode, ...current]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "注册码生成失败"); }
    finally { setCreating(false); }
  }

  async function copy(code: string) {
    await navigator.clipboard.writeText(code);
    setCopied(code); window.setTimeout(() => setCopied(""), 1500);
  }

  return <section className="section-block admin-list-section registration-code-management">
    <div className="section-heading"><div><p className="eyebrow">注册权限</p><h2>注册码</h2></div><button className="button primary small" type="button" onClick={() => void createCode()} disabled={creating}><Plus size={16} />{creating ? "生成中" : "生成注册码"}</button></div>
    <div className="admin-notice"><AlertTriangle size={16} /><span>只有管理员可以生成注册码；每个注册码仅能注册一个账户，有效期为 30 天。</span></div>
    {error && <ErrorState message={error} retry={() => void load()} />}
    {loading ? <LoadingState label="正在加载注册码" /> : <div className="invite-list">{codes.map((code) => {
      const used = Boolean(code.disabled) || code.useCount >= code.maxUses;
      return <div className="invite-row" key={code.code}><span className="invite-icon"><KeyRound size={18} /></span><span><strong>{code.code}</strong><small>{used ? "已使用" : `有效期至 ${new Date(code.expiresAt).toLocaleDateString("zh-CN")}`} · {code.createdBy}生成</small></span><button type="button" className="icon-button" title="复制注册码" disabled={used} onClick={() => void copy(code.code)}>{copied === code.code ? <Check size={18} /> : <Copy size={18} />}</button></div>;
    })}{!codes.length && <p className="empty-inline">还没有注册码。</p>}</div>}
  </section>;
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
