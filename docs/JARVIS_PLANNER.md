# Jarvis Intent Planner

Jarvis now has a planner layer in front of the older prompt/tool loops.

## Runtime Paths

- `assistant_planner.py` plans requests for the Python terminal bridge used by the popout chat widget.
- `jarvis/nova-ai/src/core/ai/IntentPlanner.js` plans requests for the Electron main chat tab.
- Existing executors in `ai-terminal-server.py` still perform the real work. The planner chooses an intent, entities, tools, widgets, missing info, and confirmation policy before execution.
- The older regex router in `ai-terminal-server.py` remains as fallback for routes that have not been moved into the planner yet.

## Plan Shape

```json
{
  "intent": "notes_create",
  "task_intent": "notes_create",
  "confidence": 0.86,
  "entities": {
    "title": "Today's News",
    "date": "today"
  },
  "steps": [
    { "type": "tool", "name": "widgets.open", "params": { "id": "notes" } },
    { "type": "tool", "name": "news.today", "params": {} },
    { "type": "tool", "name": "notes.create", "params": {} }
  ],
  "missing_info": [],
  "requires_confirmation": false
}
```

## Adding A Tool

1. Add the real handler in `jarvis/nova-ai/electron/services/tools.js`.
2. Include `description`, `args`, `examples`, and `requiresConfirmation` when the action can send, delete, buy, book, modify calendars, or run commands.
3. Add the matching entry to `assistant_planner.py` `TOOL_REGISTRY`.
4. Use the tool in an `IntentDefinition` if it should be selected automatically.
5. Add a planner test.

## Adding A Widget

1. Add the component to `jarvis/nova-ai/src/builtins/registry.js`.
2. Add widget metadata to `assistant_planner.py` `WIDGET_REGISTRY`.
3. Add the widget to `jarvis/nova-ai/src/core/ai/IntentPlanner.js` `WIDGET_REGISTRY`.
4. Add aliases for common names users will say.

## Confirmation Rules

The planner marks these as confirmation-required:

- Sending messages or emails
- Purchases
- Bookings/reservations
- Deletes
- Calendar modifications
- Terminal/shell/protected commands
- Desktop key actions that can send or submit

If required info is missing, Jarvis asks one clarifying question and does not call tools.

## Current Limitations

- The Python bridge still has fallback legacy routing for routes not yet migrated.
- Email and booking examples produce safe clarification plans unless a real email/booking connector is added.
- Internal compatibility IDs such as `nova-call`, `nova-chat`, and `window.nova` remain so existing widgets do not break while user-facing branding moves to Jarvis.

