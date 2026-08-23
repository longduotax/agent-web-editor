# Agent backends

**Current version:** None

**Proposed version:** 2

**Proposal status:** Approved

**Implementation status:** In progress

**Product approval:** Approved for specification version 2 on 2026-08-23 by the user (longduotax), together with the Codex tool-call replay plan version 1, after resolving four drafting choices in conversation: replay is complete for the history a chat displays and read on demand rather than depth-limited (AGB-11); live and reopened transcripts render a shell command identically; an unfinished command replays as failed; and replay ships enabled. Version 1 was approved on 2026-08-22 by the same user, after resolving both open product questions then: the default backend gains a Settings control (AGB-02) and an unusable backend is shown disabled with a reason (AGB-03). That approval covered plan version 1 of the Codex agent runtime and is unaffected by this proposal.

**Subsystem:** Agent execution — which coding agent runs a chat, how that choice
is made and shown, and how a chat behaves when its agent is unavailable

**Last verified:** 2026-08-23

**Related ExecPlans:** [Codex agent runtime implementation plan](../exec-plans/active/2026-08-22-codex-agent-runtime.md)
(version 1) and
[Codex tool-call replay implementation plan](../exec-plans/active/2026-08-23-codex-tool-call-replay.md)
(version 2)

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

**Continuing a chat never offers a backend choice.** No surface that resumes an
existing conversation — the chat composer, a reopened pane, a restored archived
chat, or a reconnect after a server restart — presents a backend or provider
control. The choice exists at creation and nowhere else.

**A chat derived from another chat inherits that chat's backend.** Where a
future start state creates a chat from an existing one (a fork of a running
chat, per the governing design), the derived chat runs on its parent's backend,
and the backend control is fixed rather than offered. This is not a policy
preference: a chat is continued by resuming the backend's own native session,
and no transcript, reasoning, or tool history transfers between agents. A
switch could only be faked by replaying a foreign transcript as text or by
silently starting empty, and both are worse than declining.

### AGB-02 — Codex is the default backend for new chats

When a user starts a new chat without expressing a preference, it is a **Codex**
chat.

The default is settable at two levels, and the more specific one wins:

1. **Device preference** — a control on the Settings page, beside the theme
   control, offering _Follow this machine_, _Pi_, and _Codex_. It applies to the
   browser it was set in, exactly as the theme preference does.
2. **Machine default** — set by whoever runs the workspace server. This is what
   _Follow this machine_ follows.
3. **Codex**, when neither is set.

The device preference ships as _Follow this machine_, so an operator who sets
the machine default still governs every browser that has not chosen otherwise.

Changing either default affects only chats created afterwards. It never alters,
re-points, or reinterprets an existing chat (AGB-01). A device preference is a
convenience, not a record: losing it (new browser, cleared storage) falls back
to the machine default and changes nothing about existing chats.

### AGB-03 — The user chooses the backend when starting a chat

The new-chat composer offers a backend choice beside the existing workspace-mode
controls. It is preselected to the configured default (AGB-02) and offers Pi and
Codex.

The choice is **not sticky**: every new-chat composer opens on the effective
default from AGB-02 rather than on whatever was last used. A user who wants Pi
for a given chat says so for that chat. This is not in tension with the device
preference — a preference is a deliberate standing choice a user made once in
Settings, whereas stickiness would silently promote an incidental one-off pick
into a standing one.

If a backend is unavailable on the machine (AGB-08), it is still listed but is
not selectable, and the reason is stated where the user makes the choice.

When the chosen start state derives the chat from an existing one, the control
shows the inherited backend and is not editable (AGB-01).

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
**no network access**. It cannot write into the user's home directory, the
repository above its worktree, or anywhere else on the machine — with one
exception the boundary itself grants: the system temporary directories (`/tmp`
and `$TMPDIR`) remain writable, because Codex's `workspace-write` sandbox treats
scratch space as part of the workspace. Verified on 2026-08-22: a write to
`$HOME` is refused with "Operation not permitted" and a write to `/tmp`
succeeds.

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

