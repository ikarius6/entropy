import { Link, useLocation } from "react-router-dom";
import { Home, Upload, User, Settings as SettingsIcon, HelpCircle, History } from "lucide-react";
import { useCredits } from "../../hooks/useCredits";

function formatCredits(bytes: number): { value: string; unit: string } {
  // Clamp to zero – race conditions can briefly produce a negative balance;
  // showing "-99999 B" is confusing and alarming to users.
  const b = Math.max(0, bytes);
  if (b >= 1024 * 1024 * 1024) {
    return { value: (b / (1024 * 1024 * 1024)).toFixed(1), unit: "GB" };
  }
  if (b >= 1024 * 1024) {
    return { value: (b / (1024 * 1024)).toFixed(1), unit: "MB" };
  }
  if (b >= 1024) {
    return { value: (b / 1024).toFixed(1), unit: "KB" };
  }
  return { value: String(b), unit: "B" };
}

export function Sidebar() {
  const location = useLocation();
  const { summary, isLoading } = useCredits();
  const credits = formatCredits(summary?.balance ?? 0);

  const navItems = [
    { name: "Home", path: "/", icon: Home },
    { name: "Publish", path: "/publish", icon: Upload },
    { name: "Profile", path: "/profile/me", icon: User },
    { name: "Credit History", path: "/credits", icon: History },
    { name: "How It Works", path: "/how-it-works", icon: HelpCircle },
    { name: "Settings", path: "/settings", icon: SettingsIcon },
  ];

  return (
    <aside className="app-sidebar flex flex-col gap-6 md:sticky md:top-[56px] md:h-[calc(100vh-56px)] md:overflow-y-auto md:self-start">
      <nav className="grid grid-cols-2 gap-2 md:flex md:flex-col md:gap-1.5">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path || 
            (item.path !== "/" && location.pathname.startsWith(item.path));
          
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`sidebar-link ${
                isActive 
                  ? "sidebar-link--active font-medium" 
                  : ""
              }`}
            >
              <item.icon size={18} className={isActive ? "text-primary" : "text-muted"} />
              <span className="truncate text-[0.95rem]">{item.name}</span>
            </Link>
          );
        })}
      </nav>
      
      <Link to="/credits" className="surface-subtle mt-1 md:mt-auto md:mb-4 px-4 py-4 block hover:ring-1 hover:ring-primary/30 transition-shadow rounded-lg">
        <div className="mb-1 text-[0.78rem] font-medium text-muted">Credits</div>
        <div className="flex items-baseline gap-2">
          {isLoading ? (
            <span className="text-sm text-muted">Loading…</span>
          ) : (
            <>
              <span className="text-[1.65rem] font-semibold text-primary">{credits.value}</span>
              <span className="text-xs text-muted">{credits.unit}</span>
            </>
          )}
        </div>
        <div className="mt-2 text-xs text-muted">Available balance — View history →</div>
      </Link>
    </aside>
  );
}
