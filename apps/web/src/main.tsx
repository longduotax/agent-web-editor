import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App.js";
import "./styles.css";

// Keys belonging to features that no longer exist. They can never be read or
// written again, so leaving them behind is dead state that outlives every
// explanation of what it was (NEW-R3-5). Removal is idempotent and
// best-effort: a browser with storage disabled simply keeps them.
const RETIRED_STORAGE_KEYS = [
  // The standalone Environment panel, removed by UX-1 / D-1.
  "pi-workspace:environment",
];
try {
  for (const key of RETIRED_STORAGE_KEYS) localStorage.removeItem(key);
} catch {
  // Local preferences are best-effort.
}

const rootElement = document.querySelector("#root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error("Missing #root element");
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) =>
        !(
          error instanceof Error &&
          "status" in error &&
          error.status === 401
        ) && count < 2,
    },
    mutations: { retry: false },
  },
});

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
