/**
 * WidgetBuilder — orchestrates the 6-stage widget generation pipeline.
 *
 *   1. ANALYZE   — interpret the user prompt
 *   2. PLAN      — model thinks through structure
 *   3. WRITE     — model streams component code
 *   4. PARSE     — CodeExtractor extracts code + meta
 *   5. PREVIEW   — build sandbox iframe HTML
 *   6. SAVE      — persist to widgets/registry.json via IPC
 *
 * Stages 1-3 happen during a single Ollama streaming call; we surface
 * sub-stage progress by watching the streamed text for delimiter markers.
 *
 * Usage:
 *   const builder = new WidgetBuilder({ ollama, ipcSave });
 *   await builder.run(prompt, {
 *     onStage:    ({ stage, status, durationMs }) => ...,
 *     onStream:   (text)                          => ...,
 *     onLog:      (line)                          => ...,
 *     signal:     abortController.signal,
 *   });
 */

import { OllamaClient, DEFAULT_MODEL } from './OllamaClient.js';
import { extractWidget, buildWidgetIframeHtml } from './CodeExtractor.js';
import { WIDGET_MODE } from './PromptEngine.js';

export const STAGES = [
  { id: 'analyze',  label: 'Analyzing your request' },
  { id: 'plan',     label: 'Planning component structure' },
  { id: 'write',    label: 'Writing component code' },
  { id: 'parse',    label: 'Parsing and validating output' },
  { id: 'preview',  label: 'Rendering preview' },
  { id: 'save',     label: 'Saving widget' },
];

const WIDGET_KEYWORDS = [
  'widget', 'component', 'tool', 'dashboard', 'calculator', 'timer', 'tracker',
  'counter', 'todo', 'note', 'clock', 'weather', 'pomodoro', 'chart', 'graph',
];
const ACTION_VERBS = ['build', 'make', 'create', 'generate', 'design', 'whip up'];

/**
 * Heuristic: does this user message look like a widget request?
 */
export function detectWidgetIntent(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  const hasVerb = ACTION_VERBS.some((v) => t.includes(v));
  const hasNoun = WIDGET_KEYWORDS.some((k) => t.includes(k));
  return hasVerb && hasNoun;
}

export class WidgetBuilder {
  /**
   * @param {{ ollama?: OllamaClient, ipcSave?: (widget: object) => Promise<any>, model?: string }} [opts]
   */
  constructor({ ollama, ipcSave, model = DEFAULT_MODEL } = {}) {
    this.ollama = ollama || new OllamaClient();
    this.ipcSave = ipcSave; // optional — main process saves to disk
    this.model = model;
  }

