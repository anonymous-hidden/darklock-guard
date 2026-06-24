/**
 * appStore — global app state: active tab, settings, status.
 */
import { create } from 'zustand';
import { AUTO_MODEL, DEFAULT_MODEL, FAST_MODEL, pickBestAiModel } from '@core/ai/AIClient.js';

export const TABS = ['chat', 'command-center', 'widget-studio', 'coding'];

const PERSIST_KEY = 'nova:appStore:v1';

function loadPersisted() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}

function persist(partial) {
  try { localStorage.setItem(PERSIST_KEY, JSON.stringify(partial)); } catch {}
}

const initial = loadPersisted();

export const useAppStore = create((set, get) => ({
  activeTab: TABS.includes(initial.activeTab) ? initial.activeTab : 'chat',
  ollamaHealth: { ok: null, version: null, error: null },
  models: [],
  selectedModel: initial.selectedModel || AUTO_MODEL,
  fastModel: initial.fastModel || FAST_MODEL,
  transparencyOpen: false,
  statusMessage: '',

  setActiveTab(tab) {
    if (!TABS.includes(tab)) return;
    set({ activeTab: tab });
    persist({ activeTab: tab, selectedModel: get().selectedModel, fastModel: get().fastModel });
  },

  setOllamaHealth(h) { set({ ollamaHealth: h }); },
  setModels(models)  {
    const list = Array.isArray(models) ? models : [];
    const names = list.map((m) => m?.name || m?.model || m).filter(Boolean);
    const current = get().selectedModel;
    const selectedModel = current === AUTO_MODEL
      ? AUTO_MODEL
      : (names.includes(current) ? current : AUTO_MODEL);
    const fastModel = names.includes(get().fastModel) ? get().fastModel : pickBestAiModel(list, FAST_MODEL);
    set({ models: list, selectedModel, fastModel });
    persist({ activeTab: get().activeTab, selectedModel, fastModel });
  },

  setSelectedModel(m) {
    set({ selectedModel: m });
    persist({ activeTab: get().activeTab, selectedModel: m, fastModel: get().fastModel });
  },
  setFastModel(m) {
    set({ fastModel: m });
    persist({ activeTab: get().activeTab, selectedModel: get().selectedModel, fastModel: m });
  },

  toggleTransparency() { set({ transparencyOpen: !get().transparencyOpen }); },
  setTransparency(v)   { set({ transparencyOpen: !!v }); },

  setStatusMessage(s) { set({ statusMessage: String(s || '') }); },
}));
