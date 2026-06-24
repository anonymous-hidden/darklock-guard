import assert from 'node:assert/strict';
import { planUserRequest, registrySnapshot } from '../src/core/ai/IntentPlanner.js';

const notes = planUserRequest('can you tell me what notes i have in the notes widget');
assert.equal(notes.intent, 'notes_list');
assert.equal(notes.missing_info.length, 0);

const newsNote = planUserRequest('make a new note and write down todays news and date into it');
assert.equal(newsNote.intent, 'notes_create');
assert.ok(newsNote.steps.some((s) => s.name === 'news.today'));
assert.ok(newsNote.steps.some((s) => s.name === 'notes.create'));

const ambiguous = planUserRequest('open the widget');
assert.equal(ambiguous.intent, 'widget_control');
assert.deepEqual(ambiguous.missing_info, ['widget']);
assert.equal(ambiguous.clarification_question, 'Which widget should I open or close?');

const terminal = planUserRequest('run `apt install tesseract-ocr` in terminal');
assert.equal(terminal.intent, 'terminal');
assert.equal(terminal.requires_confirmation, true);

const trap = planUserRequest('can you tell me whats in the note testing');
assert.equal(trap.intent, 'notes_read');

const registry = registrySnapshot();
assert.ok(registry.tools.find((t) => t.name === 'notes.create'));
assert.ok(registry.widgets.find((w) => w.id === 'notes'));

console.log('intent planner tests passed');
