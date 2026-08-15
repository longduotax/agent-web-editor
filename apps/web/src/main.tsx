import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App.js";
import "./styles.css";

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
