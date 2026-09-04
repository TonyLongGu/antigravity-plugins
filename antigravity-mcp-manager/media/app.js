// ==============================================================================
// 檔案名稱：media/app.js
// 功能說明：Google Antigravity MCP 管理儀表板 - 前端核心控制器 (支援全域聯動多國語言)
// ==============================================================================

(function () {
  'use strict';

  // 取得 VS Code Webview API 物件
  const vscode = acquireVsCodeApi();

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
    chevronRight: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>'
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
          latency: result.latency || 0,
        };
      } else {
        this.results[name] = {
          status: 'fail',
          message: result.message || I18nModule.t('status_fail_default'),
          latency: result.latency || 0,
        };
      }
      GlobalConfigModule.render();
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

      if (this.dom.btnEnableAll) {
        this.dom.btnEnableAll.addEventListener('click', () => {
          vscode.postMessage({ type: 'batchToggleGlobal', action: 'enable_all' });
        });
      }

      if (this.dom.btnDisableAll) {
        this.dom.btnDisableAll.addEventListener('click', () => {
          vscode.postMessage({ type: 'batchToggleGlobal', action: 'disable_all' });
        });
      }

      if (this.dom.btnInvert) {
        this.dom.btnInvert.addEventListener('click', () => {
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

      // 過濾項目
      const filteredKeys = serverKeys.filter((key) => {
        const s = servers[key];
        const isEnabled = s.disabled !== true;

        if (filter === 'enabled' && !isEnabled) return false;
        if (filter === 'disabled' && isEnabled) return false;

        if (query) {
          const matchName = key.toLowerCase().includes(query);
          const matchCmd = s.command && s.command.toLowerCase().includes(query);
          const matchUrl = s.serverUrl && s.serverUrl.toLowerCase().includes(query);
          return matchName || matchCmd || matchUrl;
        }
        return true;
      });

      if (!this.dom.listContainer) return;
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
        const isEnabled = server.disabled !== true;
        const testResult = ProbeModule.results[key];

        const card = document.createElement('div');
        let statusClass = '';
        let cardTitle = key;
        if (testResult) {
          if (testResult.status === 'ok') {
            statusClass = 'status-tested-ok';
            cardTitle = `${key}\n${I18nModule.t('status_ok_prefix')} ${testResult.message}`;
          } else if (testResult.status === 'fail') {
            statusClass = 'status-tested-fail';
            cardTitle = `${key}\n${I18nModule.t('status_fail_prefix')} ${testResult.message}`;
          } else if (testResult.status === 'testing') {
            statusClass = 'status-tested-testing';
            cardTitle = `${key}\n${I18nModule.t('status_testing')}`;
          }
        }

        card.className = `server-card ${isEnabled ? '' : 'disabled'} ${statusClass}`;
        card.title = cardTitle;

        let dotClass = '';
        if (testResult && testResult.status === 'testing') {
          dotClass = 'testing';
        } else if (isEnabled) {
          dotClass = testResult && testResult.status === 'fail' ? 'error' : 'enabled';
        }

        const btnTestLabel = I18nModule.t('btn_test');
        const btnTestTitle = I18nModule.t('btn_test_title');

        card.innerHTML = `
          <div class="server-card-main">
            <div class="server-info-left">
              <div class="status-dot ${dotClass}"></div>
              <div class="server-title-wrap">
                <span class="server-name">${escapeHtml(key)}</span>
              </div>
            </div>
            <div class="server-controls-right">
              <button class="btn-test ${testResult && testResult.status === 'testing' ? 'is-testing' : ''}" data-name="${escapeHtml(key)}" title="${escapeHtml(btnTestTitle)}">${escapeHtml(btnTestLabel)}</button>
              <label class="switch">
                <input type="checkbox" ${isEnabled ? 'checked' : ''} data-name="${escapeHtml(key)}">
                <span class="slider"></span>
              </label>
            </div>
          </div>
        `;

        // 綁定 Switch Toggle
        const checkbox = card.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', (e) => {
          const shouldDisable = !e.target.checked;
          vscode.postMessage({
            type: 'toggleGlobalServer',
            name: key,
            disabled: shouldDisable,
          });
        });

        // 綁定測試按鈕
        const btnTest = card.querySelector('.btn-test');
        btnTest.addEventListener('click', () => {
          ProbeModule.testServer(key);
        });

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

      window.addEventListener(
        'contextmenu',
        (e) => {
          if (hasDragged) {
            e.preventDefault();
            e.stopPropagation();
            setTimeout(() => {
              hasDragged = false;
            }, 50);
          }
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

      // 全部摺疊卡片 (靜默執行)
      if (this.dom.btnCollapseAll) {
        this.dom.btnCollapseAll.addEventListener('click', () => {
          document.querySelectorAll('.container details').forEach((el) => {
            el.open = false;
          });
        });
      }

      // 全部展開卡片 (靜默執行)
      if (this.dom.btnExpandAll) {
        this.dom.btnExpandAll.addEventListener('click', () => {
          document.querySelectorAll('.container details.card').forEach((el) => {
            el.open = true;
          });
        });
      }

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