1. A new chat started with no explicit choice, on a machine and browser that
   set neither default, runs on Codex and its recorded backend reads `codex`.
   (AGB-02)
2. Setting the Settings-page backend preference to Pi makes subsequent new-chat
   composers in that browser open on Pi, while a second browser against the same
   server still opens on the machine default. Existing chats are untouched.
   (AGB-02, AGB-01)
3. With the device preference left at _Follow this machine_, changing the
   machine default changes what new-chat composers open on. (AGB-02)
4. Clearing browser storage returns the composer to the machine default without
   error. (AGB-02)
5. A new chat started with Pi selected runs on Pi and is unaffected by the Codex
   default. (AGB-03)
6. Every chat that existed before the upgrade reads `pi` afterwards and still
   opens, prompts, and streams exactly as before. (AGB-01)
7. A chat's backend is unchanged after rename, archive, restore, pane close and
   reopen, worktree provisioning, and server restart. (AGB-01)
8. No surface for continuing an existing chat exposes a backend or provider
   control: the chat composer, a reopened pane, and a restored archived chat all
   present none. (AGB-01)
9. The backend is legible as text on the pane header and in the thread list for
   both a Pi and a Codex chat. (AGB-04)
10. A Codex chat completes a prompt, streams assistant text, shell commands and
    file edits into the shared transcript, can be steered mid-run, can be
    stopped, and reports a settled run state — with no Codex-specific UI.
    (AGB-05)
11. A Codex chat asked to write outside its execution root, or to reach the
    network under the default boundary, produces a visible failed command in the
    transcript and a settled run. It does not hang. (AGB-06, AGB-07)
12. With the Codex program absent, creating a Codex chat fails with a message
    naming Codex as the cause, leaves no thread behind, and leaves Pi chat
    creation working. (AGB-08)
13. Opening an existing Codex chat with the Codex program absent shows the stored
    transcript and an unavailable backend rather than an empty or errored chat.
    (AGB-08)
14. Session discovery for a folder that has both Pi and Codex history lists both,
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

None. Both questions raised in drafting were resolved by the user on 2026-08-22
and are folded into the requirements above:

- **Is the default backend user-visible?** Yes. AGB-02 now defines a Settings
  control layered over the machine default, following the established theme
  preference pattern, rather than an operator-only setting.
- **How is an unusable backend presented?** Shown, disabled, with the reason
  stated at the point of choice (AGB-03), rather than hidden.

## Proposed revision v2

Approved on 2026-08-23; implementation has not started.

