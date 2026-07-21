import { useEffect, useState } from "react";

const THEMES = [
  { id: "daylight", name: "日光", dot: "#f2f3f5", ring: "#0891b2" },
  { id: "midnight", name: "暗夜", dot: "#0a0a0c", ring: "#22d3ee" },
  { id: "deepblue", name: "深蓝", dot: "#0c1322", ring: "#38bdf8" },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];

function currentTheme(): ThemeId {
  const t = localStorage.getItem("as-theme");
  return (THEMES.some((x) => x.id === t) ? t : "daylight") as ThemeId;
}

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeId>(currentTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("as-theme", theme);
  }, [theme]);

  return (
    <div className="flex items-center gap-1.5" title="切换主题">
      {THEMES.map((t) => (
        <button
          key={t.id}
          title={t.name}
          onClick={() => setTheme(t.id)}
          className="h-3.5 w-3.5 rounded-full border transition-transform hover:scale-110"
          style={{
            backgroundColor: t.dot,
            borderColor: t.ring,
            boxShadow: theme === t.id ? `0 0 0 2px ${t.ring}66` : "none",
          }}
        />
      ))}
    </div>
  );
}
