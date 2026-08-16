# Scalable conversation history

**Current version:** None

**Proposed version:** 1

**Proposal status:** Approved

**Implementation status:** Not started

**Product approval:** Approved by the user on 2026-08-16 for specification version 1

**Subsystem:** Conversation history loading, navigation, and viewport behavior

**Last verified:** 2026-08-16

**Related ExecPlans:** [Scalable conversation history](../exec-plans/active/2026-08-16-scalable-conversation-history.md)

**Related specifications:** [Initial agent workspace](initial-workspace.md)

## Purpose

Long-running agent threads can contain thousands of messages, tool activities,
and large outputs. Opening such a thread must take the user directly to recent
work without transferring, parsing, and mounting the complete history in the
browser. Older retained history must remain reachable without reversing its
chronological or semantic order.

This capability owns conversation-history presentation and navigation as an
independent extension of the initial workspace. Native Pi history remains the
authoritative durable source; this capability does not create another transcript
store or alter native sessions.

## Current contract

There is no Current contract for scalable history behavior. The implemented
workspace requests one snapshot containing the complete translated active-branch
transcript, validates the complete array in the browser, renders every visible
message and activity row, and initially leaves a long transcript at its top.
Snapshot invalidation can repeat that full work during live runs. The transcript
uses the browser's default prominent scrollbar.

## Proposed revision v1

### SCH-01 — Open at the latest conversation edge

Opening, reloading, or switching to a non-empty thread places the conversation
viewport at its latest edge before the user has to scroll. Items remain in
chronological document and accessibility order; the application does not reverse
the transcript to produce this result. An empty thread continues to show its
empty state.

### SCH-02 — Follow live work without taking control from the user

While the viewport is at or near the latest edge, appended or updated live
content remains visible automatically. Once the user scrolls away to read older
content, incoming content must not move that reading position. The interface
then provides a clear, keyboard-accessible way to return to the latest content;
using it resumes live following.

Loading older content, refreshing a background page, and receiving live events
must not cause an unrelated viewport jump. Changing to another thread always
uses that thread's latest-edge initial behavior rather than retaining the prior
thread's scroll position.

### SCH-03 — Progressive access to complete retained history

The initial thread view contains a bounded latest page rather than the complete
transcript. If older active-branch history exists, the user can request it in
bounded pages through a clearly labeled control. Prepending a page preserves the
previously visible reading anchor. The UI distinguishes loading, the oldest
available history, and a scoped failure with retry.

All displayable history retained on the current native Pi branch remains
reachable through repeated paging. The browser may evict distant pages to keep
its working set bounded, but it must offer a way to page toward them again or
return directly to the latest edge. Paging never deletes, rewrites, compacts, or
silently marks native history as viewed.

If native branch history changes so that a paging position is no longer valid,
the application must not combine incompatible pages. It visibly resets to an
authoritative latest page and allows the user to resume navigation.

### SCH-04 — Bound browser work independently of total chat length

Initial and live-refresh transcript responses are bounded by both item count and
display payload size. The browser retains and mounts only a bounded contiguous
page window, so the amount of transcript data in query state and the number of
Markdown/activity rows in the DOM do not grow with the thread's total retained
history merely because the thread was opened.

A single schema-bounded item may exceed the normal page target and is returned
alone so paging cannot become stuck. Existing content-safety and per-item bounds
continue to apply. Tool details remain collapsed until requested.

A deterministic 10,000-item mixed-history fixture must demonstrate that initial
wire items, cached transcript pages, and mounted transcript rows stay within the
configured bounds. Wall-clock timings may be recorded during manual profiling,
but hardware-dependent timing thresholds are not a product requirement.

### SCH-05 — Preserve authoritative live and recovery semantics

Pagination is a view over native Pi history, not a new durable source. Stable
item identities prevent duplicates when pages overlap or live snapshots are
retried. Reconnection, an event gap, server restart, or a stale paging position
replaces affected browser projections from authoritative server data without
resubmitting work or duplicating transcript entries.

When the user is reading an older page window, live activity may update a
latest-content indicator without forcing the old window to refetch or move.
Returning to latest obtains the current authoritative latest page.

### SCH-06 — Use a restrained but discoverable transcript scrollbar

Only the conversation viewport receives the subdued scrollbar treatment. Its
track is unobtrusive and its thumb is thinner and lower contrast at rest, while
remaining discoverable through increased contrast on hover or interaction. The
scrollbar is not completely hidden, and code blocks, inspector views, and the
terminal retain their own appropriate scrolling affordances.

## Acceptance criteria

1. Opening, reloading, or switching to a long thread shows its latest content
   without manual scrolling while preserving chronological DOM order.
2. Live output follows while the user is near the latest edge; scrolling upward
   prevents subsequent updates from moving the viewport, and an accessible
   return-to-latest control restores following.
3. Requesting an older page preserves the previously visible item and clearly
   reports loading, end-of-history, and retryable failure states.
4. Repeated older/newer paging can reach every displayable item on the active
   native branch without modifying the native session.
5. A stale or branch-incompatible cursor produces a scoped reset/recovery state
   rather than duplicate, missing-without-notice, or mixed-branch rows.
6. With a deterministic 10,000-item history, the initial response, browser page
   cache, and mounted transcript rows remain within documented implementation
   bounds independent of the total item count.
7. Live updates and reconnect recovery refresh only the bounded latest
   projection and do not repeatedly transfer the complete retained history.
8. The transcript scrollbar is visually quieter at rest and remains visible on
   hover or interaction on supported browsers; other scroll surfaces are
   unchanged.
9. Malformed, oversized, stale, unknown-thread, and cross-thread paging values
   fail through parsed boundaries with safe scoped errors and no native path or
   session identifier disclosure.

## Non-goals

- Reversing transcript or accessibility order
- Full-history search or browser Find support for unloaded pages
- Remembering an exact transcript scroll position across browser restarts
- Pi session-tree navigation or displaying abandoned branches
- Copying the complete transcript into application metadata or browser storage
- Changing Pi compaction, retention, deletion, or native JSONL formats
- Removing existing per-item content limits or eagerly expanding large tool details
- A generic virtual-list framework when bounded pages satisfy the measured DOM limit
- A hardware-specific startup-time guarantee

## Open product questions

None. The proposed behavior uses a bounded latest page, explicit progressive
history controls, a bounded browser page window, polite live following, and a
visible return-to-latest action.