Version 1 is approved and implemented, and remains the baseline: every
requirement above is unchanged. This revision is a bounded addition of three
requirements — AGB-10, AGB-11, and AGB-12 — that close one gap version 1 left
open against [AGB-05](#agb-05--a-codex-chat-behaves-like-any-other-chat).

**The gap.** A Codex chat shows its shell commands and file edits while they
run, and loses them the moment the chat is reopened: a reloaded Codex
transcript is messages only. A Pi chat keeps its full history. AGB-05 promises
that a Codex chat behaves like any other chat, and today it does not.

### AGB-10 — A reopened Codex chat shows the tool calls it showed live

When a Codex chat is reopened — a page reload, a reconnect after a server
restart, a pane closed and opened again, or an archived chat restored — its
transcript contains the **tool entries it displayed while running**: shell
commands with their command line, working directory, output, and success or
failure, and file changes with what they changed. Each appears in its original
position relative to the messages of the turn it belongs to.

This holds for a chat this workspace created and, equally, for a chat imported
under [AGB-09](#agb-09--existing-codex-sessions-in-a-folder-can-be-imported),
whichever Codex client originally wrote that chat's history.

**Only what a person wrote or an agent produced is shown.** Material injected
into the model's context — standing instructions, tool and plugin catalogues,
environment descriptions — is never rendered as conversation, whatever role it
is stored under. A transcript that gained thousands of words no human typed
would be a worse outcome than the gap this requirement closes.

No new surface, panel, or control is introduced. The replayed entries are the
ordinary tool entries the workspace already renders.

### AGB-11 — Replay covers the history the chat shows, and is read on demand

A reopened Codex chat replays tool calls for **all** of the history it displays,
not a recent slice of it. A chat's older commands are as durable as its older
messages, and a user who scrolls back to last week's work sees what the agent
actually did there.

The workspace reads only as much of the stored history as the displayed
conversation needs, working backwards from the latest activity. Today a chat
opens with its whole conversation, so its whole stored tool history is read once
on open. As [Scalable conversation history](scalable-conversation-history.md)
introduces bounded pages, replay follows it: a page of conversation carries the
tool calls belonging to that page, and paging further back reads further back.
Reopening a chat never reads history the chat is not showing.

One ceiling remains, and it is a safety limit rather than a product one: a
stored history far larger than any this workspace has seen, or a single stored
entry too large to hold, stops the read. When that happens the transcript
**says so once, at the point where replay stops**, rather than presenting a
partial history as if it were complete.

### AGB-12 — Unreadable tool history degrades to messages, never to failure

Codex stores a chat's history in a private format this workspace does not
control. It can change with a Codex upgrade, and it can be absent.

When that history cannot be read or cannot be understood:

- The chat opens normally and shows its messages — exactly the history it shows
  today. Prompting, steering, stopping, and live streaming are unaffected.
- The transcript carries **one quiet line** stating that earlier tool activity
  could not be restored for this chat. It names no file, path, or internal
  format; the detail belongs in the server's logs, not in a user's
  conversation.
- Nothing is deleted, hidden, emptied, or invented. A chat is never marked
  broken for this reason, and creating a chat never fails for it.

Pi chats are entirely unaffected, as are Codex chats whose history reads
cleanly.

### Acceptance criteria

Version 1's criteria 1–14 stand unchanged. This revision adds:

15. A Codex chat runs a shell command; after a full page reload the transcript
    shows that command with its output and its success or failure, in the same
    position relative to the surrounding messages as it held during the run.
    (AGB-10)
16. The same holds for a file change made by a Codex chat. (AGB-10)
17. A Codex session created outside this workspace — by the Codex desktop app or
    the Codex terminal client — and imported under AGB-09 replays its tool calls
    when reopened. (AGB-10)
18. A reopened Codex transcript contains no entry that no human wrote and no
    agent produced. Specifically, injected instruction and catalogue material
    that Codex stores under a user role does not appear. (AGB-10)
19. A Codex chat whose history holds hundreds of tool calls across many turns
    replays **every** one of them on reopen, including the oldest, for as long as
    the transcript displays the messages they belong to. (AGB-11)
20. A chat is never made to read stored history it is not displaying: once
    conversation history is paged, opening a chat reads the stored region behind
    the displayed page and no more. (AGB-11)
21. A stored history beyond the safety ceiling still opens, and its transcript
    states once, at that point, where replay stopped. (AGB-11)
22. With the stored history absent, truncated, or in a format this workspace
    does not recognise, the chat still opens with its messages, still prompts and
    streams, and shows exactly one line saying earlier tool activity could not be
    restored. (AGB-12)
23. A Pi chat's reopened transcript is byte-for-byte unchanged by this revision.
    (AGB-05)

### Non-goals

Version 1's non-goals stand. This revision adds:

- **Replaying reasoning.** A Codex chat shows reasoning summaries live, as
  assistant text, and they still do not survive a reload. Version 1 recorded
  that the transcript contract has no reasoning kind of its own; giving
  reasoning a durable home is a separate change to that contract, and this
  revision does not make it.
- **A rule that live and reopened transcripts are identical.** This revision
  closes the tool-call gap specifically. Stating identity as a standing
  requirement would silently pull in reasoning, token accounting, and every
  future Codex item type.
- **Surfacing Codex's stored sessions.** No browser, exporter, or file picker
  over Codex's session storage, and nothing in this workspace writes to it.
- **Token usage, rate limits, plan updates, or compaction notices**, which
  Codex's own clients show and this workspace does not.

### Open product questions

None.