  /**
   * Run the full pipeline once.
   *
   * @param {string} userPrompt
   * @param {{
   *   onStage?:  (s: { stage: string, status: 'start'|'done'|'error', durationMs?: number, error?: string }) => void,
   *   onStream?: (text: string, raw?: object) => void,
   *   onLog?:    (line: string) => void,
   *   onMeta?:   (m: object) => void,
   *   signal?:   AbortSignal,
   *   model?:    string,
   *   retry?:    boolean,
   * }} [hooks]
   */
  async run(userPrompt, hooks = {}) {
    const onStage = hooks.onStage || (() => {});
    const onStream = hooks.onStream || (() => {});
    const onLog = hooks.onLog || (() => {});
    const onMeta = hooks.onMeta || (() => {});
    const signal = hooks.signal;
    const model = hooks.model || this.model;

    const stageTimers = {};
    const startStage = (id) => { stageTimers[id] = Date.now(); onStage({ stage: id, status: 'start' }); onLog(`▶ ${id}`); };
    const finishStage = (id) => { onStage({ stage: id, status: 'done', durationMs: Date.now() - (stageTimers[id] || Date.now()) }); onLog(`✓ ${id}`); };
    const failStage = (id, err) => { onStage({ stage: id, status: 'error', error: String(err?.message || err), durationMs: Date.now() - (stageTimers[id] || Date.now()) }); onLog(`✗ ${id}: ${err?.message || err}`); };

    if (!userPrompt || !userPrompt.trim()) {
      throw new Error('WidgetBuilder.run: empty prompt');
    }

    // STAGE 1 — ANALYZE
    startStage('analyze');
    const messages = [
      { role: 'system', content: WIDGET_MODE },
      { role: 'user', content: userPrompt.trim() },
    ];
    finishStage('analyze');

    // STAGES 2 + 3 — PLAN + WRITE (single streaming call, sub-stage tracking)
    startStage('plan');
    let planMarked = false;
    let writeMarked = false;
    let stageWriteStarted = false;

    let fullText = '';
    let result;
    try {
      result = await this.ollama.chat({
        model,
        messages,
        temperature: 0.4,
        topP: 0.9,
        numCtx: 8192,
        signal,
        onToken: (tok, raw) => {
          fullText += tok;
          onStream(fullText, raw);
          // Detect transition: thinking block closed → moving to code
          if (!planMarked && /<<<THINKING_END>>>/i.test(fullText)) {
            planMarked = true;
            finishStage('plan');
          }
          if (planMarked && !stageWriteStarted) {
            stageWriteStarted = true;
            startStage('write');
          }
          if (stageWriteStarted && !writeMarked && /<<<WIDGET_CODE_END>>>/i.test(fullText)) {
            writeMarked = true;
            finishStage('write');
          }
        },
        onMeta,
      });
    } catch (err) {
      // close any open sub-stage
      if (!planMarked) failStage('plan', err);
      else if (!writeMarked) failStage('write', err);
      throw err;
    }
    // Make sure we close stages even if delimiters missing
    if (!planMarked) finishStage('plan');
    if (stageWriteStarted && !writeMarked) finishStage('write');
    if (!stageWriteStarted) { startStage('write'); finishStage('write'); }

    // STAGE 4 — PARSE
    startStage('parse');
    let extracted = extractWidget(fullText, { prompt: userPrompt });
    if (!extracted.ok && !hooks.retry) {
      onLog('parse failed → retrying once with explicit instructions');
      const retryMessages = [
        { role: 'system', content: WIDGET_MODE },
        { role: 'user', content: userPrompt.trim() },
        { role: 'assistant', content: fullText },
        { role: 'user', content: 'Your previous response was missing the required delimiters. Re-emit the SAME widget but strictly wrapped in <<<THINKING_START>>>...<<<THINKING_END>>>, <<<WIDGET_CODE_START>>>...<<<WIDGET_CODE_END>>>, <<<WIDGET_META_START>>>{...}<<<WIDGET_META_END>>>. No other text outside the delimiters.' },
      ];
      const retry = await this.ollama.chat({
        model,
        messages: retryMessages,
        temperature: 0.2,
        signal,
        onToken: (_t, raw) => { fullText = retry?.text || fullText; onStream(fullText, raw); },
      });
      fullText = retry.text;
      extracted = extractWidget(fullText, { prompt: userPrompt });
    }
    if (!extracted.ok) {
      failStage('parse', new Error(extracted.error || 'extraction failed'));
      throw new Error(extracted.error || 'Could not extract widget code from response.');
    }
    finishStage('parse');

    // STAGE 5 — PREVIEW
    startStage('preview');
    const html = buildWidgetIframeHtml({ code: extracted.code, meta: extracted.meta });
    finishStage('preview');

    // STAGE 6 — SAVE
    startStage('save');
    let saved = null;
    if (typeof this.ipcSave === 'function') {
      try {
        const res = await this.ipcSave({
          name: extracted.meta.name,
          description: extracted.meta.description,
          tags: extracted.meta.tags,
          width: extracted.meta.width,
          height: extracted.meta.height,
          code: extracted.code,
          prompt: userPrompt,
        });
        saved = res?.widget || null;
      } catch (err) {
        failStage('save', err);
        throw err;
      }
    }
    finishStage('save');

    return {
      ok: true,
      thinking: extracted.thinking,
      code: extracted.code,
      meta: extracted.meta,
      html,
      saved,
      durationMs: result?.durationMs || 0,
      model: result?.model || model,
      raw: fullText,
    };
  }
}
