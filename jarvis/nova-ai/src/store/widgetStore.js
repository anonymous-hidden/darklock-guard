/**
 * widgetStore — the catalogue of generated widgets and the active build state.
 */
import { create } from 'zustand';

export const BUILD_STAGES = ['analyze', 'plan', 'write', 'parse', 'preview', 'save'];

function emptyBuildState() {
  return {
    isBuilding: false,
    prompt: '',
    stage: null,                  // current stage id
    stageStatus: {},              // { [stageId]: 'pending'|'active'|'done'|'error' }
    stageDurations: {},           // { [stageId]: ms }
    streamedText: '',
    extractedCode: '',
    extractedMeta: null,
    thinking: '',
    previewHtml: '',
    error: null,
  };
}

export const useWidgetStore = create((set, get) => ({
  widgets: [],
  loaded: false,
  selectedId: null,

  build: emptyBuildState(),

  setWidgets(list) {
    set({ widgets: Array.isArray(list) ? list : [], loaded: true });
  },

  upsertWidget(w) {
    if (!w || !w.id) return;
    const list = get().widgets.slice();
    const idx = list.findIndex((x) => x.id === w.id);
    if (idx >= 0) list[idx] = w;
    else list.unshift(w);
    set({ widgets: list });
  },

  removeWidget(id) {
    set({ widgets: get().widgets.filter((w) => w.id !== id) });
  },

  selectWidget(id) { set({ selectedId: id }); },

  /* — build pipeline state — */

  resetBuild() {
    set({ build: emptyBuildState() });
  },

  beginBuild(prompt) {
    const initialStatus = BUILD_STAGES.reduce((acc, s) => { acc[s] = 'pending'; return acc; }, {});
    set({
      build: {
        ...emptyBuildState(),
        isBuilding: true,
        prompt: String(prompt || ''),
        stageStatus: initialStatus,
      },
    });
  },

  setStage(stage, status, durationMs) {
    const b = get().build;
    set({
      build: {
        ...b,
        stage: status === 'done' || status === 'error' ? b.stage : stage,
        stageStatus: { ...b.stageStatus, [stage]: status },
        stageDurations: durationMs != null ? { ...b.stageDurations, [stage]: durationMs } : b.stageDurations,
      },
    });
  },

  appendStream(text) {
    set({ build: { ...get().build, streamedText: text } });
  },

  setBuildResult({ code, meta, thinking, html }) {
    set({
      build: {
        ...get().build,
        extractedCode: code || '',
        extractedMeta: meta || null,
        thinking: thinking || '',
        previewHtml: html || '',
      },
    });
  },

  finishBuild() {
    set({ build: { ...get().build, isBuilding: false } });
  },

  setBuildError(err) {
    set({
      build: {
        ...get().build,
        isBuilding: false,
        error: err ? String(err.message || err) : null,
      },
    });
  },
}));
