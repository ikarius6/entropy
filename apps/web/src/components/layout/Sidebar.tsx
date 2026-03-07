import { Link, useLocation } from "react-router-dom";
import { Home, Upload, User, Settings as SettingsIcon, HelpCircle } from "lucide-react";
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
    { name: "How It Works", path: "/how-it-works", icon: HelpCircle },
    { name: "Settings", path: "/settings", icon: SettingsIcon },
  ];

  return (
    <aside className="w-64 flex flex-col gap-6 pt-4 pr-6 border-r border-border sticky top-[5rem] h-[calc(100vh-5rem)] overflow-y-auto">
      <nav className="flex flex-col gap-2">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path || 
            (item.path !== "/" && location.pathname.startsWith(item.path));
          
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                isActive 
                  ? "bg-primary/10 text-primary font-medium" 
                  : "text-muted hover:bg-white/5 hover:text-white"
              }`}
            >
              <item.icon size={20} className={isActive ? "text-primary" : "text-muted"} />
              {item.name}
            </Link>
          );
        })}
      </nav>
      
      <div className="mt-auto panel p-4 mb-4 bg-background/50">
        <div className="text-sm font-medium mb-2 text-white">Credits</div>
        <div className="flex items-baseline gap-2">
          {isLoading ? (
            <span className="text-sm text-muted">Loading…</span>
          ) : (
            <>
              <span className="text-2xl font-bold text-accent">{credits.value}</span>
              <span className="text-xs text-muted">{credits.unit}</span>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
