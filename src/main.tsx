import React from "react";
import ReactDOM from "react-dom/client";
import { isNativePlatform, onPlatformAdapterChange } from "@/core/platform";
import App from "./App";
import "./styles/index.css";

const syncDisplayMode = () => {
  const isStandalone =
    isNativePlatform() ||
    !!(window as unknown as Record<string, unknown>).Capacitor ||
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari PWA fallback.
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true;

  document.documentElement.dataset.displayMode = isStandalone
    ? "standalone"
    : "browser";
};

syncDisplayMode();
onPlatformAdapterChange(syncDisplayMode);
const displayModeQuery = window.matchMedia("(display-mode: standalone)");
if (typeof displayModeQuery.addEventListener === "function") {
  displayModeQuery.addEventListener("change", syncDisplayMode);
} else {
  displayModeQuery.onchange = syncDisplayMode;
}

if ("serviceWorker" in navigator && !isNativePlatform()) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
