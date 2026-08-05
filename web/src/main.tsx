import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import "./index.css";
import "./design-system.css";
import "./research.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Toaster position="top-center" richColors />
  </StrictMode>,
);
