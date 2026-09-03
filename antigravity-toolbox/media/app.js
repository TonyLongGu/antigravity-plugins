/**
 * Antigravity 控制中心 - 前端模組化主控制器 (app.js)
 * 遵循 Modular Feature Card Architecture
 */
(function () {
  const vscode = acquireVsCodeApi();

  /**
   * Lucide / Linear 原生圓角線性向量圖示庫 (Inline SVG 零外部請求自包含)
   */
  const Icons = {
    sliders: '<svg class="lucide-icon" viewBox="0 0 24 24"><line x1="4" x2="20" y1="21" y2="21"/><line x1="4" x2="20" y1="14" y2="14"/><line x1="4" x2="20" y1="7" y2="7"/><circle cx="8" cy="21" r="2"/><circle cx="16" cy="14" r="2"/><circle cx="10" cy="7" r="2"/></svg>',
    collapseAll: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="m4 14 8-8 8 8"/><path d="m4 20 8-8 8 8"/></svg>',
    expandAll: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="m4 10 8 8 8-8"/><path d="m4 4 8 8 8-8"/></svg>',
    refresh: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
    folder: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
    settings: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    fileCode: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
    brain: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04z"/></svg>',
    alertTriangle: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    chevronRight: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
    gripVertical: '<svg class="lucide-icon grip-icon" viewBox="0 0 24 24"><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="5" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>',
    eye: '<svg class="lucide-icon eye-icon" viewBox="0 0 24 24"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg class="lucide-icon eye-icon" viewBox="0 0 24 24"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>',
    play: '<svg class="lucide-icon" viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
    zap: '<svg class="lucide-icon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    trash2: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
    terminal: '<svg class="lucide-icon" viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>'
  };

  // ============================================================================
  // 1. 通用工具與 Toast 模組 (Toast & Utils Module)
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
  // 2. 模組 1：多專案工作區 (Workspace Feature Module)
  // ============================================================================
  let draggedFolderItem = null;
  let currentDropTarget = null;
  let currentDropDirection = null; // 'top' | 'bottom'

  function clearDropIndicators() {
    if (currentDropTarget) {
      currentDropTarget.classList.remove('drag-over-top', 'drag-over-bottom');
      currentDropTarget = null;
      currentDropDirection = null;
    }
  }

  function updateDropIndicator(targetItem, direction) {
    if (currentDropTarget === targetItem && currentDropDirection === direction) {
      return;
    }
    clearDropIndicators();
    if (targetItem && direction) {
      targetItem.classList.add(direction === 'top' ? 'drag-over-top' : 'drag-over-bottom');
      currentDropTarget = targetItem;
      currentDropDirection = direction;
    }
  }

  // 追蹤處理中（樂觀鎖定）的專案切換狀態，防止後端過期事件造成狀態回跳閃爍
  const pendingToggles = new Map(); // key: path -> { active: boolean, time: number }

  /**
   * 切換專案在工作區的顯示/隱藏狀態（等冪意圖鎖定，0ms 即時反饋）
   */
  function toggleItemEnabled(item, folderData) {
    const targetPath = item.getAttribute('data-path') || folderData?.path;
    if (!targetPath) return;

    // 1. 取得當前視覺狀態並計算期望的下一個狀態
    const isCurrentlyActive = item.classList.contains('is-active');
    const nextActive = !isCurrentlyActive;

    // 2. 登記最新操作意圖樂觀鎖（保護 1500ms，防止後端中途推送舊狀態覆蓋）
    pendingToggles.set(targetPath, { active: nextActive, time: Date.now() });

    // 3. 立即原地切換 UI（0ms 即時流暢反饋）
    item.classList.toggle('is-active', nextActive);
    item.classList.toggle('is-inactive', !nextActive);

    const switchEl = item.querySelector('.folder-switch');
    if (switchEl) {
      switchEl.classList.toggle('is-checked', nextActive);
      switchEl.title = `點擊切換為「${nextActive ? '已隱藏' : '顯示中'}」`;
    }

    // 4. 立即更新快照與頂部計數文字
    const curState = vscode.getState() || {};
    if (curState.workspace && Array.isArray(curState.workspace.folders)) {
      const targetFolder = curState.workspace.folders.find((tf) => tf.path === targetPath);
      if (targetFolder) targetFolder.enabled = nextActive;
      const actCount = curState.workspace.folders.filter((tf) => tf.enabled !== false).length;
      const totCount = curState.workspace.folderCount || curState.workspace.folders.length;
      curState.workspace.activeCount = actCount;
      vscode.setState(curState);

      if (WorkspaceModule.dom.count) {
        WorkspaceModule.dom.count.textContent = `${actCount} / ${totCount} 個`;
      }
      if (WorkspaceModule.dom.folderListCount) {
        WorkspaceModule.dom.folderListCount.textContent = `${actCount}/${totCount}`;
      }
    }

    // 5. 發送等冪指令給後端（明確指定期望的 enabled 狀態）
    vscode.postMessage({
      type: 'toggleWorkspaceFolder',
      path: targetPath,
      enabled: nextActive,
    });
  }

  /**
   * 全卡片專注拖曳排序引擎（位置快取防強制重排，右側開關完全解耦）
   */
  function startCardPointerInteraction(item, folderData, startEvent) {
    if (startEvent.button !== 0) return; // 僅限滑鼠左鍵
    if (startEvent.target.closest('.folder-switch')) {
      return; // 點擊右側開關時直接略過拖曳判定
    }

    const startY = startEvent.clientY;
    let isDragging = false;
    let cachedItemCenters = [];

    const onPointerMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - startY;

      // 只要開始滑動超過 2px 即啟動流暢拖曳
      if (!isDragging && Math.abs(deltaY) > 2) {
        isDragging = true;
        draggedFolderItem = item;
        item.classList.add('is-dragging');
        document.body.classList.add('is-pointer-dragging');

        // 快取所有其他項目的中心 Y 座標（避免每次 pointermove 重複計算觸發 Layout Thrashing）
        const allItems = Array.from(WorkspaceModule.dom.folderList.querySelectorAll('.folder-item'))
          .filter((el) => el !== draggedFolderItem);

        cachedItemCenters = allItems.map((el) => {
          const r = el.getBoundingClientRect();
          return { el, center: r.top + r.height / 2 };
        });
      }

      if (isDragging && draggedFolderItem && cachedItemCenters.length > 0) {
        moveEvent.preventDefault();
        const y = moveEvent.clientY;

        // 1. 游標在第一項中心點之上 -> 第一項頂部
        if (y <= cachedItemCenters[0].center) {
          updateDropIndicator(cachedItemCenters[0].el, 'top');
          return;
        }

        // 2. 游標在最後一項中心點之下 -> 最後一項底部
        if (y >= cachedItemCenters[cachedItemCenters.length - 1].center) {
          updateDropIndicator(cachedItemCenters[cachedItemCenters.length - 1].el, 'bottom');
          return;
        }

        // 3. 連續無死角區間投影（消除任何控件間隙與 margin 盲區）
        for (let i = 0; i < cachedItemCenters.length - 1; i++) {
          const cur = cachedItemCenters[i];
          const next = cachedItemCenters[i + 1];
          const midLine = (cur.center + next.center) / 2;

          if (y >= cur.center && y <= next.center) {
            updateDropIndicator(y < midLine ? cur.el : next.el, y < midLine ? 'bottom' : 'top');
            break;
          }
        }
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      if (isDragging) {
        document.body.classList.remove('is-pointer-dragging');
        item.classList.remove('is-dragging');

        if (draggedFolderItem && currentDropTarget && currentDropTarget !== draggedFolderItem) {
          const targetSibling = currentDropDirection === 'top' ? currentDropTarget : currentDropTarget.nextSibling;
          WorkspaceModule.dom.folderList.insertBefore(draggedFolderItem, targetSibling);
          WorkspaceModule.commitFolderReorder();
        }

        clearDropIndicators();
        draggedFolderItem = null;
        isDragging = false;
        cachedItemCenters = [];
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  const WorkspaceModule = {
    dom: {
      card: document.getElementById('module-workspace'),
      badge: document.getElementById('ws-badge'),
      name: document.getElementById('ws-name'),
      count: document.getElementById('ws-count'),
      customRow: document.getElementById('ws-custom-row'),
      customCount: document.getElementById('ws-custom-count'),
      duplicateBanner: document.getElementById('duplicate-banner'),
      duplicateText: document.getElementById('duplicate-text'),
      actions: document.getElementById('ws-actions'),
      btnFix: document.getElementById('btn-fix-workspace'),
      btnReset: document.getElementById('btn-reset-workspace'),
      btnShowOnlyFirst: document.getElementById('btn-show-only-first'),
      btnInvert: document.getElementById('btn-invert'),
      btnShowAll: document.getElementById('btn-show-all'),
      folderList: document.getElementById('folder-list'),
      folderListCount: document.getElementById('folder-list-count'),
    },

    init() {
      if (this.dom.btnFix) {
        this.dom.btnFix.addEventListener('click', () => {
          vscode.postMessage({ type: 'fixWorkspace' });
        });
      }

      if (this.dom.btnReset) {
        this.dom.btnReset.addEventListener('click', () => {
          vscode.postMessage({ type: 'resetWorkspace' });
        });
      }

      if (this.dom.btnShowOnlyFirst) {
        this.dom.btnShowOnlyFirst.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.applyOptimisticBatchToggle('first');
          vscode.postMessage({ type: 'showOnlyFirstFolder' });
        });
      }

      if (this.dom.btnInvert) {
        this.dom.btnInvert.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.applyOptimisticBatchToggle('invert');
          vscode.postMessage({ type: 'invertFolders' });
        });
      }

      if (this.dom.btnShowAll) {
        this.dom.btnShowAll.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.applyOptimisticBatchToggle('all');
          vscode.postMessage({ type: 'showAllFolders' });
        });
      }
    },

    /**
     * 批次樂觀更新專案開關狀態 (mode: 'first' | 'invert' | 'all')，提供 0ms 即時反饋
     */
    applyOptimisticBatchToggle(mode) {
      if (!this.dom.folderList) return;
      const items = Array.from(this.dom.folderList.querySelectorAll('.folder-item'));
      if (items.length === 0) return;

      const curState = vscode.getState() || {};
      const folders = curState.workspace?.folders || [];
      const now = Date.now();
      let actCount = 0;

      items.forEach((item, index) => {
        const targetPath = item.getAttribute('data-path');
        const isCurrentlyActive = item.classList.contains('is-active');

        let nextActive;
        if (mode === 'first') {
          nextActive = (index === 0);
        } else if (mode === 'all') {
          nextActive = true;
        } else if (mode === 'invert') {
          // 首項始終強制保持開啟，其餘專案反轉
          nextActive = (index === 0) ? true : !isCurrentlyActive;
        }

        if (nextActive) actCount++;

        // 1. 登記樂觀鎖（保護 800ms，防止後端中途推送舊狀態）
        if (targetPath) {
          pendingToggles.set(targetPath, { active: nextActive, time: now });
        }

        // 2. 立即原地更新 DOM 樣式 (0ms 反饋)
        item.classList.toggle('is-active', nextActive);
        item.classList.toggle('is-inactive', !nextActive);

        const switchEl = item.querySelector('.folder-switch');
        if (switchEl) {
          switchEl.classList.toggle('is-checked', nextActive);
          switchEl.title = `點擊切換為「${nextActive ? '已隱藏' : '顯示中'}」`;
        }

        // 3. 更新快照物件
        if (targetPath && folders.length > 0) {
          const tf = folders.find((f) => f.path === targetPath);
          if (tf) tf.enabled = nextActive;
        }
      });

      // 4. 即時更新計數器文字
      const totalCount = items.length;

      if (curState.workspace) {
        curState.workspace.activeCount = actCount;
        vscode.setState(curState);
      }

      if (this.dom.count) {
        this.dom.count.textContent = `${actCount} / ${totalCount} 個`;
      }
      if (this.dom.folderListCount) {
        this.dom.folderListCount.textContent = `${actCount}/${totalCount}`;
      }
    },

    /**
     * 提交專案最新排序至快照並同步後端
     */
    commitFolderReorder() {
      if (!this.dom.folderList) return;
      const newOrder = Array.from(this.dom.folderList.querySelectorAll('.folder-item'))
        .map((el) => el.getAttribute('data-path'))
        .filter(Boolean);

      const curState = vscode.getState() || {};
      if (curState.workspace && Array.isArray(curState.workspace.folders)) {
        const pathMap = new Map(curState.workspace.folders.map((folder) => [folder.path, folder]));
        curState.workspace.folders = newOrder.map((p) => pathMap.get(p)).filter(Boolean);
        vscode.setState(curState);
      }

      vscode.postMessage({ type: 'reorderWorkspaceFolders', newOrder });
    },

    render(workspace) {
      if (!workspace) return;

      // 1. 結合樂觀鎖校正實際啟用狀態（防止後端過期事件造成的閃爍回跳）
      let effectiveActiveCount = 0;
      const now = Date.now();
      if (Array.isArray(workspace.folders)) {
        workspace.folders.forEach((f) => {
          let isEnabled = f.enabled !== false;
          const pending = pendingToggles.get(f.path);
          if (pending) {
            // 在使用者操作後的 1500ms 窗口內，始終以使用者的最新操作意圖為絕對準則
            // 絕不過早解除鎖定，徹底免疫多專案快速交錯切換時延遲事件的污染
            if (now - pending.time < 1500) {
              isEnabled = pending.active;
              f.enabled = pending.active;
            } else {
              pendingToggles.delete(f.path);
            }
          }
          if (isEnabled) effectiveActiveCount++;
        });
      }

      this.dom.name.textContent = workspace.workspaceName || '未開啟工作區';
      const activeCount = effectiveActiveCount;
      const totalCount = workspace.folderCount || (workspace.folders ? workspace.folders.length : 0);
      this.dom.count.textContent = `${activeCount} / ${totalCount} 個`;
      if (this.dom.customCount) {
        this.dom.customCount.textContent = `${workspace.customNameCount || 0} 個`;
      }
      if (this.dom.folderListCount) {
        this.dom.folderListCount.textContent = `${activeCount}/${totalCount}`;
      }

      if (workspace.hasMultiRoot) {
        if (this.dom.actions) this.dom.actions.classList.remove('hidden');

        if (workspace.duplicateCount > 0) {
          // 有待修正狀態：修正同名專案為黃色 (btn-amber)，還原預設名稱為原色灰色 (btn-secondary)
          this.dom.badge.textContent = `${workspace.duplicateCount} 個待修正`;
          this.dom.badge.className = 'badge warning';
          this.dom.duplicateBanner.classList.remove('hidden');
          this.dom.duplicateText.textContent = `發現 ${workspace.duplicateCount} 個專案需加上「父資料夾 \\ 專案名」`;
          if (this.dom.btnFix) this.dom.btnFix.className = 'btn btn-amber';
          if (this.dom.btnReset) this.dom.btnReset.className = 'btn btn-secondary';
        } else {
          // 無衝突/無待修狀態：修正同名專案為原色灰色 (btn-secondary)，還原預設名稱為藍色 (btn-cyan)
          if (workspace.customNameCount > 0) {
            this.dom.badge.textContent = `已自訂 ${workspace.customNameCount} 個名稱`;
            this.dom.badge.className = 'badge info';
          } else {
            this.dom.badge.textContent = '狀態良好 (預設)';
            this.dom.badge.className = 'badge success';
          }
          this.dom.duplicateBanner.classList.add('hidden');
          if (this.dom.btnFix) this.dom.btnFix.className = 'btn btn-secondary';
          if (this.dom.btnReset) this.dom.btnReset.className = 'btn btn-cyan';
        }
      } else {
        this.dom.badge.textContent = '單一資料夾';
        this.dom.badge.className = 'badge';
        this.dom.duplicateBanner.classList.add('hidden');
        if (this.dom.actions) this.dom.actions.classList.add('hidden');
      }

      // 智慧比對渲染清單（精準屬性更新，絕不銷毀重建 DOM，徹底消除閃爍）
      if (!workspace.folders || workspace.folders.length === 0) {
        this.dom.folderList.innerHTML = '<div class="folder-path" style="padding: 4px;">無專案資料夾</div>';
        return;
      }

      const emptyHint = this.dom.folderList.querySelector('.folder-path:only-child');
      if (emptyHint && !emptyHint.closest('.folder-item')) {
        this.dom.folderList.innerHTML = '';
      }

      const existingMap = new Map();
      this.dom.folderList.querySelectorAll('.folder-item').forEach((el) => {
        const p = el.getAttribute('data-path');
        if (p) existingMap.set(p, el);
      });

      const currentPaths = new Set();

      workspace.folders.forEach((f, index) => {
        currentPaths.add(f.path);
        const isEnabled = f.enabled !== false;
        const isCustom = Boolean(f.customName);
        const hasDup = Boolean(f.needsFix && isEnabled);
        const targetClass = `folder-item ${isEnabled ? 'is-active' : 'is-inactive'} ${hasDup ? 'has-dup' : (isCustom ? 'has-custom' : '')}`;

        const targetTitle = `專案：${f.name}${isCustom ? ' (已自訂名稱)' : ''}\n路徑：${f.path}\n狀態：${isEnabled ? '顯示中' : '已隱藏'}\n(可按住卡片直接拖曳排序，點擊右側開關切換顯示/隱藏)`;

        let item = existingMap.get(f.path);
        if (item) {
          // 精準屬性原地比對，不重建 DOM
          if (item.className !== targetClass) item.className = targetClass;
          if (item.title !== targetTitle) item.title = targetTitle;

          const nameEl = item.querySelector('.folder-name');
          if (nameEl && nameEl.textContent !== f.name) {
            nameEl.textContent = f.name;
          }

          const switchEl = item.querySelector('.folder-switch');
          if (switchEl) {
            switchEl.classList.toggle('is-checked', isEnabled);
            switchEl.title = `點擊切換為「${isEnabled ? '已隱藏' : '顯示中'}」`;
          }
        } else {
          // 初次載入：建立標準結構 DOM (單行緊湊：Pointer 拖曳卡片 + 專案名 + Toggle Switch 滑動開關)
          item = document.createElement('div');
          item.setAttribute('data-path', f.path);
          item.className = targetClass;
          item.title = targetTitle;

          // 1. 緊湊拖曳提示圖示 (裝飾性視覺提示)
          const dragHandle = document.createElement('div');
          dragHandle.className = 'folder-drag-handle';
          dragHandle.innerHTML = Icons.gripVertical;

          // 2. 內容包裝容器 (單行專案名稱 + 滑動開關)
          const contentWrapper = document.createElement('div');
          contentWrapper.className = 'folder-item-content';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'folder-name';
          nameSpan.textContent = f.name;

          // 專屬的滑動開關 (Toggle Switch 放於標題右側)
          const toggleSwitch = document.createElement('button');
          toggleSwitch.className = `folder-switch ${isEnabled ? 'is-checked' : ''}`;
          toggleSwitch.title = `點擊切換為「${isEnabled ? '已隱藏' : '顯示中'}」`;
          toggleSwitch.innerHTML = '<span class="switch-thumb"></span>';
          toggleSwitch.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleItemEnabled(item, f);
          });

          contentWrapper.appendChild(nameSpan);
          contentWrapper.appendChild(toggleSwitch);

          item.appendChild(dragHandle);
          item.appendChild(contentWrapper);

          // 全卡片按住直接流暢拖曳排序
          item.addEventListener('pointerdown', (e) => {
            startCardPointerInteraction(item, f, e);
          });

          this.dom.folderList.appendChild(item);
        }

        // 確保順序正確（比對 childNodes）
        if (this.dom.folderList.children[index] !== item) {
          this.dom.folderList.insertBefore(item, this.dom.folderList.children[index] || null);
        }
      });

      // 清除不存在於最新清單的舊節點
      existingMap.forEach((el, p) => {
        if (!currentPaths.has(p)) el.remove();
      });
    },
  };

  // ============================================================================
  // 2.5 模組：專案腳本執行器 (Project Script Runner Module)
  // ============================================================================
  const ScriptsModule = {
    dom: {
      badge: document.getElementById('scripts-badge'),
      emptyHint: document.getElementById('scripts-empty-hint'),
      list: document.getElementById('scripts-list'),
    },

    init() {
      // 事件委派：執行、管理員執行、刪除、重命名、恢復
      if (this.dom.list) {
        this.dom.list.addEventListener('click', (e) => {
          const btnRun = e.target.closest('.btn-script-run');
          const btnAdmin = e.target.closest('.btn-script-admin');
          const btnDelete = e.target.closest('.btn-script-delete');
          const btnRename = e.target.closest('.btn-script-rename');
          const btnResetName = e.target.closest('.btn-script-reset-name');
          const itemEl = e.target.closest('.script-item');

          if (!itemEl) return;
          const scriptPath = itemEl.getAttribute('data-path');

          if (btnRun) {
            e.stopPropagation();
            vscode.postMessage({ type: 'runScript', path: scriptPath });
          } else if (btnAdmin) {
            e.stopPropagation();
            vscode.postMessage({ type: 'runScriptAdmin', path: scriptPath });
          } else if (btnDelete) {
            e.stopPropagation();
            // 🚀 樂觀 UI (Optimistic Update)：點擊瞬間 0ms 立即觸發絲滑淡出移除，消除後端磁碟 I/O 停頓感
            itemEl.style.transition = 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)';
            itemEl.style.opacity = '0';
            itemEl.style.transform = 'scale(0.94)';
            setTimeout(() => {
              const groupDetails = itemEl.closest('.script-group-details');
              itemEl.remove();

              // 若該專案分組內已無任何腳本，將整個專案折疊卡片移除；否則更新該分組的數量
              if (groupDetails) {
                const groupItems = groupDetails.querySelectorAll('.script-item');
                if (groupItems.length === 0) {
                  groupDetails.remove();
                } else {
                  const groupCountSpan = groupDetails.querySelector('.script-group-count');
                  if (groupCountSpan) groupCountSpan.textContent = groupItems.length;
                }
              }

              const remaining = this.dom.list ? this.dom.list.querySelectorAll('.script-item').length : 0;
              if (this.dom.emptyHint) {
                this.dom.emptyHint.classList.toggle('hidden', remaining > 0);
              }
              if (this.dom.badge) {
                this.dom.badge.textContent = `${remaining} 個`;
              }
            }, 180);

            vscode.postMessage({ type: 'removeScript', path: scriptPath });
          } else if (btnRename) {
            e.stopPropagation();
            vscode.postMessage({ type: 'renameScript', path: scriptPath });
          } else if (btnResetName) {
            e.stopPropagation();
            vscode.postMessage({ type: 'resetScriptDisplayName', path: scriptPath });
          } else {
            // 點擊卡片空白/名稱區域：在 VS Code 左側檔案總管中定位並選中該檔案
            vscode.postMessage({ type: 'revealScriptInExplorer', path: scriptPath });
          }
        });
      }
    },

    render(scriptsData) {
      if (!scriptsData || !Array.isArray(scriptsData.scripts)) return;
      const { scripts, count } = scriptsData;

      if (this.dom.badge) {
        this.dom.badge.textContent = `${count} 個`;
        this.dom.badge.className = 'badge purple';
      }

      if (this.dom.emptyHint) {
        this.dom.emptyHint.classList.toggle('hidden', count > 0);
      }

      if (!this.dom.list) return;

      if (count === 0) {
        this.dom.list.innerHTML = '';
        return;
      }

      // 1. 依所屬專案分組 (Group by workspaceName)
      const groups = new Map();
      scripts.forEach((s) => {
        const wsName = s.workspaceName || '未指定專案';
        if (!groups.has(wsName)) {
          groups.set(wsName, []);
        }
        groups.get(wsName).push(s);
      });

      // 2. 渲染各專案分組折疊卡片
      let html = '';
      groups.forEach((groupScripts, wsName) => {
        const groupCount = groupScripts.length;
        const itemsHtml = groupScripts
          .map((s) => {
            const missingClass = !s.exists ? 'is-missing' : '';
            const missingBadge = !s.exists
              ? `<span class="badge badge-danger" title="找不到磁碟實體檔案">缺失</span>`
              : '';

            return `
              <div class="script-item ${missingClass}" data-path="${ToastModule.escapeHtml(s.fullPath || s.rawPath)}" data-raw-path="${ToastModule.escapeHtml(s.rawPath || s.fullPath)}" title="點擊在左側檔案總管中定位此檔案">
                <div class="script-main-row">
                  <div class="script-file-info" title="完整路徑：${ToastModule.escapeHtml(s.fullPath)}${s.hasCustomName ? ` (實體檔名：${ToastModule.escapeHtml(s.fileName)})` : ''}">
                    <span class="script-file-name">${ToastModule.escapeHtml(s.name || s.fileName)}</span>
                  </div>
                  <div class="script-name-actions">
                    <button type="button" class="btn-micro-action btn-script-rename" title="自訂此腳本在工具中的顯示名稱 (不修改實體檔名)">
                      <span>命名</span>
                    </button>
                    ${s.hasCustomName ? `
                    <button type="button" class="btn-micro-action btn-script-reset-name" title="恢復為預設檔案名稱">
                      <span>恢復</span>
                    </button>` : ''}
                    ${missingBadge}
                  </div>
                </div>
                <div class="script-actions-grid">
                  <button type="button" class="btn-script-action btn-script-run" title="在 VS Code 整合終端機中運行此腳本">
                    <span>執行</span>
                  </button>
                  <button type="button" class="btn-script-action btn-script-admin" title="以 Windows 系統管理員身分 (UAC 提權) 運行">
                    <span>執行(管理員)</span>
                  </button>
                  <button type="button" class="btn-script-action btn-script-delete" title="自執行器清單移除該腳本 (不會刪除實體檔案)">
                    <span>刪除</span>
                  </button>
                </div>
              </div>
            `;
          })
          .join('');

        html += `
          <details class="folder-details script-group-details" open>
            <summary class="folder-summary">
              <div class="folder-summary-left">
                <span class="item-chevron">${Icons.chevronRight}</span>
                <span class="script-group-title" title="專案：${ToastModule.escapeHtml(wsName)}">${ToastModule.escapeHtml(wsName)}</span>
              </div>
            </summary>
            <div class="script-group-content">
              ${itemsHtml}
            </div>
          </details>
        `;
      });

      this.dom.list.innerHTML = html;
    },
  };

  // ============================================================================
  // 3. 模組 2 & 3：目錄直達與 IDE 設定 (Navigation & Config Module)
  // ============================================================================
  const NavigationModule = {
    init() {
      document.querySelectorAll('[data-target]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-target');
          vscode.postMessage({ type: 'openTarget', target });
        });
      });
    },
  };

  // ============================================================================
  // 3.5 模組 3.5：IDE 設定與檔案總管過濾 (Settings & Visibility Module)
  // ============================================================================
  const SettingsModule = {
    dom: {
      card: document.getElementById('module-settings'),
      rows: document.querySelectorAll('.setting-toggle-row'),
      toggleGitignore: document.getElementById('toggle-hide-gitignore'),
      toggleExcludeGitIgnore: document.getElementById('toggle-exclude-gitignore'),
      toggleSystemJunk: document.getElementById('toggle-hide-system-junk'),
      togglePythonCache: document.getElementById('toggle-hide-python-cache'),
    },

    init() {
      this.dom.rows.forEach((row) => {
        row.addEventListener('click', () => {
          const key = row.getAttribute('data-key');
          if (!key) return;
          const switchEl = row.querySelector('.folder-switch');
          if (switchEl) {
            const isCurrentlyChecked = switchEl.classList.contains('is-checked');
            switchEl.classList.toggle('is-checked', !isCurrentlyChecked);
          }
          vscode.postMessage({ type: 'toggleExplorerSetting', key });
        });
      });
    },

    render(settings) {
      if (!settings) return;
      if (this.dom.toggleGitignore) {
        this.dom.toggleGitignore.classList.toggle('is-checked', !!settings.hideGitignore);
      }
      if (this.dom.toggleExcludeGitIgnore) {
        this.dom.toggleExcludeGitIgnore.classList.toggle('is-checked', !!settings.excludeGitIgnore);
      }
      if (this.dom.toggleSystemJunk) {
        this.dom.toggleSystemJunk.classList.toggle('is-checked', !!settings.hideSystemJunk);
      }
      if (this.dom.togglePythonCache) {
        this.dom.togglePythonCache.classList.toggle('is-checked', !!settings.hidePythonCache);
      }
    },
  };

  // ============================================================================
  // 4. 模組 4：對話記憶庫 (Brain Feature Module)
  // ============================================================================
  const BrainModule = {
    dom: {
      card: document.getElementById('module-brain'),
      size: document.getElementById('brain-size'),
      count: document.getElementById('brain-count'),
      slider: document.getElementById('brain-slider'),
      monthsVal: document.getElementById('brain-months-val'),
      daysHint: document.getElementById('brain-days-hint'),
      btnClean: document.getElementById('btn-clean-brain'),
      cleanBtnText: document.getElementById('clean-btn-text'),
    },

    init() {
      // 讀取已保存的前端狀態 (State Persistence)
      const savedState = vscode.getState() || {};
      if (savedState.brainMonths && this.dom.slider) {
        this.dom.slider.value = savedState.brainMonths;
        this.updateSliderUi(savedState.brainMonths);
      }

      if (this.dom.slider) {
        this.dom.slider.addEventListener('input', (e) => {
          const months = parseInt(e.target.value, 10);
          this.updateSliderUi(months);
          // 保存狀態
          const current = vscode.getState() || {};
          vscode.setState({ ...current, brainMonths: months });
        });
      }

      if (this.dom.btnClean) {
        this.dom.btnClean.addEventListener('click', () => {
          const months = this.dom.slider ? parseInt(this.dom.slider.value, 10) : 3;
          vscode.postMessage({ type: 'cleanBrain', months });
        });
      }
    },

    updateSliderUi(months) {
      const days = months * 30;
      if (this.dom.monthsVal) this.dom.monthsVal.textContent = months;
      if (this.dom.daysHint) this.dom.daysHint.textContent = `(清理 ${days} 天前舊檔)`;
      if (this.dom.cleanBtnText) this.dom.cleanBtnText.textContent = `清理 ${months} 個月前的舊紀錄`;
    },

    render(brain) {
      if (!brain) return;
      if (this.dom.size) this.dom.size.textContent = `${brain.totalMB || '0.0'} MB`;
      if (this.dom.count) this.dom.count.textContent = `${brain.folderCount || 0} 個`;
    },
  };

  // ============================================================================
  // 6. 全域滑鼠右鍵平滑拖曳滾動模組 (RMB Drag Scroll Module)
  // ============================================================================
  const DragScrollModule = {
    init() {
      let isRmbDown = false;
      let hasDragged = false;
      let startY = 0;
      let lastY = 0;
      let accumulatedDeltaY = 0;
      let rafId = null;
      // 移動距離調整為 3 倍（由基準 1.2x 提升至 3.6x，極速大跨度捲動）
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

  // ============================================================================
  // 7. 頂部通用控制與訊息轉發分發器 (App Core Orchestrator)
  // ============================================================================
  const App = {
    init() {
      // 1. 全部摺疊卡片 (靜默執行)
      const btnCollapseAll = document.getElementById('btn-collapse-all');
      if (btnCollapseAll) {
        btnCollapseAll.addEventListener('click', () => {
          document.querySelectorAll('.container details').forEach((el) => {
            el.open = false;
          });
        });
      }

      // 2. 全部展開卡片 (靜默執行)
      const btnExpandAll = document.getElementById('btn-expand-all');
      if (btnExpandAll) {
        btnExpandAll.addEventListener('click', () => {
          document.querySelectorAll('.container details.card').forEach((el) => {
            el.open = true;
          });
        });
      }

      // 3. 頂部重新整理
      const btnRefresh = document.getElementById('btn-refresh');
      if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
          vscode.postMessage({ type: 'fetchStatus' });
          ToastModule.show('已重新整理控制中心狀態', 'info');
        });
      }

      // 4. 0 毫秒快照立即渲染（消除 iframe 重建時的任何白屏與載入跳動）
      const savedState = vscode.getState() || {};
      if (savedState.workspace) {
        WorkspaceModule.render(savedState.workspace);
      }
      if (savedState.scripts) {
        ScriptsModule.render(savedState.scripts);
      }
      if (savedState.settings) {
        SettingsModule.render(savedState.settings);
      }
      if (savedState.brain) {
        BrainModule.render(savedState.brain);
      }

      // 5. 初始化各功能模組
      WorkspaceModule.init();
      ScriptsModule.init();
      NavigationModule.init();
      SettingsModule.init();
      BrainModule.init();
      DragScrollModule.init();

      // 6. 監聽後端 Extension Host 推送訊息
      window.addEventListener('message', (event) => {
        const { type, payload } = event.data;
        switch (type) {
          case 'updateStatus':
            WorkspaceModule.render(payload.workspace);
            ScriptsModule.render(payload.scripts);
            BrainModule.render(payload.brain);
            SettingsModule.render(payload.settings);
            // 持久化保存快照供下次 0ms 瞬間復原
            const curState = vscode.getState() || {};
            vscode.setState({
              ...curState,
              workspace: payload.workspace,
              scripts: payload.scripts,
              brain: payload.brain,
              settings: payload.settings,
            });
            break;
          case 'toast':
            ToastModule.show(payload.message, payload.status || 'info');
            break;
        }
      });

      // 7. 初次載入請求狀態
      vscode.postMessage({ type: 'fetchStatus' });
    },
  };

  // 啟動應用
  App.init();
})();

