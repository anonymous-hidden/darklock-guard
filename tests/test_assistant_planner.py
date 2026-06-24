import unittest

from assistant_planner import plan_request, registry_snapshot


class AssistantPlannerTests(unittest.TestCase):
    def test_simple_one_tool_notes_list(self):
        plan = plan_request("can you tell me what notes i have in the notes widget")
        self.assertIsNotNone(plan)
        self.assertEqual(plan.intent, "notes_list")
        self.assertIn("notes.list", plan.tools_needed)
        self.assertFalse(plan.missing_info)

    def test_multi_tool_news_note(self):
        plan = plan_request("make a new note and write down todays news and date into it")
        self.assertIsNotNone(plan)
        self.assertEqual(plan.intent, "notes_create")
        self.assertIn("news.today", plan.tools_needed)
        self.assertIn("notes.create", plan.tools_needed)

    def test_multi_widget_appointment_briefing_missing_place(self):
        plan = plan_request("find weather, traffic, and nearby parking for my appointment")
        self.assertIsNotNone(plan)
        self.assertEqual(plan.intent, "appointment_briefing")
        self.assertIn("map", plan.widgets_needed)
        self.assertIn("place", plan.missing_info)
        self.assertTrue(plan.clarification_question)

    def test_ambiguous_widget_request_asks_one_question(self):
        plan = plan_request("open the widget")
        self.assertIsNotNone(plan)
        self.assertEqual(plan.intent, "widget_control")
        self.assertIn("widget", plan.missing_info)
        self.assertEqual(plan.clarification_question, "Which widget should I open or close?")

    def test_confirmation_required_terminal(self):
        plan = plan_request("run `apt install tesseract-ocr` in terminal")
        self.assertIsNotNone(plan)
        self.assertEqual(plan.intent, "terminal_command")
        self.assertTrue(plan.requires_confirmation)

    def test_followup_context(self):
        first = plan_request("open brave")
        follow = plan_request("go ahead", {"previous_plan": first.to_dict() if first else {}})
        self.assertIsNotNone(first)
        self.assertEqual(first.intent, "launch_app")
        self.assertIsNone(follow)

    def test_old_keyword_trap_notes_not_discord(self):
        plan = plan_request("can you tell me whats in the note testing")
        self.assertIsNotNone(plan)
        self.assertEqual(plan.intent, "notes_read")
        self.assertNotEqual(plan.task_intent, "discord_action")

    def test_registry_has_structured_tools_and_widgets(self):
        snap = registry_snapshot()
        self.assertIn("notes.create", snap["tools"])
        self.assertIn("required_parameters", snap["tools"]["notes.create"])
        self.assertIn("notes", snap["widgets"])
        self.assertIn("examples", snap["widgets"]["notes"])


if __name__ == "__main__":
    unittest.main()

