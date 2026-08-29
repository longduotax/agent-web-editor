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
    REPOSITORY_ROOT / "packages" / "codex-adapter" / "README.md",
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
OPEN_PLAN_STATUSES = {"Draft", "Ready", "Active", "Blocked"}
IMPLEMENTATION_STATUSES = {"Not started", "In progress", "Current"}
PROPOSAL_STATUSES = {"None", "Draft", "Approved"}
COMPLETED_STATUS = re.compile(
    r"^\*\*Status:\*\*\s*(Completed|Superseded|Abandoned)\s*$", re.MULTILINE
)
DATED_PLAN_NAME = re.compile(r"^\d{4}-\d{2}-\d{2}-.+\.md$")
EXTERNAL_TARGET = re.compile(r"^[a-z][a-z0-9+.-]*:", re.IGNORECASE)


def repository_path(path: Path) -> str:
    """Return a stable repository-relative display path."""
    return path.relative_to(REPOSITORY_ROOT).as_posix()


def metadata_value(text: str, label: str) -> str | None:
    """Return one bold Markdown metadata value."""
    match = re.search(
        rf"^\*\*{re.escape(label)}:\*\*\s*(.+?)\s*$", text, re.MULTILINE
    )
    return match.group(1) if match else None


def positive_version(value: str | None) -> int | None:
    """Parse a positive integer metadata version."""
    if value is None or not value.isdigit():
        return None
    version = int(value)
    return version if version > 0 else None


def check_open_plan_metadata(text: str, display_path: str) -> list[str]:
    """Validate lifecycle and version-specific approval for one open plan."""
    errors: list[str] = []
    status = metadata_value(text, "Status")
    if status not in OPEN_PLAN_STATUSES:
        errors.append(
            f"{display_path} has unsupported open-plan status: {status or 'missing'}"
        )

    raw_version = metadata_value(text, "Plan version")
    version = positive_version(raw_version)
    if version is None:
        errors.append(f"{display_path} has no positive integer Plan version")

    approval = metadata_value(text, "Technical approval")
    if approval is None:
        errors.append(f"{display_path} is missing Technical approval metadata")
    elif version is not None and f"plan version {version}" not in approval.lower():
        errors.append(
            f"{display_path} Technical approval does not identify plan version {version}"
        )
    elif status == "Draft" and not approval.lower().startswith("pending"):
        errors.append(f"{display_path} Draft plan must have pending technical approval")
    elif status in {"Ready", "Active", "Blocked"} and not approval.lower().startswith(
        "approved"
    ):
        errors.append(f"{display_path} {status} plan must have approved technical approval")

    for label in (
        "Subsystem",
        "Affected paths or contracts",
        "Governing specification",
        "Related documents or issue",
        "Last updated",
    ):
        if metadata_value(text, label) is None:
            errors.append(f"{display_path} is missing {label} metadata")

    return errors


def check_product_spec_metadata(text: str, display_path: str) -> list[str]:
    """Validate current/proposed versions and approval for one product spec."""
    errors: list[str] = []
    current_raw = metadata_value(text, "Current version")
    proposed_raw = metadata_value(text, "Proposed version")
    proposal_status = metadata_value(text, "Proposal status")
    implementation_status = metadata_value(text, "Implementation status")
    approval = metadata_value(text, "Product approval")

    current = None if current_raw == "None" else positive_version(current_raw)
    proposed = None if proposed_raw == "None" else positive_version(proposed_raw)

    if current_raw is None or (current_raw != "None" and current is None):
        errors.append(f"{display_path} has invalid Current version metadata")
    if proposed_raw is None or (proposed_raw != "None" and proposed is None):
        errors.append(f"{display_path} has invalid Proposed version metadata")
    if proposal_status not in PROPOSAL_STATUSES:
        errors.append(
            f"{display_path} has unsupported Proposal status: "
            f"{proposal_status or 'missing'}"
        )
    if implementation_status not in IMPLEMENTATION_STATUSES:
        errors.append(
            f"{display_path} has unsupported Implementation status: "
            f"{implementation_status or 'missing'}"
        )
    if approval is None:
        errors.append(f"{display_path} is missing Product approval metadata")

    if proposal_status == "None":
        if proposed_raw != "None":
            errors.append(f"{display_path} Proposal status None requires Proposed version None")
        if approval is not None and not approval.lower().startswith("not applicable"):
            errors.append(
                f"{display_path} with no proposal must mark Product approval Not applicable"
            )
    elif proposal_status in {"Draft", "Approved"}:
        if proposed is None:
            errors.append(f"{display_path} {proposal_status} proposal needs a version")
        elif approval is not None and (
            f"specification version {proposed}" not in approval.lower()
        ):
            errors.append(
                f"{display_path} Product approval does not identify specification "
                f"version {proposed}"
            )
        if proposal_status == "Draft" and approval is not None and not approval.lower().startswith(
            "pending"
        ):
            errors.append(f"{display_path} Draft proposal must have pending product approval")
        if proposal_status == "Approved" and approval is not None and not approval.lower().startswith(
            "approved"
        ):
            errors.append(f"{display_path} Approved proposal needs approved product approval")

    if implementation_status == "Current" and current is None:
        errors.append(f"{display_path} Current implementation needs a current version")

    for label in ("Subsystem", "Last verified", "Related ExecPlans"):
        if metadata_value(text, label) is None:
            errors.append(f"{display_path} is missing {label} metadata")

    return errors


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
        errors.extend(check_open_plan_metadata(text, repository_path(plan)))

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


def check_product_specs() -> list[str]:
    """Report invalid lifecycle metadata in canonical product specs."""
    errors: list[str] = []
    product_specs = DOCS_ROOT / "product-specs"
    for document in sorted(product_specs.glob("*.md")):
        if document.name == "index.md":
            continue
        text = document.read_text(encoding="utf-8")
        errors.extend(check_product_spec_metadata(text, repository_path(document)))
    return errors


def collect_errors() -> list[str]:
    """Run all documentation checks."""
    errors = check_required_files()
    errors.extend(check_links())
    for directory in INDEXED_DIRECTORIES:
        errors.extend(check_index_coverage(directory))
    errors.extend(check_plan_placement())
    errors.extend(check_product_specs())
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
