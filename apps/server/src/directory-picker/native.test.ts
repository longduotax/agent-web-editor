import { describe, expect, it, vi } from "vitest";

import {
  createNativeDirectoryPicker,
  type PickerCommandRunner,
} from "./native.js";

function runnerWithOutput(stdout: string): PickerCommandRunner {
  return vi.fn<PickerCommandRunner>().mockResolvedValue({ stdout });
}

describe("native directory picker", () => {
  it("parses a macOS selection without invoking a shell", async () => {
    const runner = runnerWithOutput(
      JSON.stringify("/Users/example/π\nproject"),
    );
    const picker = createNativeDirectoryPicker("darwin", runner);

    await expect(picker.chooseDirectory()).resolves.toBe(
      "/Users/example/π\nproject",
    );
    expect(runner).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      expect.arrayContaining(["-l", "JavaScript"]),
      expect.objectContaining({ shell: false, maxBuffer: 16 * 1024 }),
    );
  });

  it("parses a Windows selection without invoking a shell", async () => {
    const path = String.raw`C:\Users\Example\project`;
    const runner = runnerWithOutput(JSON.stringify(path));
    const picker = createNativeDirectoryPicker("win32", runner);

    await expect(picker.chooseDirectory()).resolves.toBe(path);
    expect(runner).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining(["-STA", "-Command"]),
      expect.objectContaining({ shell: false, windowsHide: true }),
    );
  });

  it.each(["darwin", "win32"] as const)(
    "treats a null %s result as cancellation",
    async (platform) => {
      const picker = createNativeDirectoryPicker(
        platform,
        runnerWithOutput("null"),
      );
      await expect(picker.chooseDirectory()).resolves.toBeNull();
    },
  );

  it.each([
    ["malformed JSON", "not-json"],
    ["a wrong JSON type", "42"],
    ["a relative path", JSON.stringify("relative/project")],
    ["a path containing NUL", JSON.stringify("/tmp/a\0b")],
    ["oversized output", JSON.stringify(`/tmp/${"a".repeat(17_000)}`)],
  ])("maps %s to a safe picker failure", async (_label, stdout) => {
    const picker = createNativeDirectoryPicker(
      "darwin",
      runnerWithOutput(stdout),
    );
    await expect(picker.chooseDirectory()).rejects.toThrow(
      "directory_picker_failed",
    );
  });

  it("maps process failures without exposing their diagnostics", async () => {
    const runner = vi
      .fn<PickerCommandRunner>()
      .mockRejectedValue(new Error("secret native stderr and /private/path"));
    const picker = createNativeDirectoryPicker("darwin", runner);

    await expect(picker.chooseDirectory()).rejects.toThrow(
      "directory_picker_failed",
    );
  });

  it("rejects unsupported platforms before running a command", async () => {
    const runner = runnerWithOutput("null");
    const picker = createNativeDirectoryPicker("linux", runner);

    await expect(picker.chooseDirectory()).rejects.toThrow(
      "directory_picker_unsupported",
    );
    expect(runner).not.toHaveBeenCalled();
  });
});
