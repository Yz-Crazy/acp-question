import { Check, Copy, KeyRound, LogOut, Plus, ShieldCheck, UserRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth";
import { api } from "../api";
import { ErrorState, LoadingState } from "../components/States";
import type { Stats } from "../types";

interface Invite { code: string; maxUses: number; useCount: number; expiresAt: string; createdAt: string }

export function ProfilePage() {
  const { user, logout } = useAuth();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const [inviteData, statsData] = await Promise.all([api<{ invites: Invite[] }>("/api/invites"), api<Stats>("/api/stats")]);
      setInvites(inviteData.invites); setStats(statsData);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "加载失败"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

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

  return (
    <div className="page profile-page">
      <header className="page-heading"><div><p>账户与邀请管理</p><h1>我的</h1></div></header>
      {error && <ErrorState message={error} retry={() => void load()} />}
      {!stats ? <LoadingState /> : <>
        <section className="profile-summary">
          <span className="profile-avatar"><UserRound size={31} /></span>
          <div><h2>{user?.username}</h2><p><ShieldCheck size={15} />{user?.role === "admin" ? "管理员账户" : "学习者账户"}</p></div>
          <dl><div><dt>累计答题</dt><dd>{stats.attempts}</dd></div><div><dt>练习题目</dt><dd>{stats.practiced}</dd></div><div><dt>正确率</dt><dd>{stats.accuracy}%</dd></div></dl>
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
