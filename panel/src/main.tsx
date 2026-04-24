import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Title reflects the host so localhost vs LAN vs Tailscale sessions are
// visually distinct in the browser tab.
document.title = window.location.hostname;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
