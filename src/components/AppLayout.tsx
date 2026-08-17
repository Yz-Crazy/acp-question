import { BookOpenCheck, CircleUserRound, House, Search, TriangleAlert } from "lucide-react";
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
  const { user } = useAuth();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark">题</span>
          <span><strong>题序</strong><small>ACP 练习台</small></span>
        </div>
        <nav className="side-nav" aria-label="主导航">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={19} strokeWidth={1.9} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-account">
          <span className="avatar">{user?.username.slice(0, 1).toUpperCase()}</span>
          <span><strong>{user?.username}</strong><small>{user?.role === "admin" ? "管理员" : "学习者"}</small></span>
        </div>
      </aside>

      <div className="main-column">
        <header className="mobile-header">
          <div className="brand-lockup compact"><span className="brand-mark">题</span><strong>题序</strong></div>
          <span className="header-user">{user?.username}</span>
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
