import { ArrowRight, BookOpenCheck, Check, KeyRound, LockKeyhole, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";

export function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "login") await login(username, password);
      else await register(username, password, inviteCode);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="brand-lockup auth-brand"><span className="brand-mark">题</span><span><strong>题序</strong><small>ACP 练习台</small></span></div>
        <div className="auth-message">
          <span className="eyebrow"><BookOpenCheck size={15} />掌握每一道核心题</span>
          <h1>刷题有序，复习有据</h1>
          <p>按核心题库、题型和知识分类练习，答错自动归档，按遗忘节奏重新掌握。</p>
          <div className="auth-points" aria-hidden="true">
            <span><Check size={15} />分类练习</span><span><Check size={15} />错题追踪</span><span><Check size={15} />学习统计</span>
          </div>
        </div>
      </section>

      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <div className="segmented wide" aria-label="登录或注册">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>登录</button>
            <button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); }}>注册</button>
          </div>
          <div className="form-heading">
            <h2>{mode === "login" ? "欢迎回来" : "创建学习账户"}</h2>
            <p>{mode === "login" ? "继续上次的学习进度" : "注册需要一个有效邀请码"}</p>
          </div>
          <label className="field-label" htmlFor="username">用户名</label>
          <div className="input-with-icon"><UserRound size={18} /><input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="3-20 位字符" required /></div>
          <label className="field-label" htmlFor="password">密码</label>
          <div className="input-with-icon"><LockKeyhole size={18} /><input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" required /></div>
          {mode === "register" && <>
            <label className="field-label" htmlFor="invite">邀请码</label>
            <div className="input-with-icon"><KeyRound size={18} /><input id="invite" value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} placeholder="ACP-XXXXX-XXXXX" required /></div>
          </>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button primary submit-button" type="submit" disabled={submitting}>
            {submitting ? "正在处理..." : mode === "login" ? "登录" : "注册并开始"}<ArrowRight size={18} />
          </button>
        </form>
      </section>
    </main>
  );
}
