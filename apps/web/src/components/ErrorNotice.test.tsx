// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../api/client.js";
import { ErrorNotice } from "./ErrorNotice.js";

afterEach(() => {
  cleanup();
});

describe("ErrorNotice", () => {
  it("renders the error message with no retry control when none is offered", () => {
    render(<ErrorNotice error={new Error("git is unavailable")} />);

    expect(screen.getByRole("alert")).toHaveTextContent("git is unavailable");
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });

  it("offers a Retry control that invokes the supplied callback", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <ErrorNotice error={new Error("connection refused")} onRetry={onRetry} />,
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // R2-4, web half. The server now allowlists every loopback spelling, so a
  // forbidden_request should be unreachable -- but if one ever arrives, the
  // notice must name the fix instead of an internal security mechanism, and
  // must NOT offer a Retry that can only loop forever.
  it("turns a rejected request origin into an actionable message with a working link, not a Retry", () => {
    const onRetry = vi.fn();
    render(
      <ErrorNotice
        error={
          new ApiClientError(
            403,
            "forbidden_request",
            "Request origin or CSRF signal is invalid.",
          )
        }
        onRetry={onRetry}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/loopback/i);
    expect(alert).not.toHaveTextContent("CSRF");
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /127\.0\.0\.1/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("127.0.0.1"));
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("gives a rejected request host the same actionable treatment", () => {
    render(
      <ErrorNotice
        error={
          new ApiClientError(
            403,
            "forbidden_host",
            "Request host is not allowed.",
          )
        }
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/loopback/i);
    expect(screen.getByRole("link", { name: /127\.0\.0\.1/ })).toBeVisible();
  });

  it("falls back to a generic message for a non-Error rejection", () => {
    render(<ErrorNotice error="boom" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "An unexpected error occurred.",
    );
  });
});
