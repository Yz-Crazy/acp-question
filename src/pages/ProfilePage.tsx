import { ArrowRight, Check, Copy, KeyRound, LockKeyhole, LogOut, Plus, Save, Settings2, ShieldCheck, UserRound } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { api } from "../api";
import { ErrorState, LoadingState } from "../components/States";
import type { Stats, User } from "../types";

interface Invite { code: string; maxUses: number; useCount: number; expiresAt: string; createdAt: string }

export function ProfilePage() {
  const { user, logout, refreshUser } = useAuth();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState("");
  const [username, setUsername] = useState(user?.username ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [inviteData, statsData] = await Promise.all([api<{ invites: Invite[] }>("/api/invites"), api<Stats>("/api/stats")]);
      setInvites(inviteData.invites); setStats(statsData);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "加载失败"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setUsername(user?.username ?? ""); }, [user?.username]);

  async function createInvite() {
    setCreating(true); setError("");
    try {
      const response = await api<{ invite: Invite }>("/api/invites", { method: "POST" });
      setInvites((current) => [response.invite, ...current]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "生成失败"); }
    finally { setCreating(false); }
  }

  async function copy(code: string) {
    await navigator.clipboard.writeText(code);
    setCopied(code);
    window.setTimeout(() => setCopied(""), 1500);
  }

  async function saveUsername(event: FormEvent) {
    event.preventDefault();
    setSavingName(true); setNameMessage("");
    try {
      await api<{ user: User }>("/api/account", { method: "PATCH", body: JSON.stringify({ username }) });
      await refreshUser();
      setNameMessage("用户名已更新");
    } catch (reason) { setNameMessage(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setSavingName(false); }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordMessage("");
    if (newPassword !== confirmPassword) { setPasswordMessage("两次输入的新密码不一致"); return; }
    setSavingPassword(true);
    try {
      await api("/api/account", { method: "PATCH", body: JSON.stringify({ currentPassword, newPassword }) });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setPasswordMessage("密码已更新，其他设备已退出登录");
    } catch (reason) { setPasswordMessage(reason instanceof Error ? reason.message : "修改失败"); }
    finally { setSavingPassword(false); }
  }

  return (
    <div className="page profile-page">
      <header className="page-heading"><div><p>账户、安全与邀请管理</p><h1>我的</h1></div></header>
      {error && <ErrorState message={error} retry={() => void load()} />}
      {!stats ? <LoadingState /> : <>
        <section className="profile-summary">
          <span className="profile-avatar"><UserRound size={31} /></span>
          <div><h2>{user?.username}</h2><p><ShieldCheck size={15} />{user?.role === "admin" ? "管理员账户" : "学习者账户"}</p></div>
          <dl><div><dt>累计答题</dt><dd>{stats.attempts}</dd></div><div><dt>练习题目</dt><dd>{stats.practiced}</dd></div><div><dt>正确率</dt><dd>{stats.accuracy}%</dd></div></dl>
        </section>

        {user?.role === "admin" && <Link className="admin-entry" to="/admin"><span><Settings2 size={21} /></span><span><strong>系统管理</strong><small>更新题库、管理用户与权限</small></span><ArrowRight size={18} /></Link>}

        <section className="section-block">
          <div className="section-heading"><div><p className="eyebrow">账户设置</p><h2>资料与密码</h2></div></div>
          <div className="account-settings">
            <form className="settings-form" onSubmit={saveUsername}>
              <div className="settings-form-title"><UserRound size={19} /><span><strong>用户名</strong><small>用于登录和个人显示</small></span></div>
              <label className="field-label" htmlFor="profile-username">用户名</label>
              <input className="text-input" id="profile-username" value={username} onChange={(event) => setUsername(event.target.value)} required />
              {nameMessage && <p className={nameMessage.includes("已更新") ? "form-success" : "form-error"} role="status">{nameMessage}</p>}
              <button className="button secondary small" type="submit" disabled={savingName || username === user?.username}><Save size={16} />{savingName ? "保存中" : "保存用户名"}</button>
            </form>
            <form className="settings-form" onSubmit={savePassword}>
              <div className="settings-form-title"><LockKeyhole size={19} /><span><strong>登录密码</strong><small>修改后其他设备将退出登录</small></span></div>
              <label className="field-label" htmlFor="current-password">当前密码</label>
              <input className="text-input" id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
              <div className="password-grid"><div><label className="field-label" htmlFor="new-password">新密码</label><input className="text-input" id="new-password" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></div><div><label className="field-label" htmlFor="confirm-password">确认新密码</label><input className="text-input" id="confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></div></div>
              {passwordMessage && <p className={passwordMessage.includes("已更新") ? "form-success" : "form-error"} role="status">{passwordMessage}</p>}
              <button className="button secondary small" type="submit" disabled={savingPassword}><LockKeyhole size={16} />{savingPassword ? "修改中" : "修改密码"}</button>
            </form>
          </div>
        </section>

        <section className="section-block invite-section">
          <div className="section-heading"><div><p className="eyebrow">邀请注册</p><h2>我的邀请码</h2></div><button className="button primary small" type="button" onClick={() => void createInvite()} disabled={creating}><Plus size={16} />{creating ? "生成中" : "生成邀请码"}</button></div>
          <div className="invite-list">
            {invites.map((invite) => {
              const used = invite.useCount >= invite.maxUses;
              return <div className="invite-row" key={invite.code}><span className="invite-icon"><KeyRound size={18} /></span><span><strong>{invite.code}</strong><small>{used ? "已使用" : `有效期至 ${new Date(invite.expiresAt).toLocaleDateString("zh-CN")}`}</small></span><button type="button" className="icon-button" title="复制邀请码" disabled={used} onClick={() => void copy(invite.code)}>{copied === invite.code ? <Check size={18} /> : <Copy size={18} />}</button></div>;
            })}
            {!invites.length && <p className="empty-inline">还没有生成过邀请码。每个邀请码仅可注册一个账户。</p>}
          </div>
        </section>
        <section className="account-actions"><button className="button danger-text" type="button" onClick={() => void logout()}><LogOut size={18} />退出登录</button></section>
      </>}
    </div>
  );
}
