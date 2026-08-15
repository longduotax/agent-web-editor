# Initial GitHub publication

**Status:** Completed

**Subsystem:** Repository operations

**Affected paths or contracts:** Entire current repository; local Git metadata; remote `git@github.com:longpaus/agent-web-editor.git`

**Approved specification:** Initialize Git on `main`, attach the empty GitHub repository as `origin`, exclude ignored/generated files, create one initial commit containing the scaffold and documentation, push without force, and verify local/remote state.

**Approval context:** User explicitly approved the working specification in the current conversation on 2026-08-15.

**Related documents or issue:** [Development workflows](../../development/workflows.md)

**Last updated:** 2026-08-15

## Purpose and acceptance criteria

Publish the completed local scaffold as the initial history of the specified GitHub repository.

Acceptance criteria:

- Local Git uses branch `main` and the supplied SSH URL as `origin`.
- The initial commit includes authored source, configuration, lockfile, and documentation.
- Ignored dependencies, build output, caches, secrets, and environment files are absent from the commit.
- Static repository checks pass before publication.
- `main` is pushed without force and tracks `origin/main`.
- Local status is clean and the remote head matches the local commit.

## Current behavior and affected invariants

The local directory contains the initialized monorepo but is not a Git repository. `git ls-remote` confirms that the supplied remote is reachable and has no refs. Publication must not introduce secrets or generated files and must not rewrite remote history.

## Scope and non-goals

In scope: local Git initialization, one initial commit, remote configuration, push, and verification. Non-goals: GitHub repository settings, branch protection, CI configuration, releases, tags, additional branches, or force operations.

No unresolved decisions remain.

## Implementation milestones

1. Initialize local Git on `main`, add `origin`, and inspect ignored/untracked files.
2. Run the static gate and inspect the staged file set for generated or sensitive files.
3. Complete and archive this plan so the initial commit reflects final state.
4. Create the initial commit, push `main`, and compare local and remote commit IDs.

## Untrusted-data-boundary analysis

The remote Git repository and local filesystem metadata are operational boundaries. Git parses repository objects and SSH authenticates the remote. Failure behavior is fail-closed: stop on remote refs, authentication failure, unexpected staged files, failed checks, or commit mismatch. No application-level untrusted data is introduced.

## Touched-legacy-code analysis

Not applicable. There is no local or remote Git history and no legacy code path.

## Verification

```sh
pnpm check
git status --short
git diff --cached --check
git ls-files
git push -u origin main
test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/main | cut -f1)"
git status --short --branch
```

Do not start services, access databases, or force-push.

## Compatibility, deployment, migration, and recovery

No application deployment or migration occurs. Before push, recovery is removal of local Git metadata. After push, the initial commit remains normal Git history; corrections use follow-up commits rather than rewriting published history.

## Progress

- [x] Remote reachability and emptiness verified.
- [x] Working specification approved.
- [x] Git initialized and staged contents reviewed.
- [x] Static checks passed.
- [x] Initial commit created and published.
- [x] `main` pushed and local/remote state verified.
- [x] Plan archived.

## Discoveries and blockers

- The supplied remote is reachable over SSH and currently has no refs.
- No blockers.

## Decision log

- 2026-08-15: Publish one initial `main` commit and prohibit force operations.

## Final outcomes

Git was initialized on `main` with the supplied SSH remote. The reviewed 56-file
scaffold was committed as `2b2d1167d541619c1c1effd606ea38729ecca98b` and pushed
without force. Dependencies, build outputs, caches, environment files, and other
ignored paths were absent from the commit. The full static gate passed, local
`main` tracks `origin/main`, and local and remote commit IDs matched after the
initial push. This plan is archived in a follow-up documentation commit so its
lifecycle records the verified publication truthfully.
