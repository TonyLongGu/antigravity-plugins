// ==============================================================================
// 檔案名稱：media/app.js
// 功能說明：Google Antigravity MCP 管理儀表板 - 前端核心控制器 (支援全域聯動多國語言)
// ==============================================================================

(function () {
  'use strict';

  // 取得 VS Code Webview API 物件
  const vscode = acquireVsCodeApi();

  // 全域前端運行時錯誤捕獲 (回報至後端 Extension Host 杜絕靜默白畫面)
  window.addEventListener('error', (event) => {
    try {
      vscode.postMessage({
        type: 'showError',
        message: `[MCP Manager 前端錯誤] ${event.message} (${event.filename ? event.filename.split('/').pop() : 'inline'}:${event.lineno})`,
      });
    } catch (e) {}
  });

  window.addEventListener('unhandledrejection', (event) => {
    try {
      const reason = event.reason?.message || event.reason || '未知非同步例外';
      vscode.postMessage({
        type: 'showError',
        message: `[MCP Manager 未處理 Promise] ${reason}`,
      });
    } catch (e) {}
  });

  /**
   * Lucide / Linear 原生圓角線性向量圖示庫 (Inline SVG 零外部請求自包含)
   */
  const Icons = {
    server: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></svg>',
    globe: '<svg class="lucide-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
    collapseAll: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="m4 14 8-8 8 8"/><path d="m4 20 8-8 8 8"/></svg>',
    expandAll: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="m4 10 8 8 8-8"/><path d="m4 4 8 8 8-8"/></svg>',
    zap: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>',
    refresh: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
    search: '<svg class="lucide-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    chevronRight: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
    copy: '<svg class="lucide-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
    edit: '<svg class="lucide-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
    terminal: '<svg class="lucide-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>'
  };

  /**
   * HTML 字串轉義防護
   */
  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ============================================================================
  // 1. Toast 浮動提示模組
  // ============================================================================
  const ToastModule = {
    container: document.getElementById('toast-container'),
    escapeHtml(str) {
      if (typeof str !== 'string') return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    },
    show(message, type = 'info', duration = 2200) {
      if (!this.container) return;
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.innerHTML = `<span>${this.escapeHtml(message)}</span>`;

      this.container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.2s ease';
        setTimeout(() => toast.remove(), 200);
      }, duration);
    },
  };

  // ============================================================================
  // 2. 國際化核心模組 (I18n Module - 支援外部獨立 JSON 與全域聯動)
  // ============================================================================
  const I18nModule = {
    currentLang: 'zh-TW',

    init() {
      // 優先從 application/json 標籤安全解析後端注入之初始資料
      try {
        const dataEl = document.getElementById('i18n-locales-data');
        if (dataEl && dataEl.textContent) {
          const parsed = JSON.parse(dataEl.textContent);
          if (parsed && typeof parsed === 'object') {
            if (parsed.locales) window.LOCALES = parsed.locales;
            if (parsed.initialLocale) window.INITIAL_LOCALE = parsed.initialLocale;
            if (parsed.hostKind) window.HOST_KIND = parsed.hostKind;
            if (parsed.envName) window.ENV_NAME = parsed.envName;
          }
        }
      } catch (e) {
        console.warn('解析 i18n-locales-data 失敗:', e);
      }

      // 優先使用後端注入之全域設定，其次讀取本機快取
      const initial = (typeof window !== 'undefined' && window.INITIAL_LOCALE) || null;
      let saved = null;
      try {
        saved = localStorage.getItem('antigravity_locale');
      } catch (e) {}

      if (initial === 'zh-TW' || initial === 'en') {
        this.currentLang = initial;
      } else if (saved === 'zh-TW' || saved === 'en') {
        this.currentLang = saved;
      } else {
        this.currentLang = 'zh-TW';
      }

      this.applyLanguage(this.currentLang, false);

      const btnLang = document.getElementById('btn-lang-toggle');
      if (btnLang) {
        btnLang.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.toggle();
        });
      }
    },

    t(key, params = {}) {
      const locales = window.LOCALES || {};
      const dict = locales[this.currentLang] || locales['zh-TW'] || {};
      let text = dict[key] !== undefined ? dict[key] : key;
      if (typeof text === 'string') {
        Object.keys(params).forEach((p) => {
          text = text.replace(new RegExp(`\\{${p}\\}`, 'g'), params[p]);
        });
      }
      return text;
    },

    toggle() {
      const next = this.currentLang === 'zh-TW' ? 'en' : 'zh-TW';
      // 1. 本地即時應用
      this.applyLanguage(next, true);
      // 2. 通知後端寫入全域設定並廣播所有外掛
      vscode.postMessage({ type: 'setGlobalLocale', locale: next });
      ToastModule.show(this.t('toast_lang_switched'), 'info', 1800);
    },

    applyLanguage(lang, save = true) {
      this.currentLang = lang;
      if (save) {
        try {
          localStorage.setItem('antigravity_locale', lang);
        } catch (e) {}
      }

      document.documentElement.lang = lang === 'zh-TW' ? 'zh-TW' : 'en';

      const langIndicator = document.getElementById('lang-indicator');
      const btnLang = document.getElementById('btn-lang-toggle');
      if (langIndicator) {
        langIndicator.textContent = this.t('btn_lang_indicator');
      }
      if (btnLang) {
        btnLang.title = this.t('btn_lang_toggle_title');
      }

      // 遍歷靜態 data-i18n
      document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (key) {
          const trans = this.t(key);
          if (trans !== undefined) {
            if (typeof trans === 'string' && trans.includes('<') && trans.includes('>')) {
              el.innerHTML = trans;
            } else {
              el.textContent = trans;
            }
          }
        }
      });

      // 遍歷靜態 data-i18n-title
      document.querySelectorAll('[data-i18n-title]').forEach((el) => {
        const key = el.getAttribute('data-i18n-title');
        if (key) {
          el.title = this.t(key);
        }
      });

      // 遍歷靜態 data-i18n-placeholder
      document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) {
          el.placeholder = this.t(key);
        }
      });

      // 重新渲染伺服器卡片中的多國語言文字
      GlobalConfigModule.render();
    }
  };

  // ============================================================================
  // 3. 伺服器標籤與屬性解析輔助工具
  // ============================================================================
  const ServerTagHelper = {
    getServerTags(serverConfig) {
      const tags = [];
      if (!serverConfig) return tags;

      if (serverConfig.command) {
        const cmd = serverConfig.command.toLowerCase();
        if (cmd.includes('node')) tags.push({ label: 'Node', class: 'tag-runtime' });
        else if (cmd.includes('python')) tags.push({ label: 'Python', class: 'tag-runtime' });
        else if (cmd.includes('uv')) tags.push({ label: 'UV', class: 'tag-runtime' });
        else if (cmd.includes('npx')) tags.push({ label: 'NPX', class: 'tag-runtime' });
        else tags.push({ label: 'CLI', class: 'tag-runtime' });

        tags.push({ label: 'Stdio', class: 'tag-type' });
      } else if (serverConfig.serverUrl) {
        tags.push({ label: 'Remote', class: 'tag-runtime' });
        tags.push({ label: 'SSE/HTTP', class: 'tag-type' });
      }
      return tags;
    },
  };

  // ============================================================================
  // 4. 探針測速與連線狀態模組 (ProbeModule)
  // ============================================================================
  const ProbeModule = {
    results: {}, // key: 'name' -> { status: 'idle'|'testing'|'ok'|'fail', message: string, latency: number }

    setTesting(name) {
      this.results[name] = { status: 'testing' };
    },

    handleResult(data) {
      const { name, result } = data;
      if (result.ok) {
        this.results[name] = {
          status: 'ok',
          message: result.message || I18nModule.t('status_ok_default'),
          messageKey: result.messageKey,
          messageParams: result.messageParams,
          latency: result.latency || 0,
        };
      } else {
        this.results[name] = {
          status: 'fail',
          message: result.message || I18nModule.t('status_fail_default'),
          messageKey: result.messageKey,
          messageParams: result.messageParams,
          latency: result.latency || 0,
        };
      }
      GlobalConfigModule.render();
    },

    formatMessage(result) {
      if (!result) return '';
      if (result.messageKey) {
        return I18nModule.t(result.messageKey, result.messageParams || {});
      }
      // 防呆兼容舊字串與無 messageKey 之情境
      const msg = result.message || '';
      if (msg.includes('進程運作中')) return I18nModule.t('probe_process_running');
      if (msg.includes('服務常駐運作中')) return I18nModule.t('probe_daemon_running');
      if (msg.includes('回應正常')) return I18nModule.t('probe_response_ok');
      if (msg.includes('指令可正常執行')) return I18nModule.t('probe_exit_ok');
      if (msg.includes('進程異常結束')) return I18nModule.t('probe_exit_fail', { code: (result.messageParams && result.messageParams.code) || '' });
      if (msg.includes('連線超時')) return I18nModule.t('probe_timeout');
      if (msg.includes('連線正常')) return I18nModule.t('status_ok_default');
      if (msg.includes('無法連線') || msg.includes('連線失敗')) return I18nModule.t('status_fail_default');
      return msg;
    },

    testServer(name) {
      this.setTesting(name);
      GlobalConfigModule.render();
      vscode.postMessage({
        type: 'testServer',
        scope: 'global',
        name,
      });
    },

    async testAll() {
      const globalServers = (GlobalConfigModule.data && GlobalConfigModule.data.config && GlobalConfigModule.data.config.mcpServers) || {};
      const globalKeys = Object.keys(globalServers);

      if (globalKeys.length === 0) {
        ToastModule.show(I18nModule.t('toast_no_servers_to_test'), 'info');
        return;
      }

      ToastModule.show(I18nModule.t('toast_testing_all', { count: globalKeys.length }), 'info', 1800);

      for (const name of globalKeys) {
        this.testServer(name);
        // 微小間隔避免並發風暴
        await new Promise((r) => setTimeout(r, 120));
      }
    },
  };

  // ============================================================================
  // 5. 全域配置模組 (GlobalConfigModule)
  // ============================================================================
  const GlobalConfigModule = {
    data: null,
    searchQuery: '',
    currentFilter: 'all',
    openedServers: new Set(),
    pendingToggles: new Map(), // 樂觀更新鎖 Map<serverName, { disabled: boolean, timestamp: number }>
    isBatchExpanding: false,

    // 收合所有展開的二級子卡片 (對齊 context-inspector 規範)
    collapseAllSubcards() {
      const openCards = document.querySelectorAll('.container details.server-card[open]');
      if (openCards.length > 0) {
        openCards.forEach((el) => {
          el.open = false;
          // 若卡片內處於編輯說明狀態，還原為檢視模式
          const descDisplay = el.querySelector('.server-desc-display');
          const descEditor = el.querySelector('.server-desc-editor');
          if (descDisplay && descEditor && descEditor.style.display !== 'none') {
            descEditor.style.display = 'none';
            descDisplay.style.display = 'flex';
          }
        });
      }
      this.openedServers.clear();
    },

    dom: {
      btnOpenConfig: document.getElementById('btn-open-global-config'),
      searchInput: document.getElementById('global-search-input'),
      btnClearSearch: document.getElementById('btn-clear-global-search'),
      statTotal: document.getElementById('stat-global-total'),
      statEnabled: document.getElementById('stat-global-enabled'),
      statDisabled: document.getElementById('stat-global-disabled'),
      btnEnableAll: document.getElementById('btn-global-enable-all'),
      btnDisableAll: document.getElementById('btn-global-disable-all'),
      btnInvert: document.getElementById('btn-global-invert'),
      listContainer: document.getElementById('global-servers-list'),
      emptyState: document.getElementById('global-empty-state'),
      filterPills: document.querySelectorAll('.pill[data-scope="global"]'),
    },

    init() {
      if (this.dom.btnOpenConfig) {
        this.dom.btnOpenConfig.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: 'openGlobalConfig' });
        });
      }

      if (this.dom.searchInput) {
        this.dom.searchInput.value = this.searchQuery;
        this.dom.searchInput.addEventListener('input', (e) => {
          this.searchQuery = e.target.value;
          if (this.dom.btnClearSearch) {
            this.dom.btnClearSearch.style.display = this.searchQuery ? 'block' : 'none';
          }
          this.render();
          App.saveState();
        });
      }

      if (this.dom.btnClearSearch) {
        this.dom.btnClearSearch.addEventListener('click', () => {
          this.searchQuery = '';
          this.dom.searchInput.value = '';
          this.dom.btnClearSearch.style.display = 'none';
          this.render();
          App.saveState();
        });
      }

      this.dom.filterPills.forEach((pill) => {
        pill.addEventListener('click', () => {
          this.dom.filterPills.forEach((p) => p.classList.remove('active'));
          pill.classList.add('active');
          this.currentFilter = pill.getAttribute('data-filter') || 'all';
          this.render();
          App.saveState();
        });
      });

      const applyBatchOptimistic = (action) => {
        if (!this.data || !this.data.config) return;
        const servers = this.data.config.mcpServers || {};
        const now = Date.now();
        let total = 0;
        let enabled = 0;
        let disabled = 0;

        this.pendingToggles.clear();

        for (const [key, server] of Object.entries(servers)) {
          total++;
          const currentDisabled = server.disabled === true;
          let newDisabled = currentDisabled;
          if (action === 'enable_all') newDisabled = false;
          else if (action === 'disable_all') newDisabled = true;
          else if (action === 'invert') newDisabled = !currentDisabled;

          server.disabled = newDisabled;
          if (newDisabled) disabled++;
          else enabled++;

          // 設置樂觀更新鎖
          this.pendingToggles.set(key, {
            disabled: newDisabled,
            timestamp: now,
          });
        }

        // 就地更新統計數據並立即 0ms 重新渲染
        this.data.stats = { total, enabled, disabled };
        this.render();
      };

      if (this.dom.btnEnableAll) {
        this.dom.btnEnableAll.addEventListener('click', () => {
          applyBatchOptimistic('enable_all');
          vscode.postMessage({ type: 'batchToggleGlobal', action: 'enable_all' });
        });
      }

      if (this.dom.btnDisableAll) {
        this.dom.btnDisableAll.addEventListener('click', () => {
          applyBatchOptimistic('disable_all');
          vscode.postMessage({ type: 'batchToggleGlobal', action: 'disable_all' });
        });
      }

      if (this.dom.btnInvert) {
        this.dom.btnInvert.addEventListener('click', () => {
          applyBatchOptimistic('invert');
          vscode.postMessage({ type: 'batchToggleGlobal', action: 'invert' });
        });
      }
    },

    update(globalData) {
      this.data = globalData;
      this.render();
    },

    render() {
      if (!this.data) return;

      const servers = (this.data.config && this.data.config.mcpServers) || {};
      const stats = this.data.stats || { total: 0, enabled: 0, disabled: 0 };
      const serverKeys = Object.keys(servers);
      const query = this.searchQuery.toLowerCase().trim();
      const filter = this.currentFilter;

      // 更新統計 Badge
      if (this.dom.statTotal) this.dom.statTotal.textContent = stats.total;
      if (this.dom.statEnabled) this.dom.statEnabled.textContent = stats.enabled;
      if (this.dom.statDisabled) this.dom.statDisabled.textContent = stats.disabled;

      // 過濾項目（支援比對名稱、指令、URL 與用途說明 description）
      const filteredKeys = serverKeys.filter((key) => {
        const s = servers[key];
        const isEnabled = s.disabled !== true;

        if (filter === 'enabled' && !isEnabled) return false;
        if (filter === 'disabled' && isEnabled) return false;

        if (query) {
          const matchName = key.toLowerCase().includes(query);
          const matchCmd = s.command && s.command.toLowerCase().includes(query);
          const matchUrl = s.serverUrl && s.serverUrl.toLowerCase().includes(query);
          const matchDesc = s.description && s.description.toLowerCase().includes(query);
          return matchName || matchCmd || matchUrl || matchDesc;
        }
        return true;
      });

      if (!this.dom.listContainer) return;

      // ─── 智慧就地比對（In-place Patching）：防止開關切換時卡片重構閃爍 ───
      const existingCards = Array.from(this.dom.listContainer.querySelectorAll('.server-card'));
      const existingKeys = existingCards.map((c) => c.getAttribute('data-name'));
      const canInPlacePatch =
        existingKeys.length === filteredKeys.length &&
        existingKeys.length > 0 &&
        existingKeys.every((k, idx) => k === filteredKeys[idx]);

      if (canInPlacePatch) {
        existingCards.forEach((card, idx) => {
          const key = filteredKeys[idx];
          const server = servers[key];
          let isEnabled = server.disabled !== true;

          // 樂觀更新鎖判定 (避坑鐵律第 85 條：2.5 秒內若後端尚未同步，優先以前端最新點擊狀態為準)
          if (this.pendingToggles.has(key)) {
            const pending = this.pendingToggles.get(key);
            if (Date.now() - pending.timestamp < 2500) {
              if (pending.disabled === !isEnabled) {
                this.pendingToggles.delete(key); // 後端已同步，釋放鎖
              } else {
                isEnabled = !pending.disabled; // 後端尚未同步，維持樂觀狀態
              }
            } else {
              this.pendingToggles.delete(key);
            }
          }

          const testResult = ProbeModule.results[key];

          // 1. 就地切換卡片啟用狀態 class
          card.classList.toggle('disabled', !isEnabled);

          // 2. 就地更新測試狀態 class 與 title
          card.classList.remove('status-tested-ok', 'status-tested-fail', 'status-tested-testing');
          let cardTitle = key;
          if (testResult) {
            const displayMsg = ProbeModule.formatMessage(testResult);
            const latencyText = testResult.latency ? ` (${testResult.latency}ms)` : '';
            if (testResult.status === 'ok') {
              card.classList.add('status-tested-ok');
              cardTitle = `${key}\n${I18nModule.t('status_ok_prefix')} ${displayMsg}${latencyText}`;
            } else if (testResult.status === 'fail') {
              card.classList.add('status-tested-fail');
              cardTitle = `${key}\n${I18nModule.t('status_fail_prefix')} ${displayMsg}`;
            } else if (testResult.status === 'testing') {
              card.classList.add('status-tested-testing');
              cardTitle = `${key}\n${I18nModule.t('status_testing')}`;
            }
          }
          card.title = cardTitle;

          // 3. 就地同步 Checkbox 狀態 (若狀態已一致則不賦值，防止焦點或動畫中斷)
          const checkbox = card.querySelector('input[type="checkbox"]');
          if (checkbox && checkbox.checked !== isEnabled) {
            checkbox.checked = isEnabled;
          }

          // 4. 就地更新測試按鈕樣式與提示
          const btnTest = card.querySelector('.btn-test');
          if (btnTest) {
            btnTest.classList.remove('is-testing', 'status-ok', 'status-fail');
            let btnTestDynamicTitle = I18nModule.t('btn_test_title');
            if (testResult) {
              const displayMsg = ProbeModule.formatMessage(testResult);
              const latencyText = testResult.latency ? ` (${testResult.latency}ms)` : '';
              if (testResult.status === 'testing') {
                btnTest.classList.add('is-testing');
                btnTestDynamicTitle = `${I18nModule.t('btn_test_title')} (${I18nModule.t('status_testing')})`;
              } else if (testResult.status === 'ok') {
                btnTest.classList.add('status-ok');
                btnTestDynamicTitle = `${displayMsg}${latencyText}`;
              } else if (testResult.status === 'fail') {
                btnTest.classList.add('status-fail');
                btnTestDynamicTitle = `${displayMsg}`;
              }
            }
            btnTest.title = btnTestDynamicTitle;
          }

          // 5. 就地更新用途說明文字 (若目前未處於開啟編輯狀態)
          const descEditor = card.querySelector('.server-desc-editor');
          const descText = card.querySelector('.server-desc-text');
          if (descText && (!descEditor || descEditor.style.display !== 'flex')) {
            const desc = server.description || '';
            descText.textContent = desc || I18nModule.t('desc_empty_placeholder');
            descText.classList.toggle('is-empty', !desc);
          }

          // 6. 就地更新卡片內部多國語言按鈕與提示 (防止語系切換時按鈕殘留舊語言)
          const btnEditDesc = card.querySelector('.btn-edit-desc');
          if (btnEditDesc) {
            btnEditDesc.title = I18nModule.t('btn_edit_desc');
            const span = btnEditDesc.querySelector('span');
            if (span) span.textContent = I18nModule.t('btn_edit_desc');
          }
          const descDisplay = card.querySelector('.server-desc-display');
          if (descDisplay) {
            descDisplay.title = I18nModule.t('btn_edit_desc');
          }
          const descTextarea = card.querySelector('.desc-textarea');
          if (descTextarea) {
            descTextarea.placeholder = I18nModule.t('desc_input_placeholder');
          }
          const btnSaveDesc = card.querySelector('.btn-desc-save');
          if (btnSaveDesc) btnSaveDesc.textContent = I18nModule.t('btn_save_desc');
          const btnCancelDesc = card.querySelector('.btn-desc-cancel');
          if (btnCancelDesc) btnCancelDesc.textContent = I18nModule.t('btn_cancel_desc');
        });

        if (this.dom.emptyState) this.dom.emptyState.style.display = 'none';
        return; // 零 DOM 銷毀，平滑完成狀態同步
      }

      this.dom.listContainer.innerHTML = '';

      if (filteredKeys.length === 0) {
        if (this.dom.emptyState) {
          this.dom.emptyState.style.display = 'block';
          const emptySpan = this.dom.emptyState.querySelector('span');
          if (emptySpan) emptySpan.textContent = I18nModule.t('empty_servers');
        }
        return;
      }
      if (this.dom.emptyState) this.dom.emptyState.style.display = 'none';

      filteredKeys.forEach((key) => {
        const server = servers[key];
        let isEnabled = server.disabled !== true;

        if (this.pendingToggles.has(key)) {
          const pending = this.pendingToggles.get(key);
          if (Date.now() - pending.timestamp < 2500) {
            if (pending.disabled === !isEnabled) {
              this.pendingToggles.delete(key);
            } else {
              isEnabled = !pending.disabled;
            }
          } else {
            this.pendingToggles.delete(key);
          }
        }

        const testResult = ProbeModule.results[key];

        let statusClass = '';
        let cardTitle = key;
        if (testResult) {
          const displayMsg = ProbeModule.formatMessage(testResult);
          const latencyText = testResult.latency ? ` (${testResult.latency}ms)` : '';
          if (testResult.status === 'ok') {
            statusClass = 'status-tested-ok';
            cardTitle = `${key}\n${I18nModule.t('status_ok_prefix')} ${displayMsg}${latencyText}`;
          } else if (testResult.status === 'fail') {
            statusClass = 'status-tested-fail';
            cardTitle = `${key}\n${I18nModule.t('status_fail_prefix')} ${displayMsg}`;
          } else if (testResult.status === 'testing') {
            statusClass = 'status-tested-testing';
            cardTitle = `${key}\n${I18nModule.t('status_testing')}`;
          }
        }

        const isOpen = this.openedServers.has(key);

        const card = document.createElement('details');
        card.className = `server-card ${isEnabled ? '' : 'disabled'} ${statusClass}`;
        card.title = cardTitle;
        card.setAttribute('data-name', key);
        if (isOpen) {
          card.setAttribute('open', '');
        }

        let btnTestStatusClass = '';
        let btnTestDynamicTitle = I18nModule.t('btn_test_title');
        if (testResult) {
          const displayMsg = ProbeModule.formatMessage(testResult);
          const latencyText = testResult.latency ? ` (${testResult.latency}ms)` : '';
          if (testResult.status === 'testing') {
            btnTestStatusClass = 'is-testing';
            btnTestDynamicTitle = `${I18nModule.t('btn_test_title')} (${I18nModule.t('status_testing')})`;
          } else if (testResult.status === 'ok') {
            btnTestStatusClass = 'status-ok';
            btnTestDynamicTitle = `${displayMsg}${latencyText}`;
          } else if (testResult.status === 'fail') {
            btnTestStatusClass = 'status-fail';
            btnTestDynamicTitle = `${displayMsg}`;
          }
        }
        const editDescLabel = I18nModule.t('btn_edit_desc');

        card.innerHTML = `
          <summary class="server-card-summary">
            <div class="server-info-left">
              <span class="server-chevron">${Icons.chevronRight}</span>
              <div class="server-title-wrap">
                <span class="server-name">${escapeHtml(key)}</span>
              </div>
            </div>
            <div class="server-controls-right">
              <button class="btn-test ${btnTestStatusClass}" data-name="${escapeHtml(key)}" title="${escapeHtml(btnTestDynamicTitle)}">${Icons.zap}</button>
              <label class="switch">
                <input type="checkbox" ${isEnabled ? 'checked' : ''} data-name="${escapeHtml(key)}">
                <span class="slider"></span>
              </label>
            </div>
          </summary>

          <div class="server-detail-body">
            <div class="server-action-bar">
              <button class="action-btn btn-edit-desc" data-i18n-title="btn_edit_desc" title="${escapeHtml(editDescLabel)}">${Icons.edit} <span data-i18n="btn_edit_desc">${escapeHtml(editDescLabel)}</span></button>
            </div>

            <div class="server-desc-wrap">
              <div class="server-desc-display" data-i18n-title="btn_edit_desc" title="${escapeHtml(editDescLabel)}">
                <div class="server-desc-text ${server.description ? '' : 'is-empty'}">${escapeHtml(server.description || I18nModule.t('desc_empty_placeholder'))}</div>
              </div>
              <div class="server-desc-editor" style="display: none;">
                <textarea class="desc-textarea" data-i18n-placeholder="desc_input_placeholder" placeholder="${escapeHtml(I18nModule.t('desc_input_placeholder'))}">${escapeHtml(server.description || '')}</textarea>
                <div class="desc-editor-actions">
                  <button class="btn-desc-save" data-i18n="btn_save_desc">${escapeHtml(I18nModule.t('btn_save_desc'))}</button>
                  <button class="btn-desc-cancel" data-i18n="btn_cancel_desc">${escapeHtml(I18nModule.t('btn_cancel_desc'))}</button>
                </div>
              </div>
            </div>
          </div>
        `;

        // 監聽折疊狀態變化
        card.addEventListener('toggle', () => {
          if (card.open) {
            // 當單一卡片展開時，自動收合其他卡片 (維持焦點單一清晰)
            if (!this.isBatchExpanding) {
              document.querySelectorAll('.container details.server-card[open]').forEach((el) => {
                if (el !== card) {
                  el.open = false;
                  const otherName = el.getAttribute('data-name');
                  if (otherName) this.openedServers.delete(otherName);
                }
              });
            }
            this.openedServers.add(key);
          } else {
            this.openedServers.delete(key);
          }
        });

        // 綁定 Switch Toggle (防冒泡與樂觀更新鎖)
        const switchLabel = card.querySelector('.switch');
        const checkbox = card.querySelector('input[type="checkbox"]');
        if (switchLabel) {
          switchLabel.addEventListener('click', (e) => e.stopPropagation());
        }
        if (checkbox) {
          checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            const shouldDisable = !e.target.checked;
            card.classList.toggle('disabled', shouldDisable);

            // 設置樂觀更新鎖
            GlobalConfigModule.pendingToggles.set(key, {
              disabled: shouldDisable,
              timestamp: Date.now(),
            });

            vscode.postMessage({
              type: 'toggleGlobalServer',
              name: key,
              disabled: shouldDisable,
            });
          });
        }

        // 綁定測試按鈕 (防冒泡)
        const btnTest = card.querySelector('.btn-test');
        if (btnTest) {
          btnTest.addEventListener('click', (e) => {
            e.stopPropagation();
            ProbeModule.testServer(key);
          });
        }

        // 行內說明編輯邏輯
        const descDisplay = card.querySelector('.server-desc-display');
        const descEditor = card.querySelector('.server-desc-editor');
        const descTextarea = card.querySelector('.desc-textarea');
        const btnEditDesc = card.querySelector('.btn-edit-desc');
        const btnSaveDesc = card.querySelector('.btn-desc-save');
        const btnCancelDesc = card.querySelector('.btn-desc-cancel');
        const descText = card.querySelector('.server-desc-text');

        const enterEditMode = (e) => {
          e.stopPropagation();
          if (!descDisplay || !descEditor || !descTextarea) return;
          descDisplay.style.display = 'none';
          descEditor.style.display = 'flex';
          descTextarea.value = server.description || '';
          descTextarea.focus();
        };

        const exitEditMode = (e) => {
          if (e) e.stopPropagation();
          if (!descDisplay || !descEditor) return;
          descEditor.style.display = 'none';
          descDisplay.style.display = 'flex';
        };

        if (btnEditDesc) btnEditDesc.addEventListener('click', enterEditMode);
        if (descDisplay) descDisplay.addEventListener('click', enterEditMode);
        if (descTextarea) {
          descTextarea.addEventListener('click', (e) => e.stopPropagation());
          descTextarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
              exitEditMode(e);
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              if (btnSaveDesc) btnSaveDesc.click();
            }
          });
        }
        if (btnCancelDesc) btnCancelDesc.addEventListener('click', exitEditMode);
        if (btnSaveDesc) {
          btnSaveDesc.addEventListener('click', (e) => {
            e.stopPropagation();
            const newDesc = descTextarea ? descTextarea.value.trim() : '';
            server.description = newDesc;
            if (descText) {
              if (newDesc) {
                descText.textContent = newDesc;
                descText.classList.remove('is-empty');
              } else {
                descText.textContent = I18nModule.t('desc_empty_placeholder');
                descText.classList.add('is-empty');
              }
            }
            exitEditMode();
            vscode.postMessage({
              type: 'updateServerDescription',
              name: key,
              description: newDesc,
            });
          });
        }

        this.dom.listContainer.appendChild(card);
      });
    },
  };

  // ============================================================================
  // 6. 全域滑鼠右鍵平滑拖曳滾動模組 (RMB Drag Scroll Module - Hand Pan Mode)
  // ============================================================================
  const DragScrollModule = {
    init() {
      let isRmbDown = false;
      let hasDragged = false;
      let startY = 0;
      let lastY = 0;
      let accumulatedDeltaY = 0;
      let rafId = null;
      const speed = 3.6;

      const flushScroll = () => {
        if (accumulatedDeltaY !== 0) {
          const curScroll = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
          const nextScroll = curScroll - accumulatedDeltaY * speed;
          window.scrollTo(0, nextScroll);
          if (document.documentElement) document.documentElement.scrollTop = nextScroll;
          if (document.body) document.body.scrollTop = nextScroll;
          accumulatedDeltaY = 0;
        }
        rafId = null;
      };

      const endDrag = () => {
        if (isRmbDown) {
          isRmbDown = false;
          if (rafId) {
            cancelAnimationFrame(rafId);
            flushScroll();
          }
          document.body.classList.remove('is-rmb-dragging');
        }
      };

      window.addEventListener('mousedown', (e) => {
        if (e.button !== 2) return;
        if (e.target && typeof e.target.closest === 'function' && e.target.closest('input, textarea, select, [contenteditable="true"]')) {
          return;
        }
        isRmbDown = true;
        hasDragged = false;
        startY = e.clientY;
        lastY = e.clientY;
        accumulatedDeltaY = 0;
      });

      window.addEventListener('mousemove', (e) => {
        if (!isRmbDown) return;
        if ((e.buttons & 2) === 0) {
          endDrag();
          return;
        }

        const currentY = e.clientY;
        const totalDeltaFromStart = currentY - startY;

        if (!hasDragged && Math.abs(totalDeltaFromStart) > 3) {
          hasDragged = true;
          document.body.classList.add('is-rmb-dragging');
          lastY = currentY;
        }

        if (hasDragged) {
          e.preventDefault();
          const stepDelta = currentY - lastY;
          lastY = currentY;
          accumulatedDeltaY += stepDelta;
          if (!rafId) {
            rafId = requestAnimationFrame(flushScroll);
          }
        }
      });

      window.addEventListener('mouseup', (e) => {
        if (e.button === 2) {
          endDrag();
          if (hasDragged) {
            setTimeout(() => {
              hasDragged = false;
            }, 150);
          }
        }
      });

      window.addEventListener('blur', () => {
        endDrag();
        hasDragged = false;
      });

      // 全面禁用非文字輸入區之原生右鍵選單（杜絕「剪下、貼上」奪取焦點導致面板異常）
      // 僅在文字輸入框或可編輯區放行原生右鍵以利貼上操作
      window.addEventListener(
        'contextmenu',
        (e) => {
          if (e.target && typeof e.target.closest === 'function' && e.target.closest('input, textarea, select, [contenteditable="true"]')) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          hasDragged = false;
        },
        true
      );
    },
  };

  // ============================================================================
  // 7. 核心分發器與生命週期管理 (App)
  // ============================================================================
  const App = {
    dom: {
      btnCollapseAll: document.getElementById('btn-collapse-all'),
      btnExpandAll: document.getElementById('btn-expand-all'),
      btnRefresh: document.getElementById('btn-refresh'),
      refreshIcon: document.getElementById('refresh-icon'),
      btnTestAll: document.getElementById('btn-test-all'),
    },

    saveState() {
      const stateObj = {
        searchQuery: GlobalConfigModule.searchQuery,
        currentFilter: GlobalConfigModule.currentFilter,
      };
      vscode.setState(stateObj);
    },

    restoreState() {
      const state = vscode.getState() || {};
      if (state.searchQuery) GlobalConfigModule.searchQuery = state.searchQuery;
      if (state.currentFilter) GlobalConfigModule.currentFilter = state.currentFilter;
    },

    init() {
      // 1. 初始化多國語言模組 (Qt 外部解耦字典)
      I18nModule.init();

      this.restoreState();

      // 全部摺疊卡片 (摺疊所有 MCP 伺服器子卡片)
      if (this.dom.btnCollapseAll) {
        this.dom.btnCollapseAll.addEventListener('click', () => {
          GlobalConfigModule.collapseAllSubcards();
        });
      }

      // 全部展開卡片 (展開全域卡片與所有 MCP 伺服器子卡片)
      if (this.dom.btnExpandAll) {
        this.dom.btnExpandAll.addEventListener('click', () => {
          const globalCard = document.getElementById('card-global');
          if (globalCard) globalCard.open = true;
          GlobalConfigModule.isBatchExpanding = true;
          document.querySelectorAll('.container details.server-card').forEach((el) => {
            el.open = true;
          });
          if (GlobalConfigModule.data && GlobalConfigModule.data.config && GlobalConfigModule.data.config.mcpServers) {
            Object.keys(GlobalConfigModule.data.config.mcpServers).forEach((k) => GlobalConfigModule.openedServers.add(k));
          }
          GlobalConfigModule.isBatchExpanding = false;
        });
      }

      // 焦點轉移 / 切換到其他工具時，自動收合所有展開的子卡片 (對齊 context-inspector 規範)
      window.addEventListener('blur', () => {
        GlobalConfigModule.collapseAllSubcards();
      });

      // 頁面切入背景 (Tab 或側邊欄切換) 時自動收合子卡片
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          GlobalConfigModule.collapseAllSubcards();
        }
      });

      // 點擊卡片外部區域（如空白背景、搜尋列等）時自動收合卡片
      document.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('details.server-card') && !e.target.closest('#btn-expand-all')) {
          GlobalConfigModule.collapseAllSubcards();
        }
      });

      GlobalConfigModule.init();
      DragScrollModule.init();

      // 頂部重新整理
      if (this.dom.btnRefresh) {
        this.dom.btnRefresh.addEventListener('click', () => {
          vscode.postMessage({ type: 'getData' });
          ToastModule.show(I18nModule.t('toast_refreshed'), 'info');
        });
      }

      // 頂部一鍵測速
      if (this.dom.btnTestAll) {
        this.dom.btnTestAll.addEventListener('click', () => {
          ProbeModule.testAll();
        });
      }

      // 監聽 Extension Host 傳入訊息
      window.addEventListener('message', (event) => {
        const { type, payload, message, status, locale } = event.data;

        switch (type) {
          case 'localeChanged': {
            if (locale && locale !== I18nModule.currentLang) {
              I18nModule.applyLanguage(locale, true);
            }
            break;
          }

          case 'updateAllData': {
            if (payload && payload.global) {
              GlobalConfigModule.update(payload.global);
            }
            break;
          }

          case 'testResult': {
            ProbeModule.handleResult(event.data);
            break;
          }

          case 'toast': {
            ToastModule.show(message || payload.message, status || (payload && payload.status) || 'info');
            break;
          }

          case 'error': {
            ToastModule.show(message || I18nModule.t('toast_error'), 'error');
            break;
          }
        }
      });

      // 初次請求資料
      vscode.postMessage({ type: 'getData' });
    },
  };

  // 啟動前端控制器
  App.init();
})();
