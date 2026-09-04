(function () {
  const vscode = acquireVsCodeApi();

  /**
   * Lucide / Linear 原生圓角線性向量圖示庫 (24x24 SVG, 2px stroke, round join)
   */
  const Icons = {
    robot: '<svg class="lucide-icon" viewBox="0 0 24 24"><rect width="18" height="12" x="3" y="6" rx="2"/><path d="M9 14v1"/><path d="M15 14v1"/><path d="M12 2v4"/><path d="M2 10h1"/><path d="M21 10h1"/></svg>',
    sparkles: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>',
    copy: '<svg class="lucide-icon" viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
    refresh: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
    zap: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>',
    history: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>',
    chevronRight: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
    check: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    pin: '<svg class="lucide-icon" viewBox="0 0 24 24"><line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>',
    split: '<svg class="lucide-icon" viewBox="0 0 24 24"><line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>',
    wand: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>',
    plug: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></svg>',
    folder: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
    globe: '<svg class="lucide-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
    package: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/><path d="m7.5 4.27 9 5.15"/></svg>',
    server: '<svg class="lucide-icon" viewBox="0 0 24 24"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>'
  };
  const Codicons = Icons; // 相容別名

  // 1. Toast 模組
  const Toast = {
    container: document.getElementById('toast-container'),
    escapeHtml(str) {
      if (typeof str !== 'string') return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    }
  };

  // 2. 主應用狀態
  const savedState = vscode.getState() || {};
  let currentData = null;
  let currentMode = savedState.mode || 'live'; // 'live' | 'snapshot'
  let currentConvLimit = savedState.convLimit || 10;
  let selectedConvId = savedState.selectedConvId || null;
  let searchKeyword = '';
  let ruleActiveTitleMode = savedState.ruleActiveTitleMode || 'title'; // 'title' (內文標題) | 'name' (檔案名稱)
  let ruleCondTitleMode = savedState.ruleCondTitleMode || 'title'; // 'title' (內文標題) | 'name' (檔案名稱)
  let skillTitleMode = savedState.skillTitleMode || 'title'; // 'title' (內文標題) | 'name' (技能名稱)
  let allConversations = [];

  // DOM 元素
  const dom = {
    btnLive: document.getElementById('btn-mode-live'),
    btnSnapshot: document.getElementById('btn-mode-snapshot'),
    convWrapper: document.getElementById('conv-select-wrapper'),
    customConvTrigger: document.getElementById('custom-conv-trigger'),
    triggerConvTitle: document.getElementById('trigger-conv-title'),
    triggerConvTime: document.getElementById('trigger-conv-time'),
    customConvPopover: document.getElementById('custom-conv-popover'),
    convSearchInput: document.getElementById('conv-search-input'),
    btnClearSearch: document.getElementById('btn-clear-search'),
    limitPillsContainer: document.getElementById('limit-pills-container'),
    customConvList: document.getElementById('custom-conv-list'),
    metaModel: document.getElementById('meta-model'),

    btnCollapseAll: document.getElementById('btn-collapse-all'),
    btnExpandAll: document.getElementById('btn-expand-all'),
    btnRefresh: document.getElementById('btn-refresh'),
    btnCopy: document.getElementById('btn-copy-summary'),
    btnLangToggle: document.getElementById('btn-lang-toggle'),
    langIndicator: document.getElementById('lang-indicator'),
    modeLabel: document.getElementById('status-mode-label'),
    timeLabel: document.getElementById('status-time-label'),

    btnToggleRulesActiveTitle: document.getElementById('btn-toggle-rules-active-title'),
    badgeRulesActive: document.getElementById('badge-rules-active'),
    listRulesActive: document.getElementById('list-rules-active'),

    btnToggleRulesCondTitle: document.getElementById('btn-toggle-rules-cond-title'),
    badgeRulesConditional: document.getElementById('badge-rules-conditional'),
    listRulesConditional: document.getElementById('list-rules-conditional'),

    btnToggleSkillTitle: document.getElementById('btn-toggle-skill-title'),
    badgeSkills: document.getElementById('badge-skills'),
    listSkills: document.getElementById('list-skills'),

    badgeMcp: document.getElementById('badge-mcp'),
    listMcp: document.getElementById('list-mcp')
  };

  function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function saveState() {
    vscode.setState({
      mode: currentMode,
      convLimit: currentConvLimit,
      selectedConvId: selectedConvId,
      ruleActiveTitleMode: ruleActiveTitleMode,
      ruleCondTitleMode: ruleCondTitleMode,
      skillTitleMode: skillTitleMode
    });
  }

  // ============================================================================
  // 3. 國際化核心模組 (I18n Module)
  // ============================================================================
  const I18nModule = {
    currentLang: 'zh-TW',

    init() {
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

      if (dom.btnLangToggle) {
        dom.btnLangToggle.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.toggle();
        });
      }
    },

    t(key, params = {}) {
      const locales = window.LOCALES || (typeof globalThis !== 'undefined' ? globalThis.LOCALES : null) || {};
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
      this.applyLanguage(next, true);
      vscode.postMessage({ type: 'setGlobalLocale', payload: { locale: next } });
      Toast.show(this.t('toast_lang_switched'), 'info', 1800);
    },

    applyLanguage(lang, save = true) {
      this.currentLang = lang;
      if (save) {
        try {
          localStorage.setItem('antigravity_locale', lang);
        } catch (e) {}
      }

      document.documentElement.lang = lang === 'zh-TW' ? 'zh-TW' : 'en';

      if (dom.langIndicator) {
        dom.langIndicator.textContent = this.t('btn_lang_indicator');
      }
      if (dom.btnLangToggle) {
        dom.btnLangToggle.title = this.t('btn_lang_toggle_title');
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

      // 同步動態介面
      syncModeUI();
      updateToggleButtons();
      updateTriggerDisplay();
      if (dom.customConvPopover && dom.customConvPopover.style.display === 'block') {
        renderCustomConvList();
      }
      if (currentData) {
        renderAll();
      }
    }
  };

  function syncModeUI() {
    if (currentMode === 'snapshot') {
      dom.btnSnapshot?.classList.add('active');
      dom.btnLive?.classList.remove('active');
      if (dom.convWrapper) {
        dom.convWrapper.classList.remove('is-hidden');
        dom.convWrapper.style.display = '';
      }
      updateTriggerDisplay();
    } else {
      dom.btnLive?.classList.add('active');
      dom.btnSnapshot?.classList.remove('active');
      if (dom.convWrapper) {
        dom.convWrapper.classList.add('is-hidden');
        dom.convWrapper.style.display = '';
      }
      closeConvPopover();
    }
    if (dom.modeLabel) {
      dom.modeLabel.textContent = currentMode === 'live' ? I18nModule.t('status_mode_live') : I18nModule.t('status_mode_snapshot');
    }
  }

  function updateToggleButtons() {
    if (dom.btnToggleRulesActiveTitle) {
      if (ruleActiveTitleMode === 'title') {
        dom.btnToggleRulesActiveTitle.textContent = I18nModule.t('btn_title_mode_title');
        dom.btnToggleRulesActiveTitle.title = I18nModule.t('btn_title_mode_title_tooltip');
      } else {
        dom.btnToggleRulesActiveTitle.textContent = I18nModule.t('btn_title_mode_name');
        dom.btnToggleRulesActiveTitle.title = I18nModule.t('btn_title_mode_name_tooltip');
      }
    }
    if (dom.btnToggleRulesCondTitle) {
      if (ruleCondTitleMode === 'title') {
        dom.btnToggleRulesCondTitle.textContent = I18nModule.t('btn_title_mode_title');
        dom.btnToggleRulesCondTitle.title = I18nModule.t('btn_title_mode_title_tooltip');
      } else {
        dom.btnToggleRulesCondTitle.textContent = I18nModule.t('btn_title_mode_name');
        dom.btnToggleRulesCondTitle.title = I18nModule.t('btn_title_mode_name_tooltip');
      }
    }
    if (dom.btnToggleSkillTitle) {
      if (skillTitleMode === 'title') {
        dom.btnToggleSkillTitle.textContent = I18nModule.t('btn_title_mode_title');
        dom.btnToggleSkillTitle.title = I18nModule.t('btn_title_mode_skill_title_tooltip');
      } else {
        dom.btnToggleSkillTitle.textContent = I18nModule.t('btn_title_mode_skill_name');
        dom.btnToggleSkillTitle.title = I18nModule.t('btn_title_mode_skill_name_tooltip');
      }
    }
  }

  // 格式化時間字串（簡短顯示）
  function formatShortTime(mtimeStr, mtimeMs) {
    if (!mtimeMs && !mtimeStr) return '-';
    try {
      const d = mtimeMs ? new Date(mtimeMs) : new Date(mtimeStr);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) {
        return I18nModule.t('time_today', { time: timePart });
      }
      return `${d.getMonth() + 1}/${d.getDate()} ${timePart}`;
    } catch (e) {
      return mtimeStr || '-';
    }
  }

  // 更新 Trigger 按鈕顯示之對話標題與時間
  function updateTriggerDisplay() {
    if (!dom.triggerConvTitle) return;
    if (!allConversations || allConversations.length === 0) {
      dom.triggerConvTitle.textContent = I18nModule.t('conv_empty_no_tasks');
      dom.triggerConvTime.textContent = '-';
      return;
    }

    const currentId = selectedConvId || currentData?.conversationId;
    let target = allConversations.find(c => c.id === currentId);
    if (!target) {
      target = allConversations[0];
      selectedConvId = target.id;
    }

    dom.triggerConvTitle.textContent = target.title || I18nModule.t('conv_snapshot_fallback', { id: target.id.slice(0, 8) });
    dom.triggerConvTitle.title = `${target.title}\nID: ${target.id}`;
    dom.triggerConvTime.textContent = formatShortTime(target.mtimeStr, target.mtime);
  }

  // 渲染自訂 Popover 對話清單
  function renderCustomConvList() {
    if (!dom.customConvList) return;

    // 1. 更新筆數 Pills active 狀態
    if (dom.limitPillsContainer) {
      dom.limitPillsContainer.querySelectorAll('.limit-pill').forEach(pill => {
        const lim = parseInt(pill.getAttribute('data-limit'), 10);
        if (lim === currentConvLimit) {
          pill.classList.add('active');
        } else {
          pill.classList.remove('active');
        }
      });
    }

    if (!allConversations || allConversations.length === 0) {
      dom.customConvList.innerHTML = `<div class="conv-empty-hint">${I18nModule.t('conv_empty_none')}</div>`;
      return;
    }

    const limit = parseInt(currentConvLimit, 10) || 10;
    let filtered = allConversations;

    // 搜尋過濾
    if (searchKeyword.trim()) {
      const q = searchKeyword.trim().toLowerCase();
      filtered = allConversations.filter(c =>
        (c.title && c.title.toLowerCase().includes(q)) ||
        (c.workspace && c.workspace.toLowerCase().includes(q)) ||
        (c.id && c.id.toLowerCase().includes(q)) ||
        (c.mtimeStr && c.mtimeStr.toLowerCase().includes(q))
      );
    }

    const visibleList = filtered.slice(0, limit);

    if (visibleList.length === 0) {
      dom.customConvList.innerHTML = `<div class="conv-empty-hint">${I18nModule.t('conv_empty_search')}</div>`;
      return;
    }

    const currentId = selectedConvId || currentData?.conversationId;
    const wsPrefix = I18nModule.t('conv_item_ws_prefix');

    dom.customConvList.innerHTML = visibleList.map(item => {
      const isSelected = item.id === currentId;
      const displayTime = formatShortTime(item.mtimeStr, item.mtime);

      return `
        <div class="conv-item-card ${isSelected ? 'is-selected' : ''}" data-conv-id="${escapeHtml(item.id)}">
          <div class="conv-item-main">
            <div class="conv-item-title-group">
              <span class="conv-item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
              ${item.workspace ? `<span class="conv-item-ws" title="${wsPrefix}${escapeHtml(item.workspace)}">${escapeHtml(item.workspace)}</span>` : ''}
            </div>
            ${isSelected ? `<span class="conv-item-check">${Icons.check}</span>` : ''}
          </div>
          <div class="conv-item-meta">
            <span class="conv-item-time">${escapeHtml(displayTime)}</span>
          </div>
        </div>
      `;
    }).join('');

    // 綁定項目點擊事件
    dom.customConvList.querySelectorAll('.conv-item-card').forEach(card => {
      card.addEventListener('click', () => {
        const convId = card.getAttribute('data-conv-id');
        if (convId) {
          selectedConvId = convId;
          saveState();
          updateTriggerDisplay();
          closeConvPopover();
          vscode.postMessage({ type: 'fetchData', payload: { mode: 'snapshot', conversationId: convId } });
        }
      });
    });
  }

  function openConvPopover() {
    if (!dom.customConvPopover) return;
    dom.customConvPopover.style.display = 'block';
    dom.customConvTrigger?.classList.add('is-open');
    renderCustomConvList();
    setTimeout(() => {
      dom.convSearchInput?.focus();
    }, 50);
  }

  function closeConvPopover() {
    if (!dom.customConvPopover) return;
    dom.customConvPopover.style.display = 'none';
    dom.customConvTrigger?.classList.remove('is-open');
  }

  function toggleConvPopover() {
    if (dom.customConvPopover?.style.display === 'block') {
      closeConvPopover();
    } else {
      openConvPopover();
    }
  }

  function updateConvDropdown() {
    updateTriggerDisplay();
    if (dom.customConvPopover?.style.display === 'block') {
      renderCustomConvList();
    }
  }

  // 渲染清單核心函式
  function renderAll() {
    if (!currentData) return;

    // 紀錄當前已展開項目的 Key，重新渲染時精確恢復 open 狀態
    const openedKeys = new Set();
    document.querySelectorAll('.context-item-details[open]').forEach(el => {
      const k = el.getAttribute('data-item-key');
      if (k) openedKeys.add(k);
    });

    dom.timeLabel.textContent = currentData.timestamp ? new Date(currentData.timestamp).toLocaleTimeString() : '';
    dom.modeLabel.textContent = currentMode === 'live' ? I18nModule.t('status_mode_live') : I18nModule.t('status_mode_snapshot');
    updateToggleButtons();

    const isMultiWs = (currentData.workspaces && currentData.workspaces.length > 1);
    const showSourceTag = isMultiWs || currentMode === 'snapshot';

    // 1. 常駐規範
    const activeRules = currentData.rules?.alwaysActive || [];
    dom.badgeRulesActive.textContent = I18nModule.t('unit_items', { count: activeRules.length });
    if (activeRules.length === 0) {
      dom.listRulesActive.innerHTML = `<div class="empty-state">${currentMode === 'snapshot' ? I18nModule.t('empty_rules_active_snapshot') : I18nModule.t('empty_rules_active_live')}</div>`;
    } else {
      dom.listRulesActive.innerHTML = activeRules.map(r => {
        const baseName = (r.name || '').replace(/\.md$/i, '');
        const displayName = (ruleActiveTitleMode === 'name') ? (r.name || baseName) : (r.displayName || r.name || baseName);
        const itemKey = r.filePath || r.name;
        const isOpen = openedKeys.has(itemKey);
        const btnCopyTitle = I18nModule.t('btn_copy_rule_name_title', { name: baseName });
        const btnRevealTitle = I18nModule.t('btn_reveal_rule_title');
        const btnOpenTitle = I18nModule.t('btn_open_rule_title');
        const sourceTitle = I18nModule.t('tag_source_title', { source: r.source || '' });

        return `
          <details class="context-item-details ${r.isInvoked ? 'highlight-invoked' : ''}" data-item-key="${escapeHtml(itemKey)}" ${isOpen ? 'open' : ''}>
            <summary class="item-summary">
              <div class="item-title-group">
                <span class="item-chevron">${Codicons.chevronRight}</span>
                <span class="item-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
              </div>
              ${showSourceTag && r.source ? `<span class="item-source-tag" title="${escapeHtml(sourceTitle)}">${escapeHtml(r.source)}</span>` : ''}
            </summary>
            <div class="item-detail-body">
              <div class="item-action-bar">
                <button class="action-btn btn-copy-name" data-copy="${escapeHtml(baseName)}" title="${escapeHtml(btnCopyTitle)}">${I18nModule.t('btn_copy_name')}</button>
                <button class="action-btn btn-reveal-path" data-path="${escapeHtml(r.filePath)}" title="${escapeHtml(btnRevealTitle)}">${I18nModule.t('btn_reveal_path')}</button>
                ${r.filePath ? `<button class="action-btn btn-open-file" data-path="${escapeHtml(r.filePath)}" title="${escapeHtml(btnOpenTitle)}">${I18nModule.t('btn_open_file')}</button>` : ''}
              </div>
              <div class="item-desc">${escapeHtml(r.description || I18nModule.t('desc_none'))}</div>
            </div>
          </details>
        `;
      }).join('');
    }

    // 2. 條件式規範
    let rawCondRules = currentData.rules?.conditional || [];
    if (currentMode === 'snapshot') {
      rawCondRules = rawCondRules.filter(r => r.isInvoked);
    }
    const condRules = rawCondRules;
    dom.badgeRulesConditional.textContent = I18nModule.t('unit_items', { count: condRules.length });
    if (condRules.length === 0) {
      dom.listRulesConditional.innerHTML = `<div class="empty-state">${currentMode === 'snapshot' ? I18nModule.t('empty_rules_cond_snapshot') : I18nModule.t('empty_rules_cond_live')}</div>`;
    } else {
      dom.listRulesConditional.innerHTML = condRules.map(r => {
        const baseName = (r.name || '').replace(/\.md$/i, '');
        const displayName = (ruleCondTitleMode === 'name') ? (r.name || baseName) : (r.displayName || r.name || baseName);
        const itemKey = r.filePath || r.name;
        const isOpen = openedKeys.has(itemKey);
        const btnCopyTitle = I18nModule.t('btn_copy_rule_name_title', { name: baseName });
        const btnRevealTitle = I18nModule.t('btn_reveal_rule_title');
        const btnOpenTitle = I18nModule.t('btn_open_rule_title');
        const sourceTitle = I18nModule.t('tag_source_title', { source: r.source || '' });

        return `
          <details class="context-item-details ${r.isInvoked ? 'highlight-invoked' : ''}" data-item-key="${escapeHtml(itemKey)}" ${isOpen ? 'open' : ''}>
            <summary class="item-summary">
              <div class="item-title-group">
                <span class="item-chevron">${Codicons.chevronRight}</span>
                <span class="item-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
              </div>
              ${showSourceTag && r.source ? `<span class="item-source-tag" title="${escapeHtml(sourceTitle)}">${escapeHtml(r.source)}</span>` : ''}
            </summary>
            <div class="item-detail-body">
              <div class="item-action-bar">
                <button class="action-btn btn-copy-name" data-copy="${escapeHtml(baseName)}" title="${escapeHtml(btnCopyTitle)}">${I18nModule.t('btn_copy_name')}</button>
                <button class="action-btn btn-reveal-path" data-path="${escapeHtml(r.filePath)}" title="${escapeHtml(btnRevealTitle)}">${I18nModule.t('btn_reveal_path')}</button>
                ${r.filePath ? `<button class="action-btn btn-open-file" data-path="${escapeHtml(r.filePath)}" title="${escapeHtml(btnOpenTitle)}">${I18nModule.t('btn_open_file')}</button>` : ''}
              </div>
              <div class="item-desc">${escapeHtml(r.description || I18nModule.t('desc_none'))}</div>
            </div>
          </details>
        `;
      }).join('');
    }

    // 3. 技能清單
    let rawSkills = [
      ...(currentData.skills?.workspace || []),
      ...(currentData.skills?.global || []),
      ...(currentData.skills?.builtin || [])
    ];
    if (currentMode === 'snapshot') {
      rawSkills = rawSkills.filter(s => s.isInvoked);
    }
    const allSkills = rawSkills;

    dom.badgeSkills.textContent = I18nModule.t('unit_items', { count: allSkills.length });

    if (currentMode === 'snapshot') {
      if (dom.metaModel) dom.metaModel.textContent = currentData.model || 'Gemini Flash';
    }

    if (allSkills.length === 0) {
      dom.listSkills.innerHTML = `<div class="empty-state">${currentMode === 'snapshot' ? I18nModule.t('empty_skills_snapshot') : I18nModule.t('empty_skills_live')}</div>`;
    } else {
      let html = '';
      const workspace = allSkills.filter(s => s.type === 'workspace');
      const global = allSkills.filter(s => s.type === 'global');
      const builtin = allSkills.filter(s => s.type === 'builtin');

      if (workspace.length > 0) {
        html += `<div class="subgroup-title">${Codicons.folder} ${I18nModule.t('group_skills_workspace', { count: workspace.length })}</div>`;
        html += workspace.map(s => renderSkillItem(s, openedKeys, showSourceTag)).join('');
      }
      if (global.length > 0) {
        html += `<div class="subgroup-title">${Codicons.globe} ${I18nModule.t('group_skills_global', { count: global.length })}</div>`;
        html += global.map(s => renderSkillItem(s, openedKeys, false)).join('');
      }
      if (builtin.length > 0) {
        html += `<div class="subgroup-title">${Codicons.package} ${I18nModule.t('group_skills_builtin', { count: builtin.length })}</div>`;
        html += builtin.map(s => renderSkillItem(s, openedKeys, false)).join('');
      }
      dom.listSkills.innerHTML = html;
    }

    // 4. MCP 伺服器與工具
    let rawMcpServers = currentData.mcpServers || [];
    if (currentMode === 'snapshot') {
      rawMcpServers = rawMcpServers.filter(s => s.isInvoked).map(s => ({
        ...s,
        tools: (s.tools || []).filter(t => t.isInvoked)
      }));
    }
    const mcpServers = rawMcpServers;
    dom.badgeMcp.textContent = I18nModule.t('unit_servers', { count: mcpServers.length });
    if (mcpServers.length === 0) {
      dom.listMcp.innerHTML = `<div class="empty-state">${currentMode === 'snapshot' ? I18nModule.t('empty_mcp_snapshot') : I18nModule.t('empty_mcp_live')}</div>`;
    } else {
      dom.listMcp.innerHTML = mcpServers.map(s => {
        const tools = s.tools || [];
        const scopeShort = (s.scope || '').replace(/MCP Server/gi, 'Global').replace(/Workspace \(([^)]+)\)/, '$1');
        return `
          <div class="mcp-row-item ${s.isInvoked ? 'highlight-invoked' : ''}">
            <div class="mcp-info-left">
              <span class="mcp-server-icon">${Codicons.server}</span>
              <span class="mcp-name">${escapeHtml(s.name)}</span>
              <span class="mcp-scope-tag" title="${escapeHtml(s.scope || '')}">${escapeHtml(scopeShort || 'Global')}</span>
            </div>
            <div class="mcp-actions-right">
              ${s.instructionsPath ? `<button class="item-btn btn-open-file" data-path="${escapeHtml(s.instructionsPath)}">${I18nModule.t('btn_open_file')}</button>` : ''}
              <span class="badge purple">${I18nModule.t('unit_apis', { count: tools.length })}</span>
            </div>
          </div>
        `;
      }).join('');
    }

    // 綁定各類項目按鈕事件
    document.querySelectorAll('.btn-open-file').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const fPath = btn.getAttribute('data-path');
        if (fPath) {
          vscode.postMessage({ type: 'openFile', payload: { filePath: fPath } });
        }
      });
    });

    document.querySelectorAll('.btn-reveal-path').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetPath = btn.getAttribute('data-path');
        if (targetPath) {
          vscode.postMessage({ type: 'revealInExplorer', payload: { targetPath } });
        }
      });
    });

    document.querySelectorAll('.btn-copy-name').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const copyText = btn.getAttribute('data-copy');
        if (copyText) {
          vscode.postMessage({ type: 'copyText', payload: { text: copyText, label: I18nModule.t('btn_copy_name') } });
        }
      });
    });
  }

  function renderSkillItem(s, openedKeys, showSourceTag = false) {
    const skillName = s.dirName || s.name;
    const displayName = (skillTitleMode === 'name') ? skillName : (s.displayName || s.name || skillName);
    const revealTarget = s.dirPath || s.filePath;
    const itemKey = s.filePath || s.dirPath || s.name;
    const isOpen = openedKeys && openedKeys.has(itemKey);
    const btnCopyTitle = I18nModule.t('btn_copy_skill_name_title', { name: skillName });
    const btnRevealTitle = I18nModule.t('btn_reveal_skill_title');
    const btnOpenTitle = I18nModule.t('btn_open_skill_title');
    const sourceTitle = I18nModule.t('tag_source_title', { source: s.source || '' });

    return `
      <details class="context-item-details ${s.isInvoked ? 'highlight-invoked' : ''}" data-item-key="${escapeHtml(itemKey)}" ${isOpen ? 'open' : ''}>
        <summary class="item-summary">
          <div class="item-title-group">
            <span class="item-chevron">${Codicons.chevronRight}</span>
            <span class="item-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
          </div>
          ${showSourceTag && s.source ? `<span class="item-source-tag" title="${escapeHtml(sourceTitle)}">${escapeHtml(s.source)}</span>` : ''}
        </summary>
        <div class="item-detail-body">
          <div class="item-action-bar">
            <button class="action-btn btn-copy-name" data-copy="${escapeHtml(skillName)}" title="${escapeHtml(btnCopyTitle)}">${I18nModule.t('btn_copy_name')}</button>
            <button class="action-btn btn-reveal-path" data-path="${escapeHtml(revealTarget)}" title="${escapeHtml(btnRevealTitle)}">${I18nModule.t('btn_reveal_path')}</button>
            ${s.filePath ? `<button class="action-btn btn-open-file" data-path="${escapeHtml(s.filePath)}" title="${escapeHtml(btnOpenTitle)}">${I18nModule.t('btn_open_file')}</button>` : ''}
          </div>
          <div class="item-desc">${escapeHtml(s.description || I18nModule.t('desc_none'))}</div>
        </div>
      </details>
    `;
  }

  // 產生 Markdown 摘要字串
  function buildMarkdownSummary() {
    if (!currentData) return '';
    const isEn = I18nModule.currentLang === 'en';
    const lines = [];
    lines.push(`# 🤖 ${I18nModule.t('header_title')} (${currentMode === 'live' ? I18nModule.t('btn_mode_live') : I18nModule.t('btn_mode_snapshot')})`);
    lines.push(`- ${isEn ? 'Timestamp' : '時間'}: ${currentData.timestamp || new Date().toISOString()}`);
    if (currentData.conversationTitle) {
      lines.push(`- ${isEn ? 'Conversation Task' : '對話任務'}: ${currentData.conversationTitle} (${currentData.conversationId})`);
    }
    if (currentData.model) {
      lines.push(`- ${isEn ? 'Model' : '使用模型'}: ${currentData.model}`);
    }
    lines.push('');

    lines.push(`## 📌 ${I18nModule.t('card_rules_active_title')} (${currentData.rules?.alwaysActive?.length || 0})`);
    (currentData.rules?.alwaysActive || []).forEach(r => lines.push(`- **${r.displayName || r.name}** (${r.source || (isEn ? 'Global' : '全域')}): ${r.description || ''}`));
    lines.push('');

    const condList = currentMode === 'snapshot' ? (currentData.rules?.conditional || []).filter(r => r.isInvoked) : (currentData.rules?.conditional || []);
    lines.push(`## 🔀 ${I18nModule.t('card_rules_conditional_title')} (${condList.length})`);
    condList.forEach(r => lines.push(`- **${r.displayName || r.name}**: ${r.description || ''}`));
    lines.push('');

    let skillList = [
      ...(currentData.skills?.workspace || []),
      ...(currentData.skills?.global || []),
      ...(currentData.skills?.builtin || [])
    ];
    if (currentMode === 'snapshot') {
      skillList = skillList.filter(s => s.isInvoked);
    }
    lines.push(`## ⚡ ${I18nModule.t('card_skills_title')} (${skillList.length})`);
    skillList.forEach(s => {
      const displayTitle = s.displayName ? `${s.displayName} (${s.name})` : s.name;
      lines.push(`- **${displayTitle}** [${s.type}]: ${s.description}`);
    });
    lines.push('');

    let mcpList = currentData.mcpServers || [];
    if (currentMode === 'snapshot') {
      mcpList = mcpList.filter(s => s.isInvoked);
    }
    lines.push(`## 🔌 ${I18nModule.t('card_mcp_title')} (${mcpList.length})`);
    mcpList.forEach(m => lines.push(`- **${m.name}** (${I18nModule.t('unit_apis', { count: m.tools?.length || 0 })})`));

    return lines.join('\n');
  }

  // 事件綁定
  function initEvents() {
    // 初始化國際化模組（套用當前偏好語系）
    I18nModule.init();

    syncModeUI();
    updateToggleButtons();

    // 切換常駐規範標題顯示模式（內文標題 / 檔案名稱）
    if (dom.btnToggleRulesActiveTitle) {
      dom.btnToggleRulesActiveTitle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        ruleActiveTitleMode = (ruleActiveTitleMode === 'title') ? 'name' : 'title';
        saveState();
        updateToggleButtons();
        renderAll();
      });
    }

    // 切換條件式規範標題顯示模式（內文標題 / 檔案名稱）
    if (dom.btnToggleRulesCondTitle) {
      dom.btnToggleRulesCondTitle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        ruleCondTitleMode = (ruleCondTitleMode === 'title') ? 'name' : 'title';
        saveState();
        updateToggleButtons();
        renderAll();
      });
    }

    // 切換技能標題顯示模式（內文標題 / 技能名稱）
    if (dom.btnToggleSkillTitle) {
      dom.btnToggleSkillTitle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        skillTitleMode = (skillTitleMode === 'title') ? 'name' : 'title';
        saveState();
        updateToggleButtons();
        renderAll();
      });
    }

    // 自訂對話快照 Dropdown Trigger 點擊事件
    if (dom.customConvTrigger) {
      dom.customConvTrigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleConvPopover();
      });
    }

    // 搜尋輸入框事件
    if (dom.convSearchInput) {
      dom.convSearchInput.addEventListener('input', (e) => {
        searchKeyword = e.target.value;
        if (dom.btnClearSearch) {
          dom.btnClearSearch.style.display = searchKeyword ? 'flex' : 'none';
        }
        renderCustomConvList();
      });
    }

    // 清除搜尋按鈕事件
    if (dom.btnClearSearch) {
      dom.btnClearSearch.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        searchKeyword = '';
        if (dom.convSearchInput) {
          dom.convSearchInput.value = '';
          dom.convSearchInput.focus();
        }
        dom.btnClearSearch.style.display = 'none';
        renderCustomConvList();
      });
    }

    // 筆數切換 Pills 點擊事件
    if (dom.limitPillsContainer) {
      dom.limitPillsContainer.querySelectorAll('.limit-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const lim = parseInt(pill.getAttribute('data-limit'), 10) || 10;
          currentConvLimit = lim;
          saveState();
          renderCustomConvList();
          const limStr = lim >= 500 ? I18nModule.t('toast_limit_all') : I18nModule.t('toast_limit_items', { count: lim });
          Toast.show(I18nModule.t('toast_limit_changed', { limit: limStr }), 'info', 1500);
        });
      });
    }

    // 點擊 Popover 內部阻止事件冒泡到 document
    if (dom.customConvPopover) {
      dom.customConvPopover.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    // 點擊外部區域自動關閉 Popover
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.custom-dropdown-container')) {
        closeConvPopover();
      }
    });

    // 鍵盤 Escape 鍵自動關閉 Popover
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeConvPopover();
      }
    });

    // 模式切換：當前環境即時掃描
    dom.btnLive.addEventListener('click', () => {
      currentMode = 'live';
      saveState();
      syncModeUI();
      vscode.postMessage({ type: 'fetchData', payload: { mode: 'live' } });
    });

    // 模式切換：最近對話快照
    dom.btnSnapshot.addEventListener('click', () => {
      currentMode = 'snapshot';
      saveState();
      syncModeUI();
      vscode.postMessage({ type: 'fetchData', payload: { mode: 'snapshot', conversationId: selectedConvId } });
    });

    // 全部摺疊卡片
    if (dom.btnCollapseAll) {
      dom.btnCollapseAll.addEventListener('click', () => {
        document.querySelectorAll('.container details').forEach(el => {
          el.open = false;
        });
      });
    }

    // 全部展開卡片
    if (dom.btnExpandAll) {
      dom.btnExpandAll.addEventListener('click', () => {
        document.querySelectorAll('.container details.card').forEach(el => {
          el.open = true;
        });
      });
    }

    // 重新整理
    if (dom.btnRefresh) {
      dom.btnRefresh.addEventListener('click', () => {
        vscode.postMessage({ type: 'fetchData', payload: { mode: currentMode, conversationId: selectedConvId } });
        Toast.show(I18nModule.t('toast_refreshed'), 'info');
      });
    }

    // 複製摘要
    dom.btnCopy.addEventListener('click', () => {
      const summary = buildMarkdownSummary();
      vscode.postMessage({ type: 'copyToClipboard', payload: { text: summary } });
      Toast.show(I18nModule.t('toast_copied_summary'), 'info');
    });

    // 開啟 MCP 目錄
    const btnOpenMcpDir = document.getElementById('btn-open-mcp-dir');
    if (btnOpenMcpDir) {
      btnOpenMcpDir.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        vscode.postMessage({ type: 'openMcpDir' });
      });
    }

    // 監聽 Extension Host 訊息
    window.addEventListener('message', (event) => {
      const { type, payload } = event.data;
      if (type === 'updateData') {
        currentData = payload;

        // 同步後端回傳之 mode
        if (payload.mode) {
          currentMode = payload.mode;
          saveState();
          syncModeUI();
        }

        // 若返回了指定的 conversationId 且尚未設置 selectedConvId，同步更新
        if (payload.conversationId) {
          selectedConvId = payload.conversationId;
        }

        // 更新歷史對話清單快取並刷新自訂選單
        if (payload.conversationsList && payload.conversationsList.length > 0) {
          allConversations = payload.conversationsList;
          updateConvDropdown();
        }

        renderAll();
      } else if (type === 'toast') {
        Toast.show(payload.message, payload.status || 'info');
      } else if (type === 'localeChanged') {
        if (event.data.locale && event.data.locale !== I18nModule.currentLang) {
          I18nModule.applyLanguage(event.data.locale, true);
        }
      }
    });

    // 前端初始化就緒，自動向後端發送請求獲取最新上下文
    vscode.postMessage({
      type: 'fetchData',
      payload: { mode: currentMode, conversationId: selectedConvId }
    });

    // 啟動全域滑鼠右鍵拖曳滾動
    DragScrollModule.init();
  }

  // ============================================================================
  // 全域滑鼠右鍵平滑拖曳滾動模組 (RMB Drag Scroll Module - Hand Pan Mode)
  // ============================================================================
  const DragScrollModule = {
    init() {
      let isRmbDown = false;
      let hasDragged = false;
      let startY = 0;
      let lastY = 0;
      let accumulatedDeltaY = 0;
      let rafId = null;
      // 移動距離調整為 3 倍（極速大跨度捲動）
      const speed = 3.6;

      const flushScroll = () => {
        if (accumulatedDeltaY !== 0) {
          const curScroll = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
          // 抓手平移模式：滑鼠往上推 (accumulatedDeltaY < 0) -> 頁面向下捲動 (nextScroll 增加)
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

      // 1. 監聽滑鼠按下 (mousedown)
      window.addEventListener('mousedown', (e) => {
        // 僅響應滑鼠右鍵 (button === 2)
        if (e.button !== 2) return;

        // 防禦性檢查：若點擊在輸入框或文字編輯區，保留原生右鍵行為（避免 target 非 Element 引發報錯）
        if (e.target && typeof e.target.closest === 'function' && e.target.closest('input, textarea, select, [contenteditable="true"]')) {
          return;
        }

        isRmbDown = true;
        hasDragged = false;
        startY = e.clientY;
        lastY = e.clientY;
        accumulatedDeltaY = 0;
      });

      // 2. 監聽滑鼠移動 (mousemove)
      window.addEventListener('mousemove', (e) => {
        if (!isRmbDown) return;

        // 檢查右鍵是否仍在按壓狀態（防呆：游標在外部放開後移回）
        if ((e.buttons & 2) === 0) {
          endDrag();
          return;
        }

        const currentY = e.clientY;
        const totalDeltaFromStart = currentY - startY;

        // 移動超過 3px 視為拖曳意圖，防止原地右鍵點擊誤觸
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

      // 3. 監聽滑鼠放開 (mouseup)
      window.addEventListener('mouseup', (e) => {
        if (e.button === 2) {
          endDrag();
          // 防禦性超時重設：若極端情況下 contextmenu 未能觸發，確保 hasDragged 在 150ms 內安全解除
          if (hasDragged) {
            setTimeout(() => {
              hasDragged = false;
            }, 150);
          }
        }
      });

      // 4. 視窗失去焦點時重設狀態
      window.addEventListener('blur', () => {
        endDrag();
        hasDragged = false;
      });

      // 5. 攔截右鍵選單 (contextmenu)
      // 若曾經發生拖曳，立即阻止彈出右鍵選單；若為原地單擊則不干擾
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

  initEvents();
})();
