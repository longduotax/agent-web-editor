"""Focused tests for documentation lifecycle metadata."""

from __future__ import annotations

import unittest

from check_docs import check_open_plan_metadata, check_product_spec_metadata


class OpenPlanMetadataTests(unittest.TestCase):
    def test_accepts_versioned_draft_with_pending_approval(self) -> None:
        text = """\
**Status:** Draft
**Plan version:** 2
**Technical approval:** Pending for plan version 2
**Subsystem:** Workflow
**Affected paths or contracts:** `docs/**`
**Governing specification:** Product behavior change: None
**Related documents or issue:** User request
**Last updated:** 2026-08-15
"""

        self.assertEqual(check_open_plan_metadata(text, "plan.md"), [])

    def test_rejects_active_plan_without_version_specific_approval(self) -> None:
        text = """\
**Status:** Active
**Plan version:** 2
**Technical approval:** Pending for plan version 1
**Subsystem:** Workflow
**Affected paths or contracts:** `docs/**`
**Governing specification:** Product behavior change: None
**Related documents or issue:** User request
**Last updated:** 2026-08-15
"""

        errors = check_open_plan_metadata(text, "plan.md")

        self.assertTrue(any("plan version 2" in error for error in errors))


class ProductSpecMetadataTests(unittest.TestCase):
    def test_accepts_current_spec_without_proposal(self) -> None:
        text = """\
**Current version:** 3
**Proposed version:** None
**Proposal status:** None
**Implementation status:** Current
**Product approval:** Not applicable — no proposed revision
**Subsystem:** Projects
**Last verified:** 2026-08-15
**Related ExecPlans:** None
"""

        self.assertEqual(check_product_spec_metadata(text, "spec.md"), [])

    def test_accepts_approved_first_version_in_progress(self) -> None:
        text = """\
**Current version:** None
**Proposed version:** 1
**Proposal status:** Approved
**Implementation status:** In progress
**Product approval:** Approved by the user for specification version 1
**Subsystem:** Projects
**Last verified:** 2026-08-15
**Related ExecPlans:** Plan
"""

        self.assertEqual(check_product_spec_metadata(text, "spec.md"), [])

    def test_rejects_draft_with_approved_metadata(self) -> None:
        text = """\
**Current version:** 1
**Proposed version:** 2
**Proposal status:** Draft
**Implementation status:** In progress
**Product approval:** Approved by the user for specification version 2
**Subsystem:** Projects
**Last verified:** 2026-08-15
**Related ExecPlans:** Plan
"""

        errors = check_product_spec_metadata(text, "spec.md")

        self.assertTrue(any("pending product approval" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
