import { Link, useLocation } from "react-router-dom";
import { Home, Upload, User, Settings as SettingsIcon } from "lucide-react";

export function Sidebar() {
  const location = useLocation();

  const navItems = [
    { name: "Home", path: "/", icon: Home },
    { name: "Upload", path: "/upload", icon: Upload },
    { name: "Profile", path: "/profile/me", icon: User },
    { name: "Settings", path: "/settings", icon: SettingsIcon },
  ];

  return (
    <aside className="w-64 flex flex-col gap-6 pt-4 pr-6 border-r border-border min-h-[calc(100vh-5rem)]">
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
          <span className="text-2xl font-bold text-accent">1.2</span>
          <span className="text-xs text-muted">GB</span>
        </div>
      </div>
    </aside>
  );
}
