// ==============================================================================
// 檔案名稱：media/app.js
// 功能說明：Google Antigravity MCP 管理儀表板 - VS Code 側邊欄前端核心 (全域管理)
// 遵循規範：ide-extension-workflow 模組化控制器與 vscode.setState() 狀態保存
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
  // 1. Toast 浮動提示模組 (標準樣式：對齊 AI上下文檢視器)
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
  // 2. 伺服器標籤與屬性解析輔助工具
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
  // 3. 探針測速與連線狀態模組 (ProbeModule)
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
          message: result.message || '連線正常',
          latency: result.latency || 0,
        };
      } else {
        this.results[name] = {
          status: 'fail',
          message: result.message || '連線失敗',
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
        ToastModule.show('未發現可測試的 MCP 伺服器', 'info');
        return;
      }

      ToastModule.show(`開始測試 ${globalKeys.length} 個全域 MCP 伺服器...`, 'info', 1800);

      for (const name of globalKeys) {
        this.testServer(name);
        // 微小間隔避免並發風暴
        await new Promise((r) => setTimeout(r, 120));
      }
    },
  };

  // ============================================================================
  // 4. 全域配置模組 (GlobalConfigModule)
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
        if (this.dom.emptyState) this.dom.emptyState.style.display = 'block';
        return;
      }
      if (this.dom.emptyState) this.dom.emptyState.style.display = 'none';

      filteredKeys.forEach((key) => {
        const server = servers[key];
        const isEnabled = server.disabled !== true;
        const testResult = ProbeModule.results[key];
        const tags = ServerTagHelper.getServerTags(server);

        const card = document.createElement('div');
        let statusClass = '';
        let cardTitle = key;
        if (testResult) {
          if (testResult.status === 'ok') {
            statusClass = 'status-tested-ok';
            cardTitle = `${key}\n[狀態] ${testResult.message}`;
          } else if (testResult.status === 'fail') {
            statusClass = 'status-tested-fail';
            cardTitle = `${key}\n[錯誤] ${testResult.message}`;
          } else if (testResult.status === 'testing') {
            statusClass = 'status-tested-testing';
            cardTitle = `${key}\n[測試中...]`;
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

        card.innerHTML = `
          <div class="server-card-main">
            <div class="server-info-left">
              <div class="status-dot ${dotClass}"></div>
              <div class="server-title-wrap">
                <span class="server-name">${escapeHtml(key)}</span>
              </div>
            </div>
            <div class="server-controls-right">
              <button class="btn-test ${testResult && testResult.status === 'testing' ? 'is-testing' : ''}" data-name="${escapeHtml(key)}" title="測試連線狀態">測試</button>
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
  // 5. 核心分發器與生命週期管理 (App)
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

      // 頂部重新整理
      if (this.dom.btnRefresh) {
        this.dom.btnRefresh.addEventListener('click', () => {
          if (this.dom.refreshIcon) {
            this.dom.refreshIcon.style.animation = 'spin 0.7s linear infinite';
          }
          vscode.postMessage({ type: 'getData' });
          setTimeout(() => {
            if (this.dom.refreshIcon) this.dom.refreshIcon.style.animation = '';
          }, 600);
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
        const { type, payload, message, status } = event.data;

        switch (type) {
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
            ToastModule.show(message || '發生錯誤', 'error');
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
