# Agent backends

**Current version:** None

**Proposed version:** 1

**Proposal status:** Draft

**Implementation status:** Not started

**Product approval:** Pending for specification version 1

**Subsystem:** Agent execution — which coding agent runs a chat, how that choice
is made and shown, and how a chat behaves when its agent is unavailable

**Last verified:** 2026-08-22

**Related ExecPlans:** [Codex agent runtime implementation plan](../exec-plans/active/2026-08-22-codex-agent-runtime.md)

**Related documents:**
[Multi-agent tiling workspace design](../design/multi-agent-tiling-workspace.md)
(section 4 is the approved design intent this specification realises),
[Runtime and Pi adapter](../design/runtime-and-pi-adapter.md),
[Initial agent workspace](initial-workspace.md) (owns prompt, steer, stop, and
run lifecycle, which this capability leaves unchanged),
[Thread workspaces](thread-workspaces.md) (owns shared-checkout and worktree
execution roots), and
[Thread management](thread-management.md) (owns the thread list, archival, and
run-state signals).

## Purpose

Every chat in this workspace is backed by Pi, implicitly and invisibly. A user
cannot choose a different coding agent, cannot see which agent produced a
transcript, and cannot bring an existing Codex session in the same folder into
the workspace.

This capability makes the **agent backend an explicit, durable, per-chat
property**, adds **Codex** as a second backend beside Pi, and makes Codex the
default for new chats. The user outcome is that a person can start a chat on the
agent they actually want, tell at a glance which agent is answering, and keep
using the same panes, worktrees, inspector, and terminal regardless of which
agent is behind a given chat.

This is the first slice of the "three agent backends" intent recorded in the
[multi-agent tiling workspace design](../design/multi-agent-tiling-workspace.md).
It delivers Pi and Codex only.

## Terminology

- **Backend** — the coding agent that executes a chat's turns. Version 1 defines
  exactly two: **Pi** and **Codex**.
- **Chat** (equivalently _thread_) — one durable conversation in a project, as
  defined by [Initial agent workspace](initial-workspace.md).
- **Execution root** — the shared checkout or the chat's isolated worktree, as
  defined by [Thread workspaces](thread-workspaces.md). A chat's backend runs
  against its execution root and nothing above it.
- **Workspace confinement** — the file and network boundary a Codex chat runs
  under. It is a property of the backend, not of the chat.

## Current contract

There is no Current contract. This is a new capability.

The behavior it replaces is implicit and undocumented: every chat is created on
Pi, the choice is not offered, not recorded, and not displayed, and only Pi
sessions are discoverable for import.

## Proposed revision v1

### AGB-01 — Every chat has one durable, immutable backend

Each chat records the backend that runs it. The backend is chosen when the chat
is created and **never changes for the life of the chat**. There is no move,
convert, or re-point action.

Every chat that existed before this capability shipped is a **Pi** chat. Nothing
about those chats changes: same transcript, same session, same worktree, same
history.

A chat's backend is part of its identity for lookup purposes. Two chats in one
project may hold the same underlying agent session identifier only if they run
on different backends; within a single backend, a session still belongs to at
most one chat in a project.

### AGB-02 — Codex is the default backend for new chats

When a user starts a new chat without expressing a preference, it is a **Codex**
chat.

The default is a deployment setting, not a per-user one: an operator running the
workspace can set the default back to Pi for their machine. Changing the default
affects only chats created afterwards; it never alters or reinterprets an
existing chat.

### AGB-03 — The user chooses the backend when starting a chat

The new-chat composer offers a backend choice beside the existing workspace-mode
controls. It is preselected to the configured default (AGB-02) and offers Pi and
Codex.

The choice is **not sticky**: every new-chat composer opens on the configured
default rather than on whatever was last used. A user who wants Pi for a given
chat says so for that chat.

If a backend is unavailable on the machine (AGB-08), it is still listed but is
not selectable, and the reason is stated where the user makes the choice.

### AGB-04 — A chat's backend is visible wherever the chat is

The backend is shown on the chat's pane header, and in the project's thread list
and Archived list. A user never has to infer from a transcript's wording which
agent wrote it.

The indicator is textual, not colour-only, consistent with the accessibility
rule in [Codex-style workspace surface](codex-workspace-surface.md).

### AGB-05 — A Codex chat behaves like any other chat

Once created, a Codex chat is an ordinary chat. Prompting, steering, stopping,
run states, unread signals, titles and renaming, archival and restore, pane
splitting and closing, shared-checkout or worktree execution, the Changes /
Files / Terminal inspector, and the project terminal all behave exactly as they
do for a Pi chat, and are governed by their existing specifications.

