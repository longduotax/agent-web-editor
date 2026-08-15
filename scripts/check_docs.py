"""Validate canonical documentation navigation and ExecPlan placement."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DOCS_ROOT = REPOSITORY_ROOT / "docs"
EXEC_PLANS = DOCS_ROOT / "exec-plans"
ACTIVE_PLANS = EXEC_PLANS / "active"
COMPLETED_PLANS = EXEC_PLANS / "completed"

REQUIRED_INDEXES = (
    DOCS_ROOT / "README.md",
    DOCS_ROOT / "architecture" / "index.md",
    DOCS_ROOT / "product-specs" / "index.md",
    DOCS_ROOT / "design" / "index.md",
    DOCS_ROOT / "development" / "index.md",
    EXEC_PLANS / "index.md",
    ACTIVE_PLANS / "index.md",
    COMPLETED_PLANS / "index.md",
    DOCS_ROOT / "references" / "index.md",
)

REQUIRED_COMPONENT_DOCS = (
    REPOSITORY_ROOT / "apps" / "web" / "README.md",
    REPOSITORY_ROOT / "apps" / "server" / "README.md",
    REPOSITORY_ROOT / "packages" / "contracts" / "README.md",
    REPOSITORY_ROOT / "packages" / "agent-runtime" / "README.md",
    REPOSITORY_ROOT / "packages" / "pi-adapter" / "README.md",
)

INDEXED_DIRECTORIES = (
    DOCS_ROOT / "architecture",
    DOCS_ROOT / "product-specs",
    DOCS_ROOT / "design",
    DOCS_ROOT / "development",
    ACTIVE_PLANS,
    COMPLETED_PLANS,
    DOCS_ROOT / "references",
)

LEGACY_PLAN_DIRECTORIES = (
    DOCS_ROOT / "plans",
    DOCS_ROOT / "superpowers" / "plans",
)

MARKDOWN_LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
ACTIVE_STATUS = re.compile(r"^\*\*Status:\*\*\s*Active\s*$", re.MULTILINE)
COMPLETED_STATUS = re.compile(
    r"^\*\*Status:\*\*\s*(Completed|Superseded|Abandoned)\s*$", re.MULTILINE
)
DATED_PLAN_NAME = re.compile(r"^\d{4}-\d{2}-\d{2}-.+\.md$")
EXTERNAL_TARGET = re.compile(r"^[a-z][a-z0-9+.-]*:", re.IGNORECASE)


def repository_path(path: Path) -> str:
    """Return a stable repository-relative display path."""
    return path.relative_to(REPOSITORY_ROOT).as_posix()


def canonical_files() -> list[Path]:
    """Return current documents whose links must remain valid."""
    files = {
        REPOSITORY_ROOT / "AGENTS.md",
        REPOSITORY_ROOT / "README.md",
        *REQUIRED_COMPONENT_DOCS,
    }
    for path in DOCS_ROOT.rglob("*.md"):
        if path.parent == COMPLETED_PLANS and path.name != "index.md":
            continue
        files.add(path)
    return sorted(files)


def raw_link_path(raw_target: str) -> str | None:
    """Extract the path portion of a local Markdown link target."""
    target = raw_target.strip()
    if target.startswith("<") and ">" in target:
        target = target[1 : target.index(">")]
    else:
        target = target.split(maxsplit=1)[0]

    if not target or target.startswith("#") or EXTERNAL_TARGET.match(target):
        return None

    path_text = unquote(target.split("#", maxsplit=1)[0])
    return path_text or None


def local_link_target(source: Path, raw_target: str) -> Path | None:
    """Resolve a Markdown target when it refers to a local path."""
    path_text = raw_link_path(raw_target)
    if path_text is None:
        return None
    return (source.parent / path_text).resolve()


def linked_local_targets(source: Path) -> set[Path]:
    """Return all local targets linked by one Markdown document."""
    text = source.read_text(encoding="utf-8")
    return {
        target
        for match in MARKDOWN_LINK.finditer(text)
        if (target := local_link_target(source, match.group(1))) is not None
    }


def check_required_files() -> list[str]:
    """Report missing canonical indexes and component guides."""
    required = (*REQUIRED_INDEXES, *REQUIRED_COMPONENT_DOCS)
    return [
        f"Missing required documentation file: {repository_path(path)}"
        for path in required
        if not path.is_file()
    ]


def check_links() -> list[str]:
    """Report absolute, escaped, or broken links in current documents."""
    errors: list[str] = []
    for source in canonical_files():
        if not source.is_file():
            continue
        text = source.read_text(encoding="utf-8")
        for match in MARKDOWN_LINK.finditer(text):
            raw_target = match.group(1)
            path_text = raw_link_path(raw_target)
            if path_text is None:
                continue
            if path_text.startswith("/"):
                errors.append(
                    f"{repository_path(source)} uses a non-relative link: {raw_target}"
                )
                continue
            target = local_link_target(source, raw_target)
            if target is None:
                continue
            try:
                target.relative_to(REPOSITORY_ROOT)
            except ValueError:
                errors.append(
                    f"{repository_path(source)} links outside the repository: "
                    f"{raw_target}"
                )
                continue
            if not target.exists():
                errors.append(
                    f"{repository_path(source)} has a broken link: {raw_target}"
                )
    return errors


def check_index_coverage(directory: Path) -> list[str]:
    """Report direct Markdown documents absent from their closest index."""
    index = directory / "index.md"
    if not index.is_file():
        return []
    targets = linked_local_targets(index)
    errors: list[str] = []
    for document in sorted(directory.glob("*.md")):
        if document == index:
            continue
        if document.resolve() not in targets:
            errors.append(
                f"{repository_path(document)} is not listed in "
                f"{repository_path(index)}"
            )
    return errors


def check_plan_placement() -> list[str]:
    """Report misplaced, duplicated, or incorrectly labelled ExecPlans."""
    errors: list[str] = []
    for directory in LEGACY_PLAN_DIRECTORIES:
        if directory.exists():
            errors.append(f"Legacy plan directory exists: {repository_path(directory)}")

    for document in EXEC_PLANS.glob("*.md"):
        if document.name != "index.md":
            errors.append(
                f"ExecPlan must be in active/ or completed/: "
                f"{repository_path(document)}"
            )

    active = {
        path.name: path
        for path in ACTIVE_PLANS.glob("*.md")
        if path.name != "index.md"
    }
    completed = {
        path.name: path
        for path in COMPLETED_PLANS.glob("*.md")
        if path.name != "index.md"
    }
    for duplicate in sorted(active.keys() & completed.keys()):
        errors.append(f"Plan appears in active and completed: {duplicate}")

    for name, plan in sorted(active.items()):
        text = plan.read_text(encoding="utf-8")
        if not DATED_PLAN_NAME.match(name):
            errors.append(f"Active plan name is not dated: {repository_path(plan)}")
        if not ACTIVE_STATUS.search(text):
            errors.append(
                f"Active plan is missing '**Status:** Active': "
                f"{repository_path(plan)}"
            )

    for name, plan in sorted(completed.items()):
        text = plan.read_text(encoding="utf-8")
        if not DATED_PLAN_NAME.match(name):
            errors.append(f"Completed plan name is not dated: {repository_path(plan)}")
        if not COMPLETED_STATUS.search(text):
            errors.append(
                f"Completed plan has no completed outcome status: "
                f"{repository_path(plan)}"
            )
    return errors


def collect_errors() -> list[str]:
    """Run all documentation checks."""
    errors = check_required_files()
    errors.extend(check_links())
    for directory in INDEXED_DIRECTORIES:
        errors.extend(check_index_coverage(directory))
    errors.extend(check_plan_placement())
    return errors


def main() -> int:
    """Run the validator and return a process exit code."""
    errors = collect_errors()
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    active_count = len(list(ACTIVE_PLANS.glob("[0-9]*.md")))
    completed_count = len(list(COMPLETED_PLANS.glob("[0-9]*.md")))
    print(
        "Documentation navigation is valid "
        f"({active_count} active, {completed_count} completed plans)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
