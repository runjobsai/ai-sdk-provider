import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { RunJobsProviderScope } from "./runjobs";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RunJobsProviderScope>
      <App />
    </RunJobsProviderScope>
  </StrictMode>,
);