Transcripts render through the one shared transcript model. A Codex chat's
assistant messages, reasoning, shell commands, file edits, tool calls, and
errors appear as the same message, tool, and diagnostic entries the workspace
already renders. No Codex-only surface, panel, or control is introduced.

### AGB-06 — A Codex chat's file and network boundary is explicit and honest

By default a Codex chat may read and write **within its execution root** and has
**no network access**. It cannot write outside that root.

This is deliberately stricter than the Pi backend, which — as
[the README already documents](../../README.md) — runs with the server user's
full permissions. The difference is a documented product property, not an
accident:

- The boundary is stated in operator documentation next to the existing
  statement about Pi.
- An operator who needs Codex to install dependencies, reach the network, or
  write outside the execution root can widen the boundary for their machine.
- When Codex is stopped by the boundary, the chat shows the refusal as an
  ordinary failed command in the transcript. The run settles. It never stalls
  silently, and the user is never left guessing whether the agent is still
  working.

### AGB-07 — A Codex chat never waits for an approval the workspace cannot give

The workspace has no channel for answering an agent's permission prompt. A Codex
chat therefore runs with interactive approvals disabled: every action Codex
would otherwise pause to ask about either proceeds within the boundary of
AGB-06 or fails visibly within it.

No run may enter a state where it is waiting for a human answer that no surface
can collect. This is not configurable; it is a property of the workspace.

### AGB-08 — A missing or unusable Codex installation degrades honestly

Codex is an external program that may be absent, too old, or not signed in.

- Creating a Codex chat when Codex is unusable fails with a message that names
  the cause and the remedy, and creates nothing. No half-made chat is left in
  the project.
- An existing Codex chat opened while Codex is unusable shows its stored
  transcript and reports the backend as unavailable. Prompting is refused with
  the same named cause. The chat is not deleted, hidden, or marked broken.
- Pi chats are entirely unaffected by Codex being unusable, and the reverse.

### AGB-09 — Existing Codex sessions in a folder can be imported

The project's session-discovery and import flow lists the sessions of **each
available backend** for that folder, labelled by backend, and imports the chosen
session as a chat bound to that backend.

A session already imported into a chat in that project is not offered twice.

### Acceptance criteria

1. A new chat started with no explicit choice runs on Codex, and its recorded
   backend reads `codex`. (AGB-02)
2. A new chat started with Pi selected runs on Pi and is unaffected by the Codex
   default. (AGB-03)
3. Every chat that existed before the upgrade reads `pi` afterwards and still
   opens, prompts, and streams exactly as before. (AGB-01)
4. A chat's backend is unchanged after rename, archive, restore, pane close and
   reopen, worktree provisioning, and server restart. (AGB-01)
5. The backend is legible as text on the pane header and in the thread list for
   both a Pi and a Codex chat. (AGB-04)
6. A Codex chat completes a prompt, streams assistant text, shell commands and
   file edits into the shared transcript, can be steered mid-run, can be
   stopped, and reports a settled run state — with no Codex-specific UI.
   (AGB-05)
7. A Codex chat asked to write outside its execution root, or to reach the
   network under the default boundary, produces a visible failed command in the
   transcript and a settled run. It does not hang. (AGB-06, AGB-07)
8. With the Codex program absent, creating a Codex chat fails with a message
   naming Codex as the cause, leaves no thread behind, and leaves Pi chat
   creation working. (AGB-08)
9. Opening an existing Codex chat with the Codex program absent shows the stored
   transcript and an unavailable backend rather than an empty or errored chat.
   (AGB-08)
10. Session discovery for a folder that has both Pi and Codex history lists both,
    labelled, and importing one produces a chat on the matching backend. (AGB-09)

### Non-goals

- **Claude as a third backend.** Named in the governing design; not in v1.
- **Changing an existing chat's backend.** Explicitly excluded by AGB-01.
- **An approval or permission-prompt surface.** AGB-07 removes the need rather
  than building one; a real approval channel is a separate capability.
- **Per-chat model, reasoning-effort, or personality selection** for either
  backend.
- **Codex cloud tasks, review mode, plugins, MCP management, or multi-account
  sign-in** surfaced in this workspace.
- **Making Pi's permission posture stricter.** Pi's boundary is unchanged.
- **A per-user (as opposed to per-machine) default backend.**

### Open product questions

1. **Should the backend default be user-visible in Settings, or operator-only?**
   AGB-02 currently makes it a deployment setting with no in-app control, which
   keeps the Settings page from accumulating a second class of preference. If a
   user is expected to flip the default themselves, AGB-02 needs a Settings
   control and this becomes a device-local preference instead.
2. **Should an unusable backend be hidden from the composer rather than shown
   disabled?** AGB-03 shows it disabled with a reason, which teaches the user
   that Codex exists and how to enable it. Hiding it is quieter but leaves a
   user who expected Codex with nothing to read.
