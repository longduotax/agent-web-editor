import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App.js";
import { shouldRetryRequest } from "./api/client.js";
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
    // One policy, stated once, and unit-tested where it lives: a client error
    // and a timeout go straight to the view's error state, and everything
    // else is retried twice (H5, H6).
    queries: { retry: shouldRetryRequest },
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
