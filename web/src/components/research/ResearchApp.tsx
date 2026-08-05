import { useEffect, useState } from "react";
import type { ClientEvent } from "../../types";
import { loadPreferences, type AppPreferences } from "../../services/paperWorkspace";
import { AppNavigation } from "./AppNavigation";
import { LearningWorkspace } from "./LearningWorkspace";
import { DiscoverPage, HistoryPage, PaperDetailPage, SavedPage, SearchPage, SettingsPage } from "./ResearchPages";

interface Props { sendEvent: (event: ClientEvent) => boolean; }

const FALLBACK: AppPreferences = {
  colorMode: "system", themePreset: "minimal", accentColor: "#2f67d8", density: "comfortable", fontScale: 1,
  navPosition: "left", navDisplay: "labelled", readingLanguage: "chinese", contentWidth: "standard",
  providerArxiv: true, providerSemanticScholar: true, searchLimit: 12, personalizationEnabled: true,
  onboardingComplete: false, interests: [], translationTier: "medium", translationConcurrency: 3,
  translationScope: "current", translationPrompt: "", summaryPrompt: "",
};

function currentLocation(): string { return `${window.location.pathname}${window.location.search}`; }

function applyAppearance(preferences: AppPreferences): void {
  const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const resolved = preferences.themePreset === "dark" ? "dark" : preferences.colorMode === "system" ? (systemDark ? "dark" : "light") : preferences.colorMode;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.preset = preferences.themePreset;
  root.dataset.density = preferences.density;
  root.dataset.navPosition = preferences.navPosition;
  root.dataset.navDisplay = preferences.navDisplay;
  root.style.setProperty("--user-accent", preferences.accentColor);
  root.style.setProperty("--user-font-scale", String(preferences.fontScale));
}

export function ResearchApp({ sendEvent }: Props) {
  const [location, setLocation] = useState(currentLocation());
  const [preferences, setPreferences] = useState(FALLBACK);
  const [collapsed, setCollapsed] = useState(false);
  const path = location.split("?")[0];

  useEffect(() => {
    if (window.location.pathname === "/") {
      window.history.replaceState(null, "", "/discover");
      setLocation(currentLocation());
    }
    const onPop = () => setLocation(currentLocation());
    window.addEventListener("popstate", onPop);
    void loadPreferences().then((next) => { setPreferences(next); applyAppearance(next); }).catch(() => applyAppearance(FALLBACK));
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session");
    if (path === "/learning" && sessionId) sendEvent({ event: "open_session", sessionId });
  }, [location, path, sendEvent]);

  const navigate = (next: string) => {
    window.history.pushState(null, "", next);
    setLocation(currentLocation());
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const onPreferences = (next: AppPreferences) => { setPreferences(next); applyAppearance(next); };
  const pageProps = { navigate, preferences, onPreferences };

  let content;
  if (path === "/discover") content = <DiscoverPage {...pageProps} />;
  else if (path === "/search") content = <SearchPage {...pageProps} />;
  else if (path === "/saved") content = <SavedPage {...pageProps} />;
  else if (path === "/history") content = <HistoryPage {...pageProps} />;
  else if (path === "/settings") content = <SettingsPage {...pageProps} />;
  else if (path.startsWith("/paper/")) content = <PaperDetailPage {...pageProps} />;
  else if (path === "/learning") content = <LearningWorkspace sendEvent={sendEvent} navigate={navigate} />;
  else content = <DiscoverPage {...pageProps} />;

  return <div className={`research-app nav-${preferences.navPosition}${collapsed ? " nav-collapsed" : ""}`}>
    <AppNavigation path={path} preferences={preferences} collapsed={collapsed} onCollapse={() => setCollapsed((value) => !value)} navigate={navigate} />
    <div className="research-main">{content}</div>
  </div>;
}
