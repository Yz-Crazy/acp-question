import { ArrowRight, LockKeyhole, LogOut, Save, Settings2, ShieldCheck, UserRound } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { api } from "../api";
import { ErrorState, LoadingState } from "../components/States";
import type { Stats, User } from "../types";

export function ProfilePage() {
  const { user, logout, refreshUser } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [nickname, setNickname] = useState(user?.nickname ?? "");
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
      setStats(await api<Stats>("/api/stats"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "加载失败"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setNickname(user?.nickname ?? ""); }, [user?.nickname]);

  async function saveNickname(event: FormEvent) {
    event.preventDefault();
    setSavingName(true); setNameMessage("");
    try {
      await api<{ user: User }>("/api/account", { method: "PATCH", body: JSON.stringify({ nickname }) });
      await refreshUser();
      setNameMessage("昵称已更新");
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
      <header className="page-heading"><div><p>账户资料与登录安全</p><h1>我的</h1></div></header>
      {error && <ErrorState message={error} retry={() => void load()} />}
      {!stats ? <LoadingState /> : <>
        <section className="profile-summary">
          <span className="profile-avatar"><UserRound size={31} /></span>
          <div><h2>{user?.nickname || user?.username}</h2><small className="profile-username">@{user?.username}</small><p><ShieldCheck size={15} />{user?.role === "admin" ? "管理员账户" : "学习者账户"}</p></div>
          <dl><div><dt>累计答题</dt><dd>{stats.attempts}</dd></div><div><dt>练习题目</dt><dd>{stats.practiced}</dd></div><div><dt>正确率</dt><dd>{stats.accuracy}%</dd></div></dl>
        </section>

        {user?.role === "admin" && <Link className="admin-entry" to="/admin"><span><Settings2 size={21} /></span><span><strong>系统管理</strong><small>更新题库、模拟套卷、注册码与用户权限</small></span><ArrowRight size={18} /></Link>}

        <section className="section-block">
          <div className="section-heading"><div><p className="eyebrow">账户设置</p><h2>资料与密码</h2></div></div>
          <div className="account-settings">
            <form className="settings-form" onSubmit={saveNickname}>
              <div className="settings-form-title"><UserRound size={19} /><span><strong>个人资料</strong><small>登录用户名不可修改，昵称用于站内显示</small></span></div>
              <label className="field-label" htmlFor="profile-username">登录用户名</label>
              <input className="text-input readonly-input" id="profile-username" value={user?.username ?? ""} readOnly aria-readonly="true" />
              <label className="field-label" htmlFor="profile-nickname">昵称</label>
              <input className="text-input" id="profile-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={30} required />
              {nameMessage && <p className={nameMessage.includes("已更新") ? "form-success" : "form-error"} role="status">{nameMessage}</p>}
              <button className="button secondary small" type="submit" disabled={savingName || nickname.trim() === user?.nickname}><Save size={16} />{savingName ? "保存中" : "保存昵称"}</button>
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

      </>}
      <section className="account-actions"><button className="button danger-text" type="button" onClick={() => void logout()}><LogOut size={18} />退出登录</button></section>
    </div>
  );
}
