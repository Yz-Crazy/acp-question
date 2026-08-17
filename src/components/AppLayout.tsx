import { BookOpenCheck, CircleUserRound, House, LogOut, Search, Settings2, TriangleAlert } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";

const navItems = [
  { to: "/", label: "首页", icon: House, end: true },
  { to: "/library", label: "题库", icon: BookOpenCheck },
  { to: "/wrong", label: "错题", icon: TriangleAlert },
  { to: "/search", label: "搜索", icon: Search },
  { to: "/profile", label: "我的", icon: CircleUserRound }
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const displayName = user?.nickname || user?.username || "";
  const desktopNavItems = user?.role === "admin"
    ? [...navItems, { to: "/admin", label: "管理", icon: Settings2 }]
    : navItems;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark">题</span>
          <span><strong>题序</strong><small>ACP 练习台</small></span>
        </div>
        <nav className="side-nav" aria-label="主导航">
          {desktopNavItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={19} strokeWidth={1.9} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-account">
          <span className="avatar">{displayName.slice(0, 1).toUpperCase()}</span>
          <span className="side-account-details"><strong>{displayName}</strong><small>@{user?.username} · {user?.role === "admin" ? "管理员" : "学习者"}</small></span>
          <button className="icon-button side-logout" type="button" title="退出登录" aria-label="退出登录" onClick={() => void logout()}><LogOut size={17} /></button>
        </div>
      </aside>

      <div className="main-column">
        <header className="mobile-header">
          <div className="brand-lockup compact"><span className="brand-mark">题</span><strong>题序</strong></div>
          <div className="mobile-account"><span className="header-user">{displayName}</span><button className="icon-button" type="button" title="退出登录" aria-label="退出登录" onClick={() => void logout()}><LogOut size={17} /></button></div>
        </header>
        <main className="page-content"><Outlet /></main>
      </div>

      <nav className="bottom-nav" aria-label="移动端导航">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}>
            <Icon size={21} strokeWidth={1.9} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
