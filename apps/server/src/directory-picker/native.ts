import { execFile } from "node:child_process";
import { posix, win32 } from "node:path";

import { z } from "zod";

const MAX_PICKER_OUTPUT_BYTES = 16 * 1024;
const PICKER_TIMEOUT_MS = 10 * 60 * 1_000;

const pickerOutputSchema = z.union([
  z.null(),
  z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => !value.includes("\0")),
]);

export interface DirectoryPicker {
  chooseDirectory(): Promise<string | null>;
}

interface PickerCommandOptions {
  encoding: "utf8";
  maxBuffer: number;
  shell: false;
  timeout: number;
  windowsHide: true;
}

export type PickerCommandRunner = (
  file: string,
  arguments_: string[],
  options: PickerCommandOptions,
) => Promise<{ stdout: string }>;

const runPickerCommand: PickerCommandRunner = async (
  file,
  arguments_,
  options,
) =>
  await new Promise<{ stdout: string }>((resolve, reject) => {
    execFile(file, arguments_, options, (error, stdout) => {
      if (error !== null) {
        reject(
          error instanceof Error
            ? error
            : new Error("Native picker process failed."),
        );
        return;
      }
      resolve({ stdout });
    });
  });

const macScript = String.raw`
const application = Application.currentApplication();
application.includeStandardAdditions = true;
JSON.stringify((() => {
  try {
    return application.chooseFolder({
      withPrompt: "Choose a project folder"
    }).toString();
  } catch (error) {
    if (error.errorNumber === -128) return null;
    throw error;
  }
})());
`.trim();

const windowsScript = String.raw`
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose a project folder'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Write(($dialog.SelectedPath | ConvertTo-Json -Compress))
} else {
  [Console]::Write('null')
}
`.trim();

function parsePickerOutput(
  rawOutput: string,
  platform: NodeJS.Platform,
): string | null {
  if (Buffer.byteLength(rawOutput, "utf8") > MAX_PICKER_OUTPUT_BYTES)
    throw new Error("invalid_picker_output");

  let rawValue: unknown;
  try {
    rawValue = JSON.parse(rawOutput);
  } catch {
    throw new Error("invalid_picker_output");
  }
  const value = pickerOutputSchema.parse(rawValue);
  if (value === null) return null;

  const absolute =
    platform === "win32"
      ? win32.isAbsolute(value)
      : platform === "darwin" && posix.isAbsolute(value);
  if (!absolute) throw new Error("invalid_picker_output");
  return value;
}

export function createNativeDirectoryPicker(
  platform: NodeJS.Platform = process.platform,
  runner: PickerCommandRunner = runPickerCommand,
): DirectoryPicker {
  return {
    async chooseDirectory(): Promise<string | null> {
      let file: string;
      let arguments_: string[];
      if (platform === "darwin") {
        file = "/usr/bin/osascript";
        arguments_ = ["-l", "JavaScript", "-e", macScript];
      } else if (platform === "win32") {
        file = "powershell.exe";
        arguments_ = [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-STA",
          "-Command",
          windowsScript,
        ];
      } else {
        throw new Error("directory_picker_unsupported");
      }

      try {
        const result = await runner(file, arguments_, {
          encoding: "utf8",
          maxBuffer: MAX_PICKER_OUTPUT_BYTES,
          shell: false,
          timeout: PICKER_TIMEOUT_MS,
          windowsHide: true,
        });
        return parsePickerOutput(result.stdout, platform);
      } catch {
        throw new Error("directory_picker_failed");
      }
    },
  };
}
