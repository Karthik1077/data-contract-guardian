import { IconClock, IconMoon, IconShield, IconSun } from "./Icons";

export type Theme = "dark" | "light";

interface Props {
  theme: Theme;
  historyCount: number;
  onToggleTheme: () => void;
  onOpenHistory: () => void;
}

export default function Header({ theme, historyCount, onToggleTheme, onOpenHistory }: Props) {
  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <div className="brand">
          <span className="logo">
            <IconShield size={20} />
          </span>
          <span className="brand-name">Contract Guardian</span>
        </div>
        <div className="nav-actions">
          <button type="button" className="ghost" onClick={onOpenHistory}>
            <IconClock size={16} />
            History
            {historyCount > 0 && <span className="count">{historyCount}</span>}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <IconSun size={17} /> : <IconMoon size={17} />}
          </button>
        </div>
      </div>
    </header>
  );
}
