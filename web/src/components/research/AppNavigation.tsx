import { Bookmark, Clock3, Compass, GraduationCap, PanelLeftClose, PanelLeftOpen, Search, Settings } from "lucide-react";
import type { AppPreferences } from "../../services/paperWorkspace";

interface Props {
  path: string;
  preferences: AppPreferences;
  collapsed: boolean;
  onCollapse: () => void;
  navigate: (path: string) => void;
}

const ITEMS = [
  { path: "/discover", label: "发现", icon: Compass },
  { path: "/search", label: "搜索", icon: Search },
  { path: "/saved", label: "收藏", icon: Bookmark },
  { path: "/learning", label: "学习", icon: GraduationCap },
  { path: "/history", label: "历史", icon: Clock3 },
];

export function AppNavigation({ path, preferences, collapsed, onCollapse, navigate }: Props) {
  const iconsOnly = collapsed || preferences.navDisplay === "icons";
  return (
    <aside className={`research-nav nav-${preferences.navPosition}${iconsOnly ? " is-collapsed" : ""}`}>
      <button className="research-brand" type="button" onClick={() => navigate("/discover")} title="返回发现">
        <span className="research-brand-mark">M</span>
        {!iconsOnly && <span><strong>MoeReview</strong><small>Paper Discovery</small></span>}
      </button>
      <nav aria-label="主导航">
        {ITEMS.map((item) => {
          const active = path === item.path || (item.path === "/discover" && path.startsWith("/paper/"));
          return <button type="button" key={item.path} className={active ? "active" : ""} onClick={() => navigate(item.path)} title={iconsOnly ? item.label : undefined}><item.icon size={19} /><span>{item.label}</span></button>;
        })}
      </nav>
      <div className="research-nav-foot">
        <button type="button" className={path === "/settings" ? "active" : ""} onClick={() => navigate("/settings")} title={iconsOnly ? "设置" : undefined}><Settings size={19} /><span>设置</span></button>
        <button type="button" className="research-collapse" onClick={onCollapse} title={collapsed ? "展开导航" : "收起导航"}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}<span>{collapsed ? "展开" : "收起"}</span></button>
      </div>
    </aside>
  );
}
