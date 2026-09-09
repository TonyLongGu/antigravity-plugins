/**
 * Antigravity IDE - Video Viewer (自訂影片播放器與畫廊核心互動引擎)
 * 遵循 web-video-player-guide 標準：
 * 1. UI 渲染與解碼請求嚴格解耦 (Seek 尋道引擎)
 * 2. 嚴禁在 Seek 中重複呼叫 video.play() 防止解碼死鎖
 * 3. 採用 Pointer Events 與 setPointerCapture 確保平滑拖曳
 * 4. 幽靈點擊 280ms 冷卻保護與意圖點擊判定
 * 5. 全螢幕互動、2.4s 游標自動隱藏與滑鼠右鍵/Esc 退出
 * 6. 畫廊 4.5x 高速右鍵抓手滾動與框選 (Marquee)
 */

(function () {
  // 1. VS Code API 雙軌安全適配
  let vscode = null;
  try {
    if (typeof acquireVsCodeApi === 'function') {
      vscode = acquireVsCodeApi();
    }
  } catch (err) {
    console.log('[VideoViewer] 獨立瀏覽器除錯環境');
  }

  // 2. 全域狀態
  let allVideos = [];
  let filteredVideos = [];
  let currentFolder = '';
  let folderNameStr = '';
  let isRecursive = false;
  let showThumbs = true;

  // 播放器狀態
  let currentIndex = -1;
  let isSeeking = false;
  let justDraggedProgress = false;
  let seekCooldownTimer = null;
  let idleTimer = null;
  let currentSpeed = 1.0;
  let isLooping = false;
  let isAutoNext = false; // 預設關閉：播完單部即停止，不自動跳下一部
  let isMuted = false;
  let lastVolume = 0.5;

  // 3. DOM 節點引用 - 工具列與畫廊
  const folderNameEl = document.getElementById('folderName');
  const folderInfoEl = document.getElementById('folderInfo');
  const videoCountBadgeEl = document.getElementById('videoCountBadge');
  const filterCountBadgeEl = document.getElementById('filterCountBadge');
  const searchInputEl = document.getElementById('searchInput');
  const searchClearEl = document.getElementById('searchClear');
  const sortSelectEl = document.getElementById('sortSelect');
  const sizeSliderEl = document.getElementById('sizeSlider');
  const thumbToggleBtnEl = document.getElementById('thumbToggleBtn');
  const recursiveBtnEl = document.getElementById('recursiveBtn');
  const refreshBtnEl = document.getElementById('refreshBtn');
  const revealFolderBtnEl = document.getElementById('revealFolderBtn');
  const galleryGridEl = document.getElementById('galleryGrid');
  const galleryViewportEl = document.getElementById('galleryViewport');
  const emptyStateEl = document.getElementById('emptyState');

  // 批量操作與框選 DOM
  const selectionMarqueeEl = document.getElementById('selectionMarquee');
  const batchActionBarEl = document.getElementById('batchActionBar');
  const batchSelectedCountEl = document.getElementById('batchSelectedCount');
  const batchCopyPathsBtnEl = document.getElementById('batchCopyPathsBtn');
  const batchDeleteBtnEl = document.getElementById('batchDeleteBtn');
  const batchClearBtnEl = document.getElementById('batchClearBtn');

  // 播放器浮層 DOM
  const playerModalEl = document.getElementById('playerModal');
  const playerTitleEl = document.getElementById('playerTitle');
  const playerMetaEl = document.getElementById('playerMeta');
  const playerIndexBadgeEl = document.getElementById('playerIndexBadge');
  const autoNextBtnEl = document.getElementById('autoNextBtn');
  const loopBtnEl = document.getElementById('loopBtn');
  const speedBtnEl = document.getElementById('speedBtn');
  const speedMenuEl = document.getElementById('speedMenu');
  const selectAndCloseBtnEl = document.getElementById('selectAndCloseBtn');
  const playerCloseBtnEl = document.getElementById('playerCloseBtn');

  const playerStageEl = document.getElementById('playerStage');
  const playerVideoWrapperEl = document.getElementById('playerVideoWrapper');
  const playerVideoEl = document.getElementById('playerVideo');
  const centerPlayIndicatorEl = document.getElementById('centerPlayIndicator');
  const prevBtnEl = document.getElementById('prevBtn');
  const nextBtnEl = document.getElementById('nextBtn');

  // 控制列 DOM
  const progressContainerEl = document.getElementById('progressContainer');
  const progressBarBufferedEl = document.getElementById('progressBarBuffered');
  const progressBarPlayedEl = document.getElementById('progressBarPlayed');
  const progressThumbEl = document.getElementById('progressThumb');
  const progressTooltipEl = document.getElementById('progressTooltip');

  const playPauseBtnEl = document.getElementById('playPauseBtn');
  const iconPlayEl = playPauseBtnEl.querySelector('.icon-play');
  const iconPauseEl = playPauseBtnEl.querySelector('.icon-pause');
  const currentTimeTextEl = document.getElementById('currentTimeText');
  const durationTextEl = document.getElementById('durationText');

  const volumeBtnEl = document.getElementById('volumeBtn');
  const iconVolHighEl = volumeBtnEl.querySelector('.icon-vol-high');
  const iconVolMutedEl = volumeBtnEl.querySelector('.icon-vol-muted');
  const volumeSliderEl = document.getElementById('volumeSlider');
  const ctrlOpenExternalBtnEl = document.getElementById('ctrlOpenExternalBtn');
  const ctrlHideBtnEl = document.getElementById('ctrlHideBtn');

  const toastContainerEl = document.getElementById('toastContainer');

  // ============================================================================
  // 3.5 國際化核心模組 (I18n Module)
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

      const btnLangToggle = document.getElementById('btn-lang-toggle');
      if (btnLangToggle) {
        btnLangToggle.addEventListener('click', (e) => {
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
      if (vscode) {
        vscode.postMessage({ type: 'setGlobalLocale', payload: { locale: next }, locale: next });
      }
      showToast(this.t('toast_lang_switched'), 'info');
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
      if (langIndicator) {
        langIndicator.textContent = this.t('btn_lang_indicator');
      }
      const btnLangToggle = document.getElementById('btn-lang-toggle');
      if (btnLangToggle) {
        btnLangToggle.title = this.t('btn_lang_toggle_title');
      }

      // 遍歷靜態 data-i18n
      document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (key) {
          const trans = this.t(key);
          if (trans !== undefined) {
            el.textContent = trans;
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

      updateRecursiveButton();
      updateThumbToggleButton();
      updateSelectionUI();
      updateAutoNextUI();
      updateLoopUI();

      if (folderNameStr) {
        folderNameEl.textContent = folderNameStr;
      } else {
        folderNameEl.textContent = this.t('loading');
      }
      if (currentFolder) {
        folderInfoEl.title = currentFolder;
      }

      if (allVideos.length > 0) {
        videoCountBadgeEl.textContent = this.t('video_count_badge', { count: allVideos.length });
        if (filteredVideos.length !== allVideos.length) {
          filterCountBadgeEl.textContent = this.t('filter_count_badge', { count: filteredVideos.length });
        }
      }
      renderGallery();
    }
  };

  // 4. 選取狀態集合 (儲存 fullPath)
  const selectedPaths = new Set();

  function updateSelectionUI() {
    const cardEls = galleryGridEl.querySelectorAll('.video-card');
    cardEls.forEach((card) => {
      const p = card.dataset.path;
      if (p && selectedPaths.has(p)) {
        card.classList.add('is-selected');
      } else {
        card.classList.remove('is-selected');
      }
    });

    if (selectedPaths.size > 0) {
      document.body.classList.add('has-selection');
      batchActionBarEl.style.display = 'flex';
      batchSelectedCountEl.textContent = I18nModule.t('batch_selected_count', { count: selectedPaths.size });
    } else {
      document.body.classList.remove('has-selection');
      batchActionBarEl.style.display = 'none';
    }
  }

  function toggleCardSelection(fullPath, forceState) {
    if (typeof forceState === 'boolean') {
      if (forceState) selectedPaths.add(fullPath);
      else selectedPaths.delete(fullPath);
    } else {
      if (selectedPaths.has(fullPath)) {
        selectedPaths.delete(fullPath);
      } else {
        selectedPaths.add(fullPath);
      }
    }
    updateSelectionUI();
  }

  function clearSelection() {
    selectedPaths.clear();
    updateSelectionUI();
  }

  // 5. Toast 訊息提示 (已依需求移除彈窗訊息，杜絕遮擋畫面內容)
  function showToast(message, type = 'info') {
    // 彈窗訊息已停用
  }

  // 6. 時間格式化 (秒 -> MM:SS 或 HH:MM:SS)
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0 || !isFinite(seconds)) return '--:--';
    const s = Math.floor(seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  // 7. 狀態持久化
  const STORAGE_KEY_THUMB_SIZE = 'antigravity.videoViewer.thumbSize';
  const STORAGE_KEY_SHOW_THUMBS = 'antigravity.videoViewer.showThumbs';
  const STORAGE_KEY_VOLUME = 'antigravity.videoViewer.volume';
  const STORAGE_KEY_LAST_VOLUME = 'antigravity.videoViewer.lastVolume';
  const STORAGE_KEY_MUTED = 'antigravity.videoViewer.muted';

  let saveVolumeDebounceTimer = null;
  function saveVolumeState() {
    const rawVol = parseFloat(volumeSliderEl.value);
    const vol = Math.round(Math.max(0, Math.min(1, isNaN(rawVol) ? 0.5 : rawVol)) * 100) / 100;
    const muted = isMuted || (playerVideoEl && playerVideoEl.muted) || vol === 0;
    if (vol > 0) {
      lastVolume = vol;
    }

    try {
      localStorage.setItem(STORAGE_KEY_VOLUME, vol.toString());
      localStorage.setItem(STORAGE_KEY_MUTED, muted ? 'true' : 'false');
      localStorage.setItem(STORAGE_KEY_LAST_VOLUME, lastVolume.toString());
    } catch (_) {}

    if (vscode) {
      const curState = vscode.getState() || {};
      curState.volume = vol;
      curState.muted = muted;
      curState.lastVolume = lastVolume;
      vscode.setState(curState);

      if (saveVolumeDebounceTimer) clearTimeout(saveVolumeDebounceTimer);
      saveVolumeDebounceTimer = setTimeout(() => {
        vscode.postMessage({
          type: 'saveVolume',
          volume: vol,
          muted: muted,
          lastVolume: lastVolume
        });
      }, 200);
    }
  }

  function syncVolumeUI() {
    const rawVol = parseFloat(volumeSliderEl.value);
    const curVol = Math.round(Math.max(0, Math.min(1, isNaN(rawVol) ? 0.5 : rawVol)) * 100) / 100;
    playerVideoEl.volume = curVol;
    playerVideoEl.muted = isMuted || curVol === 0;

    if (playerVideoEl.muted || curVol === 0) {
      iconVolHighEl.style.display = 'none';
      iconVolMutedEl.style.display = 'block';
    } else {
      iconVolHighEl.style.display = 'block';
      iconVolMutedEl.style.display = 'none';
    }
  }

  function saveUiState() {
    const rawVol = parseFloat(volumeSliderEl.value);
    const vol = Math.round(Math.max(0, Math.min(1, isNaN(rawVol) ? 0.5 : rawVol)) * 100) / 100;
    const muted = isMuted || (playerVideoEl && playerVideoEl.muted) || vol === 0;
    if (vol > 0) {
      lastVolume = vol;
    }
    const state = {
      thumbSize: parseInt(sizeSliderEl.value, 10) || 280,
      sortBy: sortSelectEl.value,
      filterText: searchInputEl.value.trim(),
      recursive: isRecursive,
      showThumbs: showThumbs,
      volume: vol,
      muted: muted,
      lastVolume: lastVolume
    };

    if (vscode) {
      vscode.setState(state);
      vscode.postMessage({ type: 'saveThumbSize', size: state.thumbSize });
      vscode.postMessage({ type: 'saveShowThumbs', showThumbs: state.showThumbs });
      vscode.postMessage({ type: 'saveVolume', volume: state.volume, muted: state.muted, lastVolume: state.lastVolume });
    }
    try {
      localStorage.setItem(STORAGE_KEY_THUMB_SIZE, state.thumbSize.toString());
      localStorage.setItem(STORAGE_KEY_SHOW_THUMBS, state.showThumbs ? 'true' : 'false');
      localStorage.setItem(STORAGE_KEY_VOLUME, state.volume.toString());
      localStorage.setItem(STORAGE_KEY_MUTED, state.muted ? 'true' : 'false');
      localStorage.setItem(STORAGE_KEY_LAST_VOLUME, state.lastVolume.toString());
    } catch (_) {}
  }

  function restoreUiState() {
    try {
      const localSize = localStorage.getItem(STORAGE_KEY_THUMB_SIZE);
      if (localSize) {
        sizeSliderEl.value = localSize;
        document.documentElement.style.setProperty('--thumb-size', `${localSize}px`);
      }
      const localShowThumbs = localStorage.getItem(STORAGE_KEY_SHOW_THUMBS);
      if (localShowThumbs !== null) {
        showThumbs = localShowThumbs === 'true';
      }
      const localLastVolume = localStorage.getItem(STORAGE_KEY_LAST_VOLUME);
      if (localLastVolume !== null) {
        const parsed = parseFloat(localLastVolume);
        if (!isNaN(parsed) && parsed > 0) {
          lastVolume = Math.round(Math.max(0.05, Math.min(1, parsed)) * 100) / 100;
        }
      }
      const localVolume = localStorage.getItem(STORAGE_KEY_VOLUME);
      if (localVolume !== null) {
        const parsed = parseFloat(localVolume);
        if (!isNaN(parsed)) {
          const clamped = Math.round(Math.max(0, Math.min(1, parsed)) * 100) / 100;
          volumeSliderEl.value = clamped;
          if (clamped > 0) lastVolume = clamped;
        }
      }
      const localMuted = localStorage.getItem(STORAGE_KEY_MUTED);
      if (localMuted !== null) {
        isMuted = localMuted === 'true';
      }
    } catch (_) {}

    if (!vscode) {
      updateThumbToggleButton();
      syncVolumeUI();
      return;
    }
    const state = vscode.getState();
    if (state) {
      if (state.thumbSize) {
        sizeSliderEl.value = state.thumbSize;
        document.documentElement.style.setProperty('--thumb-size', `${state.thumbSize}px`);
      }
      if (state.sortBy) {
        const optionExists = Array.from(sortSelectEl.options).some(opt => opt.value === state.sortBy);
        sortSelectEl.value = optionExists ? state.sortBy : 'date-desc';
      }
      if (state.filterText) {
        searchInputEl.value = state.filterText;
        searchClearEl.style.display = 'block';
      }
      if (typeof state.recursive === 'boolean') {
        isRecursive = state.recursive;
        updateRecursiveButton();
      }
      if (typeof state.showThumbs === 'boolean') {
        showThumbs = state.showThumbs;
      }
      if (typeof state.lastVolume === 'number' && !isNaN(state.lastVolume) && state.lastVolume > 0) {
        lastVolume = Math.round(Math.max(0.05, Math.min(1, state.lastVolume)) * 100) / 100;
      }
      if (typeof state.volume === 'number' && !isNaN(state.volume)) {
        const clamped = Math.round(Math.max(0, Math.min(1, state.volume)) * 100) / 100;
        volumeSliderEl.value = clamped;
        if (clamped > 0) lastVolume = clamped;
      }
      if (typeof state.muted === 'boolean') {
        isMuted = state.muted;
      }
    }
    updateThumbToggleButton();
    syncVolumeUI();
  }

  function updateThumbToggleButton() {
    if (!thumbToggleBtnEl) return;
    if (showThumbs) {
      thumbToggleBtnEl.classList.remove('is-off');
      thumbToggleBtnEl.classList.add('active');
      thumbToggleBtnEl.title = I18nModule.t('btn_thumb_toggle_title_on');
      document.body.classList.remove('thumbs-disabled');
    } else {
      thumbToggleBtnEl.classList.add('is-off');
      thumbToggleBtnEl.classList.remove('active');
      thumbToggleBtnEl.title = I18nModule.t('btn_thumb_toggle_title_off');
      document.body.classList.add('thumbs-disabled');
    }
  }

  function toggleThumbnails() {
    showThumbs = !showThumbs;
    updateThumbToggleButton();
    saveUiState();
    if (!showThumbs) {
      abortActiveThumbWorker();
      thumbQueue.length = 0;
      if (thumbObserver) thumbObserver.disconnect();
      showToast(I18nModule.t('toast_thumb_disabled'), 'info');
    } else {
      initThumbObserver();
      // 重新喚醒可視區域卡片的縮圖載入
      const cards = galleryGridEl.querySelectorAll('.video-card');
      cards.forEach(card => {
        if (card.dataset.thumbLoaded !== 'true') {
          thumbObserver.observe(card);
        }
      });
      showToast(I18nModule.t('toast_thumb_lazy'), 'info');
    }
  }

  function updateRecursiveButton() {
    if (isRecursive) {
      recursiveBtnEl.classList.add('active');
      recursiveBtnEl.title = I18nModule.t('btn_recursive_title_on');
    } else {
      recursiveBtnEl.classList.remove('active');
      recursiveBtnEl.title = I18nModule.t('btn_recursive_title_off');
    }
  }

  function applyThumbnailSize(newSize, persist = true) {
    const clamped = Math.max(180, Math.min(460, parseInt(newSize, 10) || 280));
    sizeSliderEl.value = clamped;
    document.documentElement.style.setProperty('--thumb-size', `${clamped}px`);
    if (persist) saveUiState();
  }

  // 8. 排序與篩選
  function applyFilterAndSort() {
    const query = searchInputEl.value.trim().toLowerCase();
    const sortBy = sortSelectEl.value;

    if (!query) {
      filteredVideos = [...allVideos];
      filterCountBadgeEl.style.display = 'none';
      searchClearEl.style.display = 'none';
    } else {
      filteredVideos = allVideos.filter(v =>
        v.fileName.toLowerCase().includes(query) ||
        v.relativePath.toLowerCase().includes(query)
      );
      filterCountBadgeEl.style.display = 'inline-flex';
      filterCountBadgeEl.textContent = I18nModule.t('filter_count_badge', { count: filteredVideos.length });
      searchClearEl.style.display = 'block';
    }

    filteredVideos.sort((a, b) => {
      switch (sortBy) {
        case 'name-asc':
          return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' });
        case 'name-desc':
          return b.fileName.localeCompare(a.fileName, undefined, { numeric: true, sensitivity: 'base' });
        case 'size-desc':
          return b.size - a.size;
        case 'size-asc':
          return a.size - b.size;
        case 'date-desc':
          return b.mtimeMs - a.mtimeMs;
        case 'date-asc':
          return a.mtimeMs - b.mtimeMs;
        default:
          return 0;
      }
    });

    renderGallery();
  }

  // ==============================================================================
  // 8.4 IndexedDB 本地持久化縮圖快取 (Persistent Thumbnail Cache)
  // 徹底終結重複解碼：以全路徑 + mtime + size 為鍵，二次載入 0ms 秒出
  // ==============================================================================
  const THUMB_DB_NAME = 'AntigravityVideoThumbDB';
  const THUMB_DB_STORE = 'thumbnails';
  let thumbDbPromise = null;

  function getThumbDB() {
    if (!thumbDbPromise) {
      thumbDbPromise = new Promise((resolve) => {
        try {
          if (!window.indexedDB) {
            resolve(null);
            return;
          }
          const req = indexedDB.open(THUMB_DB_NAME, 1);
          req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(THUMB_DB_STORE)) {
              db.createObjectStore(THUMB_DB_STORE);
            }
          };
          req.onsuccess = (e) => resolve(e.target.result);
          req.onerror = () => resolve(null);
        } catch (_) {
          resolve(null);
        }
      });
    }
    return thumbDbPromise;
  }

  async function getCachedThumbFromDB(key) {
    try {
      const db = await getThumbDB();
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(THUMB_DB_STORE, 'readonly');
          const store = tx.objectStore(THUMB_DB_STORE);
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch (_) {
          resolve(null);
        }
      });
    } catch (_) {
      return null;
    }
  }

  async function saveCachedThumbToDB(key, val) {
    try {
      const db = await getThumbDB();
      if (!db) return;
      const tx = db.transaction(THUMB_DB_STORE, 'readwrite');
      const store = tx.objectStore(THUMB_DB_STORE);
      store.put(val, key);
    } catch (_) {}
  }

  // 瀏覽器 Chromium 可解碼之視訊副檔名清單（其餘 AVI / WMV / FLV 等秒速跳過，防 1.8s 超時懸掛）
  const BROWSER_DECODABLE_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
  function isFormatBrowserDecodable(ext) {
    return BROWSER_DECODABLE_EXTS.has((ext || '').toLowerCase());
  }

  // ==============================================================================
  // 8.5 縮圖背景生成隊列與可視區載入 (Thumbnail Queue & IntersectionObserver)
  // 遵循極致流暢標準：單通道隊列 + metadata 輕量微尋道 + 滾動暫停 + IndexedDB 永久快取
  // ==============================================================================
  const MAX_CONCURRENT_THUMBS = 1;
  let activeThumbWorkers = 0;
  const thumbQueue = [];
  const generatedThumbs = new Map(); // key -> { durationStr, resStr, dataUrl }
  let thumbObserver = null;
  let currentActiveThumbVideo = null;

  // 滾動與拖曳節流控制器 (滾動期間暫停隊列，100% 保障 60fps 流暢交互)
  let isViewportScrolling = false;
  let scrollThrottleTimer = null;

  galleryViewportEl.addEventListener('scroll', () => {
    isViewportScrolling = true;
    clearTimeout(scrollThrottleTimer);
    scrollThrottleTimer = setTimeout(() => {
      isViewportScrolling = false;
      if (showThumbs) {
        processThumbQueue();
      }
    }, 180);
  }, { passive: true });

  function initThumbObserver() {
    if (thumbObserver) {
      thumbObserver.disconnect();
    }
    if (!showThumbs) return;

    thumbObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const card = entry.target;
          queueThumbnailTask(card);
        }
      });
    }, {
      root: galleryViewportEl,
      rootMargin: '120px 0px'
    });
  }

  // 8.4.1 快取版本號（升級至 v4 以支援後端原生 fMP4 時長注入）
  const CACHE_VERSION = 'v4';
  function getCacheKey(video) {
    return `${CACHE_VERSION}::${video.fullPath}::${video.mtimeMs}::${video.size}`;
  }

  async function queueThumbnailTask(card) {
    if (!showThumbs) return;
    const fullPath = card.dataset.path;
    if (!fullPath || card.dataset.thumbLoaded === 'true') return;

    const idx = parseInt(card.dataset.index, 10);
    const video = filteredVideos[idx];
    if (!video) return;

    // 格式快速檢測：若為 Chromium 不支援解碼之格式（如 AVI, WMV, FLV），0ms 直接略過，消弭超時假死
    if (!isFormatBrowserDecodable(video.ext)) {
      card.dataset.thumbLoaded = 'true';
      return;
    }

    const cacheKey = getCacheKey(video);

    // 1. 檢查記憶體快取
    if (generatedThumbs.has(cacheKey)) {
      applyCachedThumb(card, generatedThumbs.get(cacheKey));
      return;
    }

    // 2. 檢查 IndexedDB 本地持久化快取 (0ms 瞬間直出)
    const dbCached = await getCachedThumbFromDB(cacheKey);
    if (dbCached && dbCached.durationStr && dbCached.durationStr !== '--:--') {
      generatedThumbs.set(cacheKey, dbCached);
      if (card.isConnected) {
        applyCachedThumb(card, dbCached);
      }
      return;
    }

    if (!thumbQueue.includes(card)) {
      thumbQueue.push(card);
      processThumbQueue();
    }
  }

  function applyCachedThumb(card, data) {
    if (!data) return;
    card.dataset.thumbLoaded = 'true';
    if (data.durationStr && data.durationStr !== '--:--') {
      const durEl = card.querySelector('.thumb-tag-duration');
      if (durEl) durEl.textContent = data.durationStr;
    }
    if (data.resStr) {
      const resEl = card.querySelector('.thumb-tag-res');
      if (resEl) {
        resEl.textContent = data.resStr;
        resEl.style.display = 'block';
      }
    }
    if (data.dataUrl) {
      const imgEl = card.querySelector('.card-thumb-img');
      const placeholderEl = card.querySelector('.card-thumb-placeholder');
      if (imgEl) {
        imgEl.src = data.dataUrl;
        imgEl.style.display = 'block';
      }
      if (placeholderEl) placeholderEl.style.display = 'none';
    }
  }

  function abortActiveThumbWorker() {
    if (currentActiveThumbVideo) {
      try {
        currentActiveThumbVideo.pause();
        currentActiveThumbVideo.removeAttribute('src');
        currentActiveThumbVideo.load();
      } catch (_) {}
      currentActiveThumbVideo = null;
    }
  }

  function processThumbQueue() {
    if (!showThumbs) return;
    // 若主播放器開啟中，或使用者正在滾動/抓手拖曳畫廊，暫停背景縮圖生成
    if (playerModalEl.classList.contains('active') || isViewportScrolling || isRightDragging) {
      return;
    }

    if (activeThumbWorkers >= MAX_CONCURRENT_THUMBS || thumbQueue.length === 0) {
      return;
    }

    const card = thumbQueue.shift();
    if (!card || !card.isConnected || card.dataset.thumbLoaded === 'true') {
      setTimeout(processThumbQueue, 16);
      return;
    }

    const idx = parseInt(card.dataset.index, 10);
    const video = filteredVideos[idx];
    if (!video) {
      setTimeout(processThumbQueue, 16);
      return;
    }

    activeThumbWorkers++;
    loadSingleThumbnail(card, video).finally(() => {
      activeThumbWorkers--;
      // 每個任務完成後讓渡 UI 執行緒與瀏覽器渲染管線
      setTimeout(processThumbQueue, 40);
    });
  }

  function loadSingleThumbnail(card, video) {
    return new Promise((resolve) => {
      let isDone = false;
      const cacheKey = getCacheKey(video);

      const v = document.createElement('video');
      currentActiveThumbVideo = v;
      // 使用 metadata 避免下載全檔，配合後端 4MB 分塊，磁碟與網路負擔幾乎為 0
      v.preload = 'metadata';
      v.muted = true;
      v.playsInline = true;

      let metaResolved = false;
      // 優先使用後端解析出的高精準時長（秒出 1:02:28，徹底杜絕 fMP4 顯示 --:--）
      let durationStr = (video.durationFormatted && video.durationFormatted !== '--:--') ? video.durationFormatted : '--:--';
      let resStr = null;
      let hasRetriedDark = false;
      let seekFallbackTimer = null;

      const finish = (resultData = null) => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timeoutId);
        if (seekFallbackTimer) clearTimeout(seekFallbackTimer);

        if (currentActiveThumbVideo === v) {
          currentActiveThumbVideo = null;
        }

        if (resultData) {
          generatedThumbs.set(cacheKey, resultData);
          saveCachedThumbToDB(cacheKey, resultData);
          if (card && card.isConnected) {
            applyCachedThumb(card, resultData);
          }
        } else {
          if (card && card.isConnected) {
            if (metaResolved || durationStr !== '--:--') {
              const partialData = { durationStr, resStr, dataUrl: null };
              generatedThumbs.set(cacheKey, partialData);
              saveCachedThumbToDB(cacheKey, partialData);
              applyCachedThumb(card, partialData);
            } else {
              card.dataset.thumbLoaded = 'true';
            }
          }
        }

        // 徹底卸載釋放解碼器與網路連線
        try {
          v.pause();
          v.removeAttribute('src');
          v.load();
        } catch (_) {}
        resolve();
      };

      // 3.5 秒超時保護（伺服器端 4MB chunk 下通常 20ms 內完成）
      const timeoutId = setTimeout(() => finish(null), 3500);

      // 畫面純黑檢測（防範開頭 Fade-in 黑幕）
      function isFrameTooDark(ctx, w, h) {
        try {
          const samplePoints = [
            [w * 0.5, h * 0.5],
            [w * 0.3, h * 0.3],
            [w * 0.7, h * 0.3],
            [w * 0.3, h * 0.7],
            [w * 0.7, h * 0.7],
            [w * 0.5, h * 0.25],
            [w * 0.5, h * 0.75]
          ];
          let sum = 0;
          for (const [x, y] of samplePoints) {
            const p = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
            sum += (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]);
          }
          return (sum / samplePoints.length) < 12;
        } catch (_) {
          return false;
        }
      }

      const captureFrame = () => {
        if (isDone) return;
        if (seekFallbackTimer) clearTimeout(seekFallbackTimer);

        const w = v.videoWidth;
        const h = v.videoHeight;
        let dataUrl = null;

        try {
          if (w > 0 && h > 0) {
            const canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = 180;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(v, 0, 0, 320, 180);

            // 若畫面為純黑，且尚未重試過，且影片時長足夠（> 3秒），嘗試尋道至 2.5 秒重截一次
            const estDuration = (v.duration && isFinite(v.duration)) ? v.duration : (video.duration || 0);
            if (!hasRetriedDark && estDuration > 3.0 && isFrameTooDark(ctx, 320, 180)) {
              hasRetriedDark = true;
              try {
                v.currentTime = Math.min(2.5, estDuration * 0.2);
                return; // 等待下一次 seeked
              } catch (_) {}
            }

            dataUrl = canvas.toDataURL('image/jpeg', 0.65);
          }
        } catch (_) {}

        finish({ durationStr, resStr, dataUrl });
      };

      v.addEventListener('loadedmetadata', () => {
        metaResolved = true;
        if (v.duration && !isNaN(v.duration) && isFinite(v.duration) && v.duration > 0) {
          durationStr = formatTime(v.duration);
        } else if (video.durationFormatted && video.durationFormatted !== '--:--') {
          // 支援 fMP4 / 直播串流，直接使用後端精準時長
          durationStr = video.durationFormatted;
        }

        const w = v.videoWidth;
        const h = v.videoHeight;
        if (w && h) {
          if (w >= 3840 || h >= 2160) resStr = '4K';
          else if (w >= 1920 || h >= 1080) resStr = '1080p';
          else if (w >= 1280 || h >= 720) resStr = '720p';
          else resStr = `${w}×${h}`;
        }

        // 立即在卡片顯示時長與解析度
        if (card && card.isConnected) {
          const durEl = card.querySelector('.thumb-tag-duration');
          if (durEl && durationStr !== '--:--') durEl.textContent = durationStr;
          const resEl = card.querySelector('.thumb-tag-res');
          if (resEl && resStr) {
            resEl.textContent = resStr;
            resEl.style.display = 'block';
          }
        }

        // 尋道防黑幕與 fMP4 直播串流防死鎖保護：
        // 設定 500ms 降級定時器，若 fMP4 拒絕 seek，直接以當前第一影格截圖，絕不掛死！
        try {
          const hasFiniteDur = isFinite(v.duration) && v.duration > 0;
          const targetTime = (hasFiniteDur && v.duration > 1.2) ? 1.0 : (hasFiniteDur ? Math.min(0.2, v.duration * 0.1) : 1.0);
          seekFallbackTimer = setTimeout(() => {
            if (!isDone) {
              captureFrame();
            }
          }, 500);
          v.currentTime = targetTime;
        } catch (_) {
          captureFrame();
        }
      }, { once: true });

      v.addEventListener('seeked', () => {
        if (seekFallbackTimer) clearTimeout(seekFallbackTimer);
        requestAnimationFrame(() => {
          captureFrame();
        });
      }, { once: false });

      v.addEventListener('error', () => finish(null), { once: true });

      v.src = video.uri;
    });
  }

  // 9. 渲染畫廊卡片工廠 (輕量化 DOM + 事件委託準備)
  let currentRenderToken = 0;

  function createVideoCard(video, idx) {
    const card = document.createElement('div');
    card.className = `video-card ${selectedPaths.has(video.fullPath) ? 'is-selected' : ''}`;
    card.dataset.index = idx;
    card.dataset.path = video.fullPath;

    const formatUpper = (video.ext || '').toUpperCase() || 'VIDEO';
    const extLower = (video.ext || '').toLowerCase();
    const durInitial = (video.durationFormatted && video.durationFormatted !== '--:--') ? video.durationFormatted : '--:--';
    const isDecodable = isFormatBrowserDecodable(video.ext);
    const formatTagText = isDecodable ? formatUpper : `${formatUpper} • 外部播放`;

    card.innerHTML = `
      <div class="card-thumb-container">
        <div class="card-thumb-placeholder">
          <svg class="placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect>
            <polyline points="10 9 15 12 10 15 10 9"></polyline>
          </svg>
          <span class="placeholder-ext">${formatUpper}</span>
        </div>
        <img class="card-thumb-img" alt="${video.fileName}" style="display:none;" />
        <div class="card-hover-video-wrapper"></div>
        <div class="card-overlay"></div>
        <div class="card-play-badge">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        </div>
        <div class="thumb-tag thumb-tag-format" data-ext="${extLower}" title="${!isDecodable ? '非瀏覽器原生解碼格式，點擊右上角圖示即可調用系統播放器開啟' : ''}">${formatTagText}</div>
        <div class="thumb-tag thumb-tag-duration" id="dur-${idx}">${durInitial}</div>
        <div class="thumb-tag thumb-tag-res" id="res-${idx}" style="display:none;"></div>
        <div class="card-select-btn" title="${I18nModule.t('card_select_title')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>
      </div>
      <div class="card-info">
        <div class="card-title" title="${video.fullPath}">${video.fileName}</div>
        <div class="card-meta-row">
          <div class="card-actions">
            <button class="card-action-btn copy-btn" title="${I18nModule.t('card_copy_btn_title')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>
            </button>
            <button class="card-action-btn open-ext-btn" title="${I18nModule.t('card_open_ext_title')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.033 9.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56V7.648a.645.645 0 0 1 .967-.56z"></path><path d="M12 17v4"></path><path d="M8 21h8"></path><rect x="2" y="3" width="20" height="14" rx="2"></rect></svg>
            </button>
            <button class="card-action-btn reveal-btn" title="${I18nModule.t('card_reveal_title')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </button>
          </div>
          <span class="card-date" title="${video.mtimeMs ? new Date(video.mtimeMs).toLocaleString() : ''}">${video.mtimeMs ? new Date(video.mtimeMs).toLocaleDateString() : ''}</span>
        </div>
      </div>
    `;

    // 縮圖快速套用或加入觀察
    const cacheKey = getCacheKey(video);
    if (generatedThumbs.has(cacheKey)) {
      applyCachedThumb(card, generatedThumbs.get(cacheKey));
    } else if (showThumbs && thumbObserver) {
      thumbObserver.observe(card);
    }

    // 按需懸停預覽
    let hoverTimer = null;
    let activePreviewVideo = null;

    card.addEventListener('pointerenter', () => {
      if (playerModalEl.classList.contains('active') || !showThumbs) return;
      if (!isFormatBrowserDecodable(video.ext)) return;

      hoverTimer = setTimeout(() => {
        const wrapper = card.querySelector('.card-hover-video-wrapper');
        if (!wrapper || activePreviewVideo) return;

        activePreviewVideo = document.createElement('video');
        activePreviewVideo.className = 'card-hover-video';
        activePreviewVideo.src = video.uri;
        activePreviewVideo.autoplay = true;
        activePreviewVideo.muted = true;
        activePreviewVideo.loop = true;
        activePreviewVideo.playsInline = true;

        wrapper.appendChild(activePreviewVideo);
        activePreviewVideo.play().catch(() => {});
      }, 250);
    });

    const clearPreview = () => {
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      if (activePreviewVideo) {
        activePreviewVideo.pause();
        activePreviewVideo.removeAttribute('src');
        activePreviewVideo.load();
        activePreviewVideo.remove();
        activePreviewVideo = null;
      }
    };

    card.addEventListener('pointerleave', clearPreview);

    // 勾選按鈕點擊
    const selectBtn = card.querySelector('.card-select-btn');
    selectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCardSelection(video.fullPath);
    });

    // 卡片點擊進入播放或選取切換
    card.addEventListener('click', (e) => {
      if (hasDraggedLeftBox || hasRightDragged) return;
      if (e.target.closest('.card-action-btn') || e.target.closest('.card-select-btn')) return;

      if (e.shiftKey) {
        e.preventDefault();
        toggleCardSelection(video.fullPath);
        return;
      }

      if (selectedPaths.size > 0) {
        toggleCardSelection(video.fullPath);
        return;
      }

      clearPreview();
      openPlayer(idx);
    });

    // 雙擊永遠進入播放
    card.addEventListener('dblclick', (e) => {
      if (e.target.closest('.card-action-btn') || e.target.closest('.card-select-btn')) return;
      clearPreview();
      openPlayer(idx);
    });

    // 快速複製路徑
    const copyBtn = card.querySelector('.copy-btn');
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(video.fullPath);
      showToast(I18nModule.t('toast_copy_success', { file: video.fileName }), 'success');
    });

    // 以系統播放器開啟
    const openExtBtn = card.querySelector('.open-ext-btn');
    if (openExtBtn) {
      openExtBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!playerVideoEl.paused) {
          playerVideoEl.pause();
        }
        if (vscode) {
          vscode.postMessage({ type: 'openWithDefaultApp', filePath: video.fullPath });
          showToast(I18nModule.t('toast_open_external', { file: video.fileName }), 'info');
        }
      });
    }

    // 在系統總管中定位
    const revealBtn = card.querySelector('.reveal-btn');
    revealBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (vscode) {
        vscode.postMessage({ type: 'revealFile', filePath: video.fullPath });
      }
    });

    return card;
  }

  // 9. 渲染畫廊網格 (首屏 36 部瞬開 + RAF 漸進式分批掛載)
  function renderGallery() {
    galleryGridEl.innerHTML = '';
    thumbQueue.length = 0;
    abortActiveThumbWorker();
    initThumbObserver();

    if (filteredVideos.length === 0) {
      emptyStateEl.style.display = 'flex';
      return;
    }
    emptyStateEl.style.display = 'none';

    const token = ++currentRenderToken;
    const CHUNK_SIZE = 36;
    const initialBatch = filteredVideos.slice(0, CHUNK_SIZE);

    // 1. 瞬間渲染第一屏（36 部以內），確保 16ms 內即刻呈現介面
    const fragment = document.createDocumentFragment();
    initialBatch.forEach((video, idx) => {
      fragment.appendChild(createVideoCard(video, idx));
    });
    galleryGridEl.appendChild(fragment);

    // 2. 其餘卡片透過 requestAnimationFrame 漸進式分批掛載，徹底消除 DOM 阻塞
    if (filteredVideos.length > CHUNK_SIZE) {
      let nextIndex = CHUNK_SIZE;

      function renderNextChunk() {
        if (token !== currentRenderToken) return;
        if (nextIndex >= filteredVideos.length) return;

        const end = Math.min(nextIndex + CHUNK_SIZE, filteredVideos.length);
        const chunkFrag = document.createDocumentFragment();
        for (let i = nextIndex; i < end; i++) {
          chunkFrag.appendChild(createVideoCard(filteredVideos[i], i));
        }
        galleryGridEl.appendChild(chunkFrag);
        nextIndex = end;

        if (nextIndex < filteredVideos.length) {
          requestAnimationFrame(renderNextChunk);
        }
      }

      requestAnimationFrame(renderNextChunk);
    }
  }

  // 10. 複製剪貼簿
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
    } catch (_) {}
    document.body.removeChild(textarea);
  }

  // ==============================================================================
  // 11. 自訂影片播放器引擎 (遵循 web-video-player-guide)
  // ==============================================================================

  function openPlayer(index) {
    if (index < 0 || index >= filteredVideos.length) return;
    currentIndex = index;
    const v = filteredVideos[currentIndex];

    playerTitleEl.textContent = v.fileName;
    playerTitleEl.title = v.fullPath;
    playerIndexBadgeEl.textContent = `${currentIndex + 1} / ${filteredVideos.length}`;
    playerMetaEl.textContent = `${I18nModule.t('loading')} • ${v.sizeFormatted}`;

    prevBtnEl.disabled = currentIndex <= 0;
    nextBtnEl.disabled = currentIndex >= filteredVideos.length - 1;

    // 暫停所有背景縮圖隊列，並立即中斷當前背景解碼任務，將所有連線與解碼器配額 100% 留給當前播放影片
    thumbQueue.length = 0;
    abortActiveThumbWorker();

    // 載入影片來源
    playerVideoEl.src = v.uri;
    playerVideoEl.playbackRate = currentSpeed;
    playerVideoEl.loop = isLooping;
    syncVolumeUI();
    updateAutoNextUI();
    updateLoopUI();

    playerModalEl.classList.add('active');
    document.body.classList.add('in-player');

    // 重置進度條與狀態
    progressBarPlayedEl.style.width = '0%';
    progressBarBufferedEl.style.width = '0%';
    progressThumbEl.style.left = '0%';
    currentTimeTextEl.textContent = '00:00';
    durationTextEl.textContent = '00:00';

    // 嘗試自動播放
    playerVideoEl.play().then(() => {
      updatePlayPauseUI(true);
    }).catch((err) => {
      console.log('[VideoPlayer] 自動播放受阻，等待使用者互動:', err);
      updatePlayPauseUI(false);
    });

    resetIdleTimer();
  }

  function closePlayer() {
    if (!playerModalEl.classList.contains('active')) return;

    playerVideoEl.pause();
    playerVideoEl.removeAttribute('src');
    playerVideoEl.load();

    playerModalEl.classList.remove('active');
    playerModalEl.classList.remove('is-playing', 'is-idle');
    document.body.classList.remove('in-player');

    currentIndex = -1;
    clearTimeout(idleTimer);
    hideCooldownUntil = 0;
    wakeUpOriginX = null;
    wakeUpOriginY = null;

    // 恢復背景縮圖隊列處理（僅交由 IntersectionObserver 按需排入當前可視區）
    if (showThumbs) {
      processThumbQueue();
    }
  }

  function prevVideo() {
    if (currentIndex > 0) {
      openPlayer(currentIndex - 1);
    } else {
      showToast(I18nModule.t('toast_first_video'), 'info');
    }
  }

  function nextVideo() {
    if (currentIndex < filteredVideos.length - 1) {
      openPlayer(currentIndex + 1);
    } else {
      showToast(I18nModule.t('toast_last_video'), 'info');
    }
  }

  function togglePlayPause() {
    if (playerVideoEl.paused || playerVideoEl.ended) {
      if (playerVideoEl.ended || (playerVideoEl.duration > 0 && playerVideoEl.currentTime >= playerVideoEl.duration)) {
        playerVideoEl.currentTime = 0;
      }
      playerVideoEl.play().catch(() => {});
      triggerCenterPlayAnimation(true);
    } else {
      playerVideoEl.pause();
      triggerCenterPlayAnimation(false);
    }
  }

  function updatePlayPauseUI(isPlaying) {
    if (isPlaying) {
      iconPlayEl.style.display = 'none';
      iconPauseEl.style.display = 'block';
      playerModalEl.classList.add('is-playing');
      resetIdleTimer();
    } else {
      iconPlayEl.style.display = 'block';
      iconPauseEl.style.display = 'none';
      playerModalEl.classList.remove('is-playing', 'is-idle');
      clearTimeout(idleTimer);
    }
  }

  function triggerCenterPlayAnimation(isPlaying) {
    centerPlayIndicatorEl.innerHTML = isPlaying
      ? `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`
      : `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
    centerPlayIndicatorEl.classList.remove('animate');
    void centerPlayIndicatorEl.offsetWidth; // 強制重繪
    centerPlayIndicatorEl.classList.add('animate');
    setTimeout(() => {
      centerPlayIndicatorEl.classList.remove('animate');
    }, 450);
  }

  // 12. 前端 Seek 尋道引擎工程標準 (解耦 UI 渲染與解碼請求)
  function calculateProgressRatio(clientX) {
    const rect = progressContainerEl.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pos;
  }

  function updateProgressUI(ratio, timeStr = null) {
    const pct = `${(ratio * 100).toFixed(2)}%`;
    progressBarPlayedEl.style.width = pct;
    progressThumbEl.style.left = pct;
    if (timeStr) {
      currentTimeTextEl.textContent = timeStr;
    }
  }

  function getEffectiveDuration() {
    if (isFinite(playerVideoEl.duration) && playerVideoEl.duration > 0) {
      return playerVideoEl.duration;
    }
    if (currentIndex >= 0 && currentIndex < filteredVideos.length) {
      const v = filteredVideos[currentIndex];
      if (v && typeof v.duration === 'number' && v.duration > 0) {
        return v.duration;
      }
    }
    return 0;
  }

  function applySeek(targetTime) {
    if (isNaN(targetTime) || !isFinite(targetTime)) return;
    const dur = getEffectiveDuration();
    if (!dur) return;

    const clampedTime = Math.max(0, Math.min(dur, targetTime));
    playerVideoEl.currentTime = clampedTime;

    // 避坑原則：Chromium 在設定 currentTime 後會自動恢復先前的播放狀態，切勿手動呼叫 play()！
    // 開啟 280ms 幽靈點擊冷卻，防止 pointerup 後合成之點擊事件意外觸發播放/暫停
    justDraggedProgress = true;
    if (seekCooldownTimer) clearTimeout(seekCooldownTimer);
    seekCooldownTimer = setTimeout(() => {
      justDraggedProgress = false;
    }, 280);
  }

  // 進度條 Pointer Events
  progressContainerEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    isSeeking = true;
    progressContainerEl.classList.add('is-seeking');
    try {
      progressContainerEl.setPointerCapture(e.pointerId);
    } catch (_) {}

    const ratio = calculateProgressRatio(e.clientX);
    const dur = getEffectiveDuration();
    updateProgressUI(ratio, formatTime(ratio * dur));
  });

  progressContainerEl.addEventListener('pointermove', (e) => {
    const ratio = calculateProgressRatio(e.clientX);
    const dur = getEffectiveDuration();
    const hoverTime = ratio * dur;

    // 懸停 Tooltip
    progressTooltipEl.style.display = 'block';
    progressTooltipEl.style.left = `${(ratio * 100).toFixed(2)}%`;
    progressTooltipEl.textContent = formatTime(hoverTime);

    // 拖曳尋道中：僅更新 UI 寬度與文字（保證 60fps 流暢），嚴禁頻繁賦值 playerVideo.currentTime！
    if (isSeeking) {
      updateProgressUI(ratio, formatTime(hoverTime));
    }
  });

  progressContainerEl.addEventListener('pointerleave', () => {
    if (!isSeeking) {
      progressTooltipEl.style.display = 'none';
    }
  });

  const endSeek = (e) => {
    if (!isSeeking) return;
    isSeeking = false;
    progressContainerEl.classList.remove('is-seeking');
    progressTooltipEl.style.display = 'none';

    try {
      progressContainerEl.releasePointerCapture(e.pointerId);
    } catch (_) {}

    const ratio = calculateProgressRatio(e.clientX);
    const dur = getEffectiveDuration();
    applySeek(ratio * dur);
  };

  progressContainerEl.addEventListener('pointerup', endSeek);
  progressContainerEl.addEventListener('pointercancel', endSeek);

  // 13. 意圖點擊判定 (Intentional Click)
  let stageDownTime = 0;
  let stageDownX = 0;
  let stageDownY = 0;

  playerStageEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    stageDownTime = Date.now();
    stageDownX = e.clientX;
    stageDownY = e.clientY;
  });

  playerStageEl.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    if (justDraggedProgress) return;
    if (e.target.closest('.nav-arrow') || e.target.closest('.player-header') || e.target.closest('.player-controls')) return;

    const elapsed = Date.now() - stageDownTime;
    const dist = Math.hypot(e.clientX - stageDownX, e.clientY - stageDownY);

    // 意圖判定：按住時間 < 400ms 且位移 < 10px 視為意圖點擊，排除滑動與拖曳
    if (elapsed < 400 && dist < 10) {
      togglePlayPause();
    }
  });

  // 14. 影片元素本體事件監聽
  playerVideoEl.addEventListener('play', () => updatePlayPauseUI(true));
  playerVideoEl.addEventListener('pause', () => updatePlayPauseUI(false));

  playerVideoEl.addEventListener('timeupdate', () => {
    if (isSeeking) return; // 尋道中不干擾使用者拖曳
    const cur = playerVideoEl.currentTime;
    const dur = getEffectiveDuration();
    if (dur > 0) {
      const pct = `${((cur / dur) * 100).toFixed(2)}%`;
      progressBarPlayedEl.style.width = pct;
      progressThumbEl.style.left = pct;
      currentTimeTextEl.textContent = formatTime(cur);
    }
  });

  playerVideoEl.addEventListener('progress', () => {
    const dur = getEffectiveDuration();
    if (dur > 0 && playerVideoEl.buffered.length > 0) {
      const bufferedEnd = playerVideoEl.buffered.end(playerVideoEl.buffered.length - 1);
      const pct = `${Math.min(100, (bufferedEnd / dur) * 100).toFixed(2)}%`;
      progressBarBufferedEl.style.width = pct;
    }
  });

  playerVideoEl.addEventListener('loadedmetadata', () => {
    const v = (currentIndex >= 0 && currentIndex < filteredVideos.length) ? filteredVideos[currentIndex] : null;
    if (isFinite(playerVideoEl.duration) && playerVideoEl.duration > 0) {
      durationTextEl.textContent = formatTime(playerVideoEl.duration);
    } else if (v && v.durationFormatted && v.durationFormatted !== '--:--') {
      durationTextEl.textContent = v.durationFormatted;
    }
    const w = playerVideoEl.videoWidth;
    const h = playerVideoEl.videoHeight;
    if (v) {
      playerMetaEl.textContent = `${w} × ${h} • ${v.sizeFormatted}`;
    }
  });

  playerVideoEl.addEventListener('ended', () => {
    if (isLooping) {
      playerVideoEl.currentTime = 0;
      playerVideoEl.play().catch(() => {});
      return;
    }

    if (isAutoNext) {
      if (currentIndex < filteredVideos.length - 1) {
        nextVideo();
      } else {
        showToast(I18nModule.t('toast_last_video'), 'info');
        updatePlayPauseUI(false);
      }
      return;
    }

    // 預設行為：播放一次就停止
    updatePlayPauseUI(false);
    currentTimeTextEl.textContent = formatTime(playerVideoEl.duration || 0);
    progressBarPlayedEl.style.width = '100%';
    progressThumbEl.style.left = '100%';
  });

  playerVideoEl.addEventListener('error', () => {
    const err = playerVideoEl.error;
    let desc = '影片無法載入或解碼';
    if (err) {
      if (err.code === 1) desc = '播放被中止 (MEDIA_ERR_ABORTED)';
      else if (err.code === 2) desc = '網路或連線讀取失敗 (MEDIA_ERR_NETWORK)';
      else if (err.code === 3) desc = '影片解碼失敗 (MEDIA_ERR_DECODE)';
      else if (err.code === 4) desc = '格式不支援 (建議以系統播放器開啟)';
    }
    console.error('[VideoPlayer] 播放錯誤:', err, playerVideoEl.src);
    playerMetaEl.innerHTML = `<span>播放失敗 • ${desc}</span> <button id="errOpenExtBtn" style="margin-left:8px;background:var(--accent-blue,#38bdf8);color:#0f172a;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;font-weight:600;">以系統播放器開啟 (O)</button>`;
    const errBtn = document.getElementById('errOpenExtBtn');
    if (errBtn) {
      errBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openCurrentInExternalPlayer();
      });
    }
    showToast(I18nModule.t('toast_play_error', { desc }), 'warn');
    updatePlayPauseUI(false);
  });

  // 快進 / 快退 5 秒
  function seekDelta(seconds) {
    const cur = playerVideoEl.currentTime || 0;
    applySeek(cur + seconds);
    showToast(seconds > 0 ? I18nModule.t('toast_forward', { sec: seconds }) : I18nModule.t('toast_rewind', { sec: Math.abs(seconds) }), 'info');
  }

  playPauseBtnEl.addEventListener('click', togglePlayPause);
  prevBtnEl.addEventListener('click', prevVideo);
  nextBtnEl.addEventListener('click', nextVideo);

  // 15. 音量控制
  function setVolume(vol, persist = true) {
    const clamped = Math.round(Math.max(0, Math.min(1, vol)) * 100) / 100;
    volumeSliderEl.value = clamped;

    if (clamped === 0) {
      isMuted = true;
    } else {
      isMuted = false;
      lastVolume = clamped;
    }
    syncVolumeUI();

    if (persist) {
      saveVolumeState();
    }
  }

  volumeSliderEl.addEventListener('input', (e) => {
    setVolume(parseFloat(e.target.value));
  });

  volumeBtnEl.addEventListener('click', () => {
    if (isMuted || playerVideoEl.muted || playerVideoEl.volume === 0) {
      setVolume(lastVolume > 0 ? lastVolume : 0.5);
    } else {
      setVolume(0);
    }
  });

  // 16. 播放倍速與循環
  function toggleAutoNext() {
    isAutoNext = !isAutoNext;
    updateAutoNextUI();
    try {
      localStorage.setItem('antigravity_video_autonext', String(isAutoNext));
    } catch (e) {}
    if (vscode) {
      vscode.postMessage({ type: 'saveAutoNext', autoNext: isAutoNext });
    }
    showToast(isAutoNext ? I18nModule.t('toast_autonext_on') : I18nModule.t('toast_autonext_off'), 'info');
  }

  function updateAutoNextUI() {
    if (autoNextBtnEl) {
      autoNextBtnEl.classList.toggle('active', isAutoNext);
      autoNextBtnEl.title = isAutoNext
        ? I18nModule.t('player_autonext_title_on')
        : I18nModule.t('player_autonext_title_off');
    }
  }

  function toggleLoop() {
    isLooping = !isLooping;
    updateLoopUI();
    try {
      localStorage.setItem('antigravity_video_loop', String(isLooping));
    } catch (e) {}
    if (vscode) {
      vscode.postMessage({ type: 'saveLoop', loop: isLooping });
    }
    showToast(isLooping ? I18nModule.t('toast_loop_on') : I18nModule.t('toast_loop_off'), 'info');
  }

  function updateLoopUI() {
    playerVideoEl.loop = isLooping;
    if (loopBtnEl) {
      loopBtnEl.classList.toggle('active', isLooping);
      loopBtnEl.title = isLooping
        ? I18nModule.t('player_loop_title_on')
        : I18nModule.t('player_loop_title_off');
    }
  }

  if (autoNextBtnEl) {
    autoNextBtnEl.addEventListener('click', toggleAutoNext);
  }
  loopBtnEl.addEventListener('click', toggleLoop);

  speedBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    speedMenuEl.style.display = speedMenuEl.style.display === 'block' ? 'none' : 'block';
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.speed-dropdown-wrapper')) {
      speedMenuEl.style.display = 'none';
    }
  });

  speedMenuEl.querySelectorAll('.speed-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const speed = parseFloat(item.dataset.speed) || 1.0;
      currentSpeed = speed;
      playerVideoEl.playbackRate = speed;
      speedBtnEl.textContent = `${speed}x`;

      speedMenuEl.querySelectorAll('.speed-item').forEach(el => el.classList.remove('is-active'));
      item.classList.add('is-active');
      speedMenuEl.style.display = 'none';
      showToast(I18nModule.t('toast_speed', { speed }), 'info');
    });
  });

  // 17.1 以系統預設播放器開啟當前影片 (桌面原生硬解全螢幕體驗)
  function openCurrentInExternalPlayer() {
    if (currentIndex >= 0 && currentIndex < filteredVideos.length) {
      const video = filteredVideos[currentIndex];
      if (video && video.fullPath) {
        if (!playerVideoEl.paused) {
          playerVideoEl.pause();
        }
        if (vscode) {
          vscode.postMessage({
            type: 'openWithDefaultApp',
            filePath: video.fullPath
          });
          showToast(I18nModule.t('toast_open_external', { file: video.fileName }), 'info');
        }
      }
    }
  }

  if (ctrlOpenExternalBtnEl) {
    ctrlOpenExternalBtnEl.addEventListener('click', openCurrentInExternalPlayer);
  }

  // 17.0 隱藏控制器按鈕與常駐控制邏輯
  let isAutoHideDisabled = false;
  let hideCooldownUntil = 0;
  let wakeUpOriginX = null;
  let wakeUpOriginY = null;

  function hideControlsImmediately(optX = null, optY = null) {
    clearTimeout(idleTimer);
    // 依需求設定 1 秒 (1000ms) 冷卻，期間完全停止對滑鼠滑入/移動的偵測，防止滑鼠移開時控制器又馬上跳出來
    hideCooldownUntil = Date.now() + 1000;
    wakeUpOriginX = optX;
    wakeUpOriginY = optY;
    playerModalEl.classList.add('is-idle');
  }

  if (ctrlHideBtnEl) {
    ctrlHideBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      hideControlsImmediately(e.clientX, e.clientY);
    });

    // 支援右鍵點擊切換「鎖定常駐 / 自動隱藏」
    ctrlHideBtnEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isAutoHideDisabled = !isAutoHideDisabled;
      if (isAutoHideDisabled) {
        clearTimeout(idleTimer);
        playerModalEl.classList.remove('is-idle');
        ctrlHideBtnEl.classList.add('is-pinned');
        showToast(I18nModule.t('toast_controls_pinned'), 'info');
      } else {
        ctrlHideBtnEl.classList.remove('is-pinned');
        showToast(I18nModule.t('toast_controls_autohide'), 'info');
        resetIdleTimer();
      }
    });
  }

  // 在畫廊中選取當前播放影片並關閉
  selectAndCloseBtnEl.addEventListener('click', () => {
    if (currentIndex >= 0 && currentIndex < filteredVideos.length) {
      const cur = filteredVideos[currentIndex];
      closePlayer();
      selectedPaths.add(cur.fullPath);
      updateSelectionUI();

      setTimeout(() => {
        const cardEl = galleryGridEl.querySelector(`.video-card[data-path="${CSS.escape(cur.fullPath)}"]`);
        if (cardEl) {
          cardEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }, 50);

      showToast(I18nModule.t('toast_locate_success', { file: cur.fileName }), 'success');
    }
  });

  // 17. 游標與控制列 2.4 秒自動隱藏 (Auto-Hide Inactivity Timer)
  function resetIdleTimer() {
    clearTimeout(idleTimer);
    playerModalEl.classList.remove('is-idle');

    if (isAutoHideDisabled) return;

    if (!playerVideoEl.paused && !playerVideoEl.ended) {
      idleTimer = setTimeout(() => {
        if (!playerVideoEl.paused && !isSeeking && !isAutoHideDisabled) {
          playerModalEl.classList.add('is-idle');
        }
      }, 2400);
    }
  }

  // 滑鼠移動與滑入事件偵測（具備 1 秒防抖冷卻與實質位移喚醒判定）
  function handlePointerMove(e) {
    const now = Date.now();
    if (now < hideCooldownUntil) {
      // 1 秒冷卻期間內：完全阻斷喚醒，並持續更新移開過程中的最新座標
      wakeUpOriginX = e.clientX;
      wakeUpOriginY = e.clientY;
      return;
    }

    // 若剛結束 1 秒冷卻，滑鼠必須有新的一段實質位移（> 8px）才視為主動喚醒，杜絕移開收尾時的微小殘留抖動
    if (wakeUpOriginX !== null && wakeUpOriginY !== null) {
      const dist = Math.hypot(e.clientX - wakeUpOriginX, e.clientY - wakeUpOriginY);
      if (dist < 8) return;
      wakeUpOriginX = null;
      wakeUpOriginY = null;
    }

    resetIdleTimer();
  }

  playerModalEl.addEventListener('pointermove', handlePointerMove);

  // 18. 關閉按鈕與右鍵退出 (符合「圖片檢視器右鍵退出」體驗)
  playerCloseBtnEl.addEventListener('click', closePlayer);

  // 全域右鍵阻斷與播放器右鍵退出核心
  document.addEventListener('contextmenu', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    // 若在控制列按鈕或浮動元素上點擊右鍵，不觸發關閉播放器
    if (e.target.closest('#ctrlHideBtn') || e.target.closest('.ctrl-btn') || e.target.closest('.btn-icon')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    // 若在播放器視窗內點擊滑鼠右鍵 -> 關閉播放器（如同 Esc）
    if (playerModalEl.classList.contains('active')) {
      closePlayer();
    }
  });

  // ==============================================================================
  // 19. 畫廊圖片列表 - 壓住右鍵拖曳滾動 (4.5x 抓手高速手勢)
  // ==============================================================================
  let isRightDragging = false;
  let rightDragStartY = 0;
  let rightDragStartX = 0;
  let rightDragStartScrollTop = 0;
  let rightDragStartScrollLeft = 0;
  let hasRightDragged = false;
  let rightDragPointerId = null;
  const RIGHT_DRAG_SPEED = 4.5;

  galleryViewportEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 2 || playerModalEl.classList.contains('active')) return;

    isRightDragging = true;
    hasRightDragged = false;
    rightDragStartY = e.clientY;
    rightDragStartX = e.clientX;
    rightDragStartScrollTop = galleryViewportEl.scrollTop;
    rightDragStartScrollLeft = galleryViewportEl.scrollLeft;
    rightDragPointerId = e.pointerId;

    try {
      galleryViewportEl.setPointerCapture(e.pointerId);
    } catch (_) {}
  });

  galleryViewportEl.addEventListener('pointermove', (e) => {
    if (!isRightDragging) return;
    if ((e.buttons & 2) === 0) {
      endRightDrag();
      return;
    }

    const deltaY = e.clientY - rightDragStartY;
    const deltaX = e.clientX - rightDragStartX;

    if (!hasRightDragged && (Math.abs(deltaY) > 2 || Math.abs(deltaX) > 2)) {
      hasRightDragged = true;
      document.body.classList.add('is-right-dragging');
    }

    if (hasRightDragged) {
      galleryViewportEl.scrollTop = rightDragStartScrollTop - deltaY * RIGHT_DRAG_SPEED;
      if (galleryViewportEl.scrollWidth > galleryViewportEl.clientWidth) {
        galleryViewportEl.scrollLeft = rightDragStartScrollLeft - deltaX * RIGHT_DRAG_SPEED;
      }
    }
  });

  const endRightDrag = () => {
    if (!isRightDragging) return;
    isRightDragging = false;
    hasRightDragged = false;

    if (rightDragPointerId !== null) {
      try {
        galleryViewportEl.releasePointerCapture(rightDragPointerId);
      } catch (_) {}
      rightDragPointerId = null;
    }
    document.body.classList.remove('is-right-dragging');
  };

  galleryViewportEl.addEventListener('pointerup', (e) => {
    if (e.button === 2) endRightDrag();
  });
  galleryViewportEl.addEventListener('pointercancel', endRightDrag);

  // ==============================================================================
  // 20. 畫廊影片列表 - 滑鼠左鍵拖曳框選與 Shift 加選 (Marquee Box Selection)
  // 參照 image-viewer 實作，支援自任意位置起拉框、不提早 capture 避免阻斷單擊、高精確度螢幕空間 AABB 碰撞
  // ==============================================================================
  let isLeftBoxSelecting = false;
  let hasDraggedLeftBox = false;
  let boxStartX = 0;
  let boxStartY = 0;
  let initialSelectedPathsOnDrag = new Set();
  let leftBoxPointerId = null;

  galleryViewportEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || playerModalEl.classList.contains('active')) return;
    if (e.target.closest('.card-action-btn') || e.target.closest('.card-select-btn') || e.target.closest('.batch-action-bar')) return;

    isLeftBoxSelecting = true;
    hasDraggedLeftBox = false;
    boxStartX = e.clientX;
    boxStartY = e.clientY;
    leftBoxPointerId = e.pointerId;
    initialSelectedPathsOnDrag = e.shiftKey ? new Set(selectedPaths) : new Set();
    // 切勿在 pointerdown 過早調用 setPointerCapture，避免劫持單擊事件導致卡片無法觸發 click 開啟大圖
  });

  galleryViewportEl.addEventListener('pointermove', (e) => {
    if (!isLeftBoxSelecting) return;
    if ((e.buttons & 1) === 0) {
      endLeftBoxSelect(e);
      return;
    }

    const dx = e.clientX - boxStartX;
    const dy = e.clientY - boxStartY;

    if (!hasDraggedLeftBox && Math.hypot(dx, dy) > 5) {
      hasDraggedLeftBox = true;
      selectionMarqueeEl.style.display = 'block';
      try {
        galleryViewportEl.setPointerCapture(e.pointerId);
      } catch (_) {}
    }

    if (hasDraggedLeftBox) {
      const vpRect = galleryViewportEl.getBoundingClientRect();
      const leftScreen = Math.min(boxStartX, e.clientX);
      const topScreen = Math.min(boxStartY, e.clientY);
      const width = Math.abs(dx);
      const height = Math.abs(dy);

      const relLeft = leftScreen - vpRect.left + galleryViewportEl.scrollLeft;
      const relTop = topScreen - vpRect.top + galleryViewportEl.scrollTop;

      selectionMarqueeEl.style.left = `${relLeft}px`;
      selectionMarqueeEl.style.top = `${relTop}px`;
      selectionMarqueeEl.style.width = `${width}px`;
      selectionMarqueeEl.style.height = `${height}px`;

      const newSelection = new Set(initialSelectedPathsOnDrag);
      const cardEls = galleryGridEl.querySelectorAll('.video-card');
      cardEls.forEach((card) => {
        const cardRect = card.getBoundingClientRect();
        const intersects = !(
          cardRect.right < leftScreen ||
          cardRect.left > leftScreen + width ||
          cardRect.bottom < topScreen ||
          cardRect.top > topScreen + height
        );
        const p = card.dataset.path;
        if (p) {
          if (intersects) {
            newSelection.add(p);
          } else if (!e.shiftKey) {
            newSelection.delete(p);
          }
        }
      });

      selectedPaths.clear();
      newSelection.forEach(p => selectedPaths.add(p));
      updateSelectionUI();
    }
  });

  function endLeftBoxSelect(e) {
    if (!isLeftBoxSelecting) return;
    isLeftBoxSelecting = false;

    if (hasDraggedLeftBox) {
      if (leftBoxPointerId !== null) {
        try {
          galleryViewportEl.releasePointerCapture(leftBoxPointerId);
        } catch (_) {}
      }
      selectionMarqueeEl.style.display = 'none';
      setTimeout(() => {
        hasDraggedLeftBox = false;
      }, 80);
    } else {
      // 點擊行為：若點擊畫廊空白處且未按 Shift，清空選取
      if (!e.shiftKey && !e.target.closest('.video-card') && !e.target.closest('.batch-action-bar')) {
        clearSelection();
      }
    }
    leftBoxPointerId = null;
  }

  galleryViewportEl.addEventListener('pointerup', endLeftBoxSelect);
  galleryViewportEl.addEventListener('pointercancel', endLeftBoxSelect);

  // ==============================================================================
  // 21. 批量操作列事件
  // ==============================================================================
  batchCopyPathsBtnEl.addEventListener('click', () => {
    if (selectedPaths.size === 0) return;
    const text = Array.from(selectedPaths).join('\n');
    copyToClipboard(text);
    showToast(I18nModule.t('toast_batch_copy_success', { count: selectedPaths.size }), 'success');
  });

  batchClearBtnEl.addEventListener('click', clearSelection);

  batchDeleteBtnEl.addEventListener('click', () => {
    if (selectedPaths.size === 0) return;
    if (vscode) {
      vscode.postMessage({
        type: 'deleteFiles',
        filePaths: Array.from(selectedPaths)
      });
    }
  });

  // ==============================================================================
  // 22. 工具列事件綁定
  // ==============================================================================
  searchInputEl.addEventListener('input', () => {
    applyFilterAndSort();
    saveUiState();
  });

  searchClearEl.addEventListener('click', () => {
    searchInputEl.value = '';
    applyFilterAndSort();
    saveUiState();
    searchInputEl.focus();
  });

  sortSelectEl.addEventListener('change', () => {
    applyFilterAndSort();
    saveUiState();
  });

  sizeSliderEl.addEventListener('input', () => {
    applyThumbnailSize(sizeSliderEl.value, false);
  });

  sizeSliderEl.addEventListener('change', () => {
    applyThumbnailSize(sizeSliderEl.value, true);
  });

  // Ctrl + 滾輪 快速調整縮圖大小
  window.addEventListener('wheel', (e) => {
    if (playerModalEl.classList.contains('active')) {
      // 播放器內滾輪：調整音量
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      setVolume(playerVideoEl.volume + delta);
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const step = 20;
      const curSize = parseInt(sizeSliderEl.value, 10) || 280;
      const delta = e.deltaY < 0 ? step : -step;
      applyThumbnailSize(curSize + delta, false);
    }
  }, { passive: false });

  recursiveBtnEl.addEventListener('click', () => {
    isRecursive = !isRecursive;
    updateRecursiveButton();
    saveUiState();
    if (vscode) {
      vscode.postMessage({ type: 'toggleRecursive', recursive: isRecursive });
    }
  });

  refreshBtnEl.addEventListener('click', () => {
    if (vscode) {
      vscode.postMessage({ type: 'refresh' });
    }
  });

  revealFolderBtnEl.addEventListener('click', () => {
    if (vscode && currentFolder) {
      vscode.postMessage({ type: 'revealFolder', folderPath: currentFolder });
    }
  });

  if (thumbToggleBtnEl) {
    thumbToggleBtnEl.addEventListener('click', () => {
      toggleThumbnails();
    });
  }

  // ==============================================================================
  // 23. 全域鍵盤快捷鍵
  // ==============================================================================
  window.addEventListener('keydown', (e) => {
    // 播放器視窗開啟時
    if (playerModalEl.classList.contains('active')) {
      if (e.key === 'Escape') {
        closePlayer();
        e.preventDefault();
      } else if (e.key === ' ' || e.code === 'Space') {
        togglePlayPause();
        e.preventDefault();
      } else if (e.key === 'ArrowLeft') {
        seekDelta(-5);
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        seekDelta(5);
        e.preventDefault();
      } else if (e.key === 'j' || e.key === 'J') {
        seekDelta(-5);
        e.preventDefault();
      } else if (e.key === 'l' || e.key === 'L') {
        seekDelta(5);
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        setVolume(playerVideoEl.volume + 0.1);
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        setVolume(playerVideoEl.volume - 0.1);
        e.preventDefault();
      } else if (e.key === 'm' || e.key === 'M') {
        volumeBtnEl.click();
        e.preventDefault();
      } else if (e.key === 'h' || e.key === 'H') {
        if (playerModalEl.classList.contains('is-idle')) {
          hideCooldownUntil = 0;
          wakeUpOriginX = null;
          wakeUpOriginY = null;
          playerModalEl.classList.remove('is-idle');
          resetIdleTimer();
        } else {
          hideControlsImmediately();
        }
        e.preventDefault();
      } else if (e.key === 'o' || e.key === 'O') {
        openCurrentInExternalPlayer();
        e.preventDefault();
      } else if (e.key === '[' || e.key === 'PageUp') {
        prevVideo();
        e.preventDefault();
      } else if (e.key === ']' || e.key === 'PageDown') {
        nextVideo();
        e.preventDefault();
      } else if (e.key === 'c' || e.key === 'C') {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          toggleAutoNext();
          e.preventDefault();
        }
      } else if (e.key === 'r' || e.key === 'R') {
        toggleLoop();
        e.preventDefault();
      } else if (e.key === 's' || e.key === 'S' || e.key === 'Enter') {
        selectAndCloseBtnEl.click();
        e.preventDefault();
      } else if (e.key >= '0' && e.key <= '9') {
        const pct = parseInt(e.key, 10) / 10;
        const dur = playerVideoEl.duration || 0;
        applySeek(dur * pct);
        e.preventDefault();
      }
    } else {
      // 畫廊模式
      if (e.key === 'Escape' && selectedPaths.size > 0) {
        clearSelection();
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        if (filteredVideos.length > 0 && document.activeElement !== searchInputEl) {
          filteredVideos.forEach(v => selectedPaths.add(v.fullPath));
          updateSelectionUI();
          e.preventDefault();
        }
      } else if (e.key === 'F5') {
        refreshBtnEl.click();
        e.preventDefault();
      } else if (e.key === 't' || e.key === 'T') {
        if (document.activeElement !== searchInputEl) {
          toggleThumbnails();
          e.preventDefault();
        }
      } else if (e.key === 'o' || e.key === 'O') {
        if (selectedPaths.size === 1 && document.activeElement !== searchInputEl) {
          const path = Array.from(selectedPaths)[0];
          if (!playerVideoEl.paused) {
            playerVideoEl.pause();
          }
          if (vscode) {
            vscode.postMessage({ type: 'openWithDefaultApp', filePath: path });
            showToast(I18nModule.t('toast_open_selected_external'), 'info');
          }
          e.preventDefault();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        searchInputEl.focus();
        searchInputEl.select();
        e.preventDefault();
      }
    }
  });

  // ==============================================================================
  // 24. 後端通訊處理 (IPC Message Handler)
  // ==============================================================================
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) return;

    switch (message.type) {
      case 'initData':
        currentFolder = message.folderPath || '';
        folderNameStr = message.folderName || '';
        allVideos = message.videos || [];
        isRecursive = !!message.recursive;

        const currentSavedState = vscode ? vscode.getState() : null;
        if (!currentSavedState || !currentSavedState.thumbSize) {
          const targetThumbSize = message.thumbSize || (function () {
            try { return localStorage.getItem(STORAGE_KEY_THUMB_SIZE); } catch (e) { return null; }
          })();
          if (targetThumbSize) {
            applyThumbnailSize(targetThumbSize, true);
          }
        }

        if (!currentSavedState || typeof currentSavedState.showThumbs !== 'boolean') {
          const targetShowThumbs = typeof message.showThumbs === 'boolean'
            ? message.showThumbs
            : (function () {
                try {
                  const s = localStorage.getItem(STORAGE_KEY_SHOW_THUMBS);
                  return s !== null ? s === 'true' : true;
                } catch (e) { return true; }
              })();
          showThumbs = targetShowThumbs;
          updateThumbToggleButton();
        }

        let initVolume = null;
        let initMuted = null;
        let initLastVolume = null;

        if (currentSavedState && typeof currentSavedState.lastVolume === 'number') {
          initLastVolume = currentSavedState.lastVolume;
        } else if (typeof message.lastVolume === 'number' && !isNaN(message.lastVolume)) {
          initLastVolume = message.lastVolume;
        } else {
          try {
            const llv = localStorage.getItem(STORAGE_KEY_LAST_VOLUME);
            if (llv !== null) initLastVolume = parseFloat(llv);
          } catch (_) {}
        }
        if (typeof initLastVolume === 'number' && !isNaN(initLastVolume) && initLastVolume > 0) {
          lastVolume = Math.round(Math.max(0.05, Math.min(1, initLastVolume)) * 100) / 100;
        }

        if (currentSavedState && typeof currentSavedState.volume === 'number') {
          initVolume = currentSavedState.volume;
        } else if (typeof message.volume === 'number' && !isNaN(message.volume)) {
          initVolume = message.volume;
        } else {
          try {
            const lv = localStorage.getItem(STORAGE_KEY_VOLUME);
            if (lv !== null) initVolume = parseFloat(lv);
          } catch (_) {}
        }

        if (typeof initVolume === 'number' && !isNaN(initVolume)) {
          const clamped = Math.round(Math.max(0, Math.min(1, initVolume)) * 100) / 100;
          volumeSliderEl.value = clamped;
          if (clamped > 0) lastVolume = clamped;
        }

        if (currentSavedState && typeof currentSavedState.muted === 'boolean') {
          initMuted = currentSavedState.muted;
        } else if (typeof message.muted === 'boolean') {
          initMuted = message.muted;
        } else {
          try {
            const lm = localStorage.getItem(STORAGE_KEY_MUTED);
            if (lm !== null) initMuted = lm === 'true';
          } catch (_) {}
        }

        if (typeof initMuted === 'boolean') {
          isMuted = initMuted;
        }
        syncVolumeUI();

        if (typeof message.autoNext === 'boolean') {
          isAutoNext = message.autoNext;
        } else {
          try {
            const savedAuto = localStorage.getItem('antigravity_video_autonext');
            if (savedAuto !== null) isAutoNext = savedAuto === 'true';
          } catch (_) {}
        }
        if (typeof message.loop === 'boolean') {
          isLooping = message.loop;
        } else {
          try {
            const savedLoop = localStorage.getItem('antigravity_video_loop');
            if (savedLoop !== null) isLooping = savedLoop === 'true';
          } catch (_) {}
        }
        updateAutoNextUI();
        updateLoopUI();

        folderNameEl.textContent = folderNameStr;
        folderInfoEl.title = currentFolder;
        videoCountBadgeEl.textContent = I18nModule.t('video_count_badge', { count: allVideos.length });
        updateRecursiveButton();

        selectedPaths.forEach(p => {
          if (!allVideos.some(v => v.fullPath === p)) selectedPaths.delete(p);
        });
        updateSelectionUI();

        applyFilterAndSort();

        // 若開啟時指定了目標檔案 (例如在影片檔案上按右鍵)，自動定位並開啟播放
        if (message.targetFilePath) {
          const targetIdx = filteredVideos.findIndex(v => v.fullPath === message.targetFilePath);
          if (targetIdx >= 0) {
            openPlayer(targetIdx);
          }
        }
        break;

      case 'updateVideos':
        allVideos = message.videos || [];
        videoCountBadgeEl.textContent = I18nModule.t('video_count_badge', { count: allVideos.length });

        selectedPaths.forEach(p => {
          if (!allVideos.some(v => v.fullPath === p)) selectedPaths.delete(p);
        });
        updateSelectionUI();

        applyFilterAndSort();

        if (playerModalEl.classList.contains('active') && currentIndex >= 0) {
          if (currentIndex >= filteredVideos.length) {
            closePlayer();
          } else {
            playerIndexBadgeEl.textContent = `${currentIndex + 1} / ${filteredVideos.length}`;
          }
        }
        showToast(I18nModule.t('toast_refresh_success', { count: allVideos.length }), 'success');
        break;

      case 'toast':
        showToast(message.text, message.level || 'info');
        break;

      case 'openTargetVideo':
        if (message.filePath) {
          const targetIdx = filteredVideos.findIndex(v => v.fullPath === message.filePath);
          if (targetIdx >= 0) {
            openPlayer(targetIdx);
          }
        }
        break;

      case 'localeChanged':
        if (message.locale && (message.locale === 'zh-TW' || message.locale === 'en')) {
          I18nModule.applyLanguage(message.locale, true);
        }
        break;
    }
  });

  // 初始化多國語言模組
  I18nModule.init();

  // 初始化還原 UI 設定
  restoreUiState();

  // 通知後端 Webview 前端已就緒
  if (vscode) {
    vscode.postMessage({ type: 'ready' });
  }
})();
