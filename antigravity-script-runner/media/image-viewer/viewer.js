/**
 * Antigravity IDE - Content Area Image Viewer (內容區圖片檢視器互動核心)
 * 具備游標錨點滑鼠滾輪縮放、指針平移拖曳、雙向 IPC 與狀態保存
 */

(function () {
  // 1. VS Code API 雙軌安全適配
  let vscode = null;
  try {
    if (typeof acquireVsCodeApi === 'function') {
      vscode = acquireVsCodeApi();
    }
  } catch (err) {
    console.log('[Viewer] 獨立瀏覽器除錯環境');
  }

  // 2. 全域狀態
  let allImages = [];
  let filteredImages = [];
  let currentFolder = '';
  let folderNameStr = '';
  let isRecursive = false;

  // 檢視器狀態
  let currentIndex = -1;
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let rotation = 0;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let naturalWidth = 0;
  let naturalHeight = 0;

  // 3. DOM 節點引用
  const folderNameEl = document.getElementById('folderName');
  const folderInfoEl = document.getElementById('folderInfo');
  const imgCountBadgeEl = document.getElementById('imgCountBadge');
  const filterCountBadgeEl = document.getElementById('filterCountBadge');
  const searchInputEl = document.getElementById('searchInput');
  const searchClearEl = document.getElementById('searchClear');
  const sortSelectEl = document.getElementById('sortSelect');
  const sizeSliderEl = document.getElementById('sizeSlider');
  const recursiveBtnEl = document.getElementById('recursiveBtn');
  const refreshBtnEl = document.getElementById('refreshBtn');
  const revealFolderBtnEl = document.getElementById('revealFolderBtn');
  const galleryGridEl = document.getElementById('galleryGrid');
  const galleryViewportEl = document.getElementById('galleryViewport');
  const emptyStateEl = document.getElementById('emptyState');
  const emptyTitleEl = document.getElementById('emptyTitle');
  const emptyDescEl = document.getElementById('emptyDesc');

  // 批量操作與框選 DOM
  const selectionMarqueeEl = document.getElementById('selectionMarquee');
  const batchActionBarEl = document.getElementById('batchActionBar');
  const batchSelectedCountEl = document.getElementById('batchSelectedCount');
  const batchCopyPathsBtnEl = document.getElementById('batchCopyPathsBtn');
  const batchRotateCwBtnEl = document.getElementById('batchRotateCwBtn');
  const batchRotateCcwBtnEl = document.getElementById('batchRotateCcwBtn');
  const batchDeleteBtnEl = document.getElementById('batchDeleteBtn');
  const batchClearBtnEl = document.getElementById('batchClearBtn');

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
      updateSelectionUI();

      if (folderNameStr) {
        folderNameEl.textContent = folderNameStr;
      } else {
        folderNameEl.textContent = this.t('loading');
      }
      if (currentFolder) {
        folderInfoEl.title = currentFolder;
      }

      if (allImages.length > 0) {
        imgCountBadgeEl.textContent = this.t('img_count_badge', { count: allImages.length });
        if (filteredImages.length !== allImages.length) {
          filterCountBadgeEl.textContent = this.t('filter_count_badge', { count: filteredImages.length });
        }
      }
      renderGallery();
    }
  };

  // 選取狀態集合 (儲存 fullPath)
  const selectedPaths = new Set();

  function updateSelectionUI() {
    const cardEls = galleryGridEl.querySelectorAll('.image-card');
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

  // Lightbox DOM
  const lightboxModalEl = document.getElementById('lightboxModal');
  const lightboxCanvasEl = document.getElementById('lightboxCanvas');
  const lightboxImgWrapperEl = document.getElementById('lightboxImgWrapper');
  const lightboxImgEl = document.getElementById('lightboxImg');
  const lightboxTitleEl = document.getElementById('lightboxTitle');
  const lightboxMetaEl = document.getElementById('lightboxMeta');
  const lightboxIndexBadgeEl = document.getElementById('lightboxIndexBadge');
  const lightboxZoomBadgeEl = document.getElementById('lightboxZoomBadge');
  const lightboxCloseBtnEl = document.getElementById('lightboxCloseBtn');
  const prevBtnEl = document.getElementById('prevBtn');
  const nextBtnEl = document.getElementById('nextBtn');
  const zoomInBtnEl = document.getElementById('zoomInBtn');
  const zoomOutBtnEl = document.getElementById('zoomOutBtn');
  const zoomFitBtnEl = document.getElementById('zoomFitBtn');
  const zoomActualBtnEl = document.getElementById('zoomActualBtn');
  const selectAndCloseBtnEl = document.getElementById('selectAndCloseBtn');
  const lightboxDeleteBtnEl = document.getElementById('lightboxDeleteBtn');
  const toastContainerEl = document.getElementById('toastContainer');

  // 4. Toast 通知系統 (已依需求移除彈窗訊息，杜絕遮擋畫面內容)
  function showToast(message, type = 'info') {
    // 彈窗訊息已停用
  }

  // 5. 狀態持久化 (State Persistence)
  const STORAGE_KEY_THUMB_SIZE = 'antigravity_image_viewer_thumb_size';

  function saveUiState() {
    if (!vscode) return;
    vscode.setState({
      thumbSize: sizeSliderEl.value,
      sortBy: sortSelectEl.value,
      filterText: searchInputEl.value,
      recursive: isRecursive
    });
  }

  function restoreUiState() {
    // 優先讀取本地跨分頁/跨資料夾持久化快取
    let savedLocalThumb = null;
    try {
      savedLocalThumb = localStorage.getItem(STORAGE_KEY_THUMB_SIZE);
    } catch (e) {}

    if (savedLocalThumb) {
      sizeSliderEl.value = savedLocalThumb;
      document.documentElement.style.setProperty('--thumb-size', `${savedLocalThumb}px`);
    }

    if (!vscode) return;
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

  // 6. 圖片排序與篩選邏輯
  function applyFilterAndSort() {
    const query = searchInputEl.value.trim().toLowerCase();
    const sortBy = sortSelectEl.value;

    // 篩選
    if (!query) {
      filteredImages = [...allImages];
      filterCountBadgeEl.style.display = 'none';
      searchClearEl.style.display = 'none';
    } else {
      filteredImages = allImages.filter(img =>
        img.fileName.toLowerCase().includes(query) ||
        img.relativePath.toLowerCase().includes(query)
      );
      filterCountBadgeEl.style.display = 'inline-flex';
      filterCountBadgeEl.textContent = I18nModule.t('filter_count_badge', { count: filteredImages.length });
      searchClearEl.style.display = 'block';
    }

    // 排序
    filteredImages.sort((a, b) => {
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

  // 7. 渲染畫廊縮圖網格卡片工廠與 RAF 漸進式分幀渲染引擎
  let currentRenderToken = 0;

  function createImageCard(img, idx) {
    const card = document.createElement('div');
    card.className = 'image-card';
    card.dataset.path = img.fullPath;
    if (selectedPaths.has(img.fullPath)) {
      card.classList.add('is-selected');
    }
    card.title = `${img.fileName} (${img.sizeFormatted})\n${I18nModule.t('card_path_prefix')}${img.relativePath}`;

    // 縮圖與懸浮動作
    card.innerHTML = `
      <div class="card-thumb-wrapper">
        <button class="card-select-btn" title="${I18nModule.t('card_select_title')}" data-path="${img.fullPath}">
          <svg class="check-icon" viewBox="0 0 24 24" fill="none">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </button>
        <img class="card-thumb" src="${img.uri}" loading="lazy" alt="${img.fileName}" />
        <span class="card-ext-badge" data-ext="${(img.ext || '').toLowerCase()}">${(img.ext || '').toUpperCase()}</span>
        <div class="card-actions">
          <button class="card-action-btn copy-btn" title="${I18nModule.t('card_copy_path_title')}" data-index="${idx}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>
          </button>
          <button class="card-action-btn reveal-btn" title="${I18nModule.t('card_reveal_title')}" data-index="${idx}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          </button>
        </div>
      </div>
      <div class="card-footer">
        <div class="card-title">${img.fileName}</div>
        <div class="card-meta">
          <span class="card-dim" id="dim-${idx}">...</span>
          <span class="card-size">${img.sizeFormatted}</span>
        </div>
      </div>
    `;

    // 點擊勾選圓圈
    const selectBtn = card.querySelector('.card-select-btn');
    selectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCardSelection(img.fullPath);
    });

    // 點擊卡片開啟大圖或進行選取
    card.addEventListener('click', (e) => {
      if (hasDraggedLeftBox) return;
      if (e.target.closest('.card-action-btn') || e.target.closest('.card-select-btn')) return;

      // Shift + 左鍵：加選/反選
      if (e.shiftKey) {
        e.preventDefault();
        toggleCardSelection(img.fullPath);
        return;
      }

      // 若已有選取項目，單擊卡片視為選取切換
      if (selectedPaths.size > 0) {
        toggleCardSelection(img.fullPath);
        return;
      }

      // 一般無選取時單擊開啟大圖
      openLightbox(idx);
    });

    // 雙擊卡片永遠開啟大圖 (即使已有選取狀態)
    card.addEventListener('dblclick', (e) => {
      if (e.target.closest('.card-action-btn') || e.target.closest('.card-select-btn')) return;
      openLightbox(idx);
    });

    // 快速動作按鈕事件
    const copyBtn = card.querySelector('.copy-btn');
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(img.fullPath);
      showToast(I18nModule.t('toast_path_copied', { name: img.fileName }), 'success');
    });

    const revealBtn = card.querySelector('.reveal-btn');
    revealBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (vscode) {
        vscode.postMessage({ type: 'revealFile', filePath: img.fullPath });
      }
    });

    // 讀取圖片原始長寬並更新標籤
    const imgEl = card.querySelector('.card-thumb');
    imgEl.addEventListener('load', () => {
      const dimEl = card.querySelector(`#dim-${idx}`);
      if (dimEl) {
        dimEl.textContent = `${imgEl.naturalWidth}×${imgEl.naturalHeight}`;
      }
    });

    return card;
  }

  // 7.1 渲染畫廊縮圖網格（首屏 36 張瞬開 + RAF 漸進式分批掛載）
  function renderGallery() {
    galleryGridEl.innerHTML = '';

    if (filteredImages.length === 0) {
      emptyStateEl.style.display = 'flex';
      galleryGridEl.style.display = 'none';
      if (allImages.length === 0) {
        emptyTitleEl.textContent = I18nModule.t('empty_folder_title');
        emptyDescEl.textContent = I18nModule.t('empty_folder_desc');
      } else {
        emptyTitleEl.textContent = I18nModule.t('empty_filter_title');
        emptyDescEl.textContent = I18nModule.t('empty_filter_desc', { query: searchInputEl.value });
      }
      return;
    }

    emptyStateEl.style.display = 'none';
    galleryGridEl.style.display = 'grid';

    const token = ++currentRenderToken;
    const CHUNK_SIZE = 36;
    const initialBatch = filteredImages.slice(0, CHUNK_SIZE);

    // 1. 瞬間渲染第一屏（36 張以內），保證 16ms 內即刻呈現介面
    const fragment = document.createDocumentFragment();
    initialBatch.forEach((img, idx) => {
      fragment.appendChild(createImageCard(img, idx));
    });
    galleryGridEl.appendChild(fragment);

    // 2. 其餘卡片透過 requestAnimationFrame 漸進式分批掛載，徹底消除 DOM 阻塞
    if (filteredImages.length > CHUNK_SIZE) {
      let nextIndex = CHUNK_SIZE;

      function renderNextChunk() {
        if (token !== currentRenderToken) return;
        if (nextIndex >= filteredImages.length) return;

        const end = Math.min(nextIndex + CHUNK_SIZE, filteredImages.length);
        const chunkFrag = document.createDocumentFragment();
        for (let i = nextIndex; i < end; i++) {
          chunkFrag.appendChild(createImageCard(filteredImages[i], i));
        }
        galleryGridEl.appendChild(chunkFrag);
        nextIndex = end;

        if (nextIndex < filteredImages.length) {
          requestAnimationFrame(renderNextChunk);
        }
      }

      requestAnimationFrame(renderNextChunk);
    }
  }

  // 8. 複製文字至剪貼簿
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
  // 9. 高精度大圖檢視器 (Zoom & Pan 核心引擎)
  // ==============================================================================

  function updateTransform(animate = false) {
    lightboxImgWrapperEl.style.transition = animate ? 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)' : 'none';
    lightboxImgWrapperEl.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    lightboxImgEl.style.transform = `rotate(${rotation}deg)`;
    lightboxZoomBadgeEl.textContent = `${Math.round(scale * 100)}%`;
  }

  /**
   * 計算並將圖片以最適大小置中於視窗 (Fit to Screen)
   */
  function fitToScreen(animate = true) {
    if (naturalWidth <= 0 || naturalHeight <= 0) {
      naturalWidth = lightboxImgEl.naturalWidth;
      naturalHeight = lightboxImgEl.naturalHeight;
    }
    if (naturalWidth <= 0 || naturalHeight <= 0) return;

    const viewportW = lightboxCanvasEl.clientWidth;
    const viewportH = lightboxCanvasEl.clientHeight;
    if (viewportW <= 0 || viewportH <= 0) return;

    // 考量旋轉時的長寬置換
    const isRotated90 = (rotation % 180 !== 0);
    const effectiveW = isRotated90 ? naturalHeight : naturalWidth;
    const effectiveH = isRotated90 ? naturalWidth : naturalHeight;

    // 考量四周安全留白與頂部工具列 (48px)
    const marginX = 48;
    const marginY = 64;
    const availW = Math.max(viewportW - marginX, 60);
    const availH = Math.max(viewportH - marginY, 60);

    const fitScale = Math.min(availW / effectiveW, availH / effectiveH, 1.0);
    scale = fitScale;

    // 置中座標計算 (相對於畫布原點 0,0，垂直考量頂部工具列留白以求視覺平衡)
    const topBarHeight = 48;
    panX = (viewportW - naturalWidth * scale) / 2;
    panY = (viewportH - naturalHeight * scale) / 2 + (topBarHeight / 2);

    updateTransform(animate);
  }

  /**
   * 放大至 1:1 原始解析度
   */
  function zoomActual(animate = true) {
    if (naturalWidth <= 0 || naturalHeight <= 0) {
      naturalWidth = lightboxImgEl.naturalWidth;
      naturalHeight = lightboxImgEl.naturalHeight;
    }
    if (naturalWidth <= 0 || naturalHeight <= 0) return;
    const viewportW = lightboxCanvasEl.clientWidth;
    const viewportH = lightboxCanvasEl.clientHeight;
    if (viewportW <= 0 || viewportH <= 0) return;

    scale = 1.0;
    const topBarHeight = 48;
    panX = (viewportW - naturalWidth * scale) / 2;
    panY = (viewportH - naturalHeight * scale) / 2 + (topBarHeight / 2);

    updateTransform(animate);
  }

  /**
   * 開啟指定索引的大圖
   */
  function openLightbox(index) {
    if (index < 0 || index >= filteredImages.length) return;
    currentIndex = index;
    const imgData = filteredImages[currentIndex];

    lightboxTitleEl.textContent = imgData.fileName;
    lightboxTitleEl.title = imgData.fullPath;
    lightboxIndexBadgeEl.textContent = `${currentIndex + 1} / ${filteredImages.length}`;
    lightboxMetaEl.textContent = `${I18nModule.t('loading')} • ${imgData.sizeFormatted}`;

    // 重置旋轉角度
    rotation = 0;
    lightboxModalEl.classList.add('active');

    // 確保放大圖容器獲得焦點，能直接接收鍵盤快捷鍵 (如 Delete, 左右鍵, Esc)
    window.focus();
    if (typeof lightboxModalEl.focus === 'function') {
      lightboxModalEl.focus();
    }

    // 導航按鈕狀態
    prevBtnEl.style.opacity = currentIndex > 0 ? '1' : '0.3';
    nextBtnEl.style.opacity = currentIndex < filteredImages.length - 1 ? '1' : '0.3';

    function onImageReady() {
      naturalWidth = lightboxImgEl.naturalWidth;
      naturalHeight = lightboxImgEl.naturalHeight;
      if (naturalWidth > 0 && naturalHeight > 0) {
        lightboxMetaEl.textContent = `${naturalWidth} × ${naturalHeight} px • ${imgData.sizeFormatted}`;
        lightboxImgWrapperEl.style.width = `${naturalWidth}px`;
        lightboxImgWrapperEl.style.height = `${naturalHeight}px`;
        requestAnimationFrame(() => {
          fitToScreen(false);
        });
      }
    }

    lightboxImgEl.onload = onImageReady;
    lightboxImgEl.src = imgData.uri;
    if (lightboxImgEl.complete && lightboxImgEl.naturalWidth > 0) {
      onImageReady();
    }
  }

  function closeLightbox() {
    lightboxModalEl.classList.remove('active');
    currentIndex = -1;
    if (isDragging) {
      isDragging = false;
      lightboxCanvasEl.classList.remove('dragging');
    }
  }

  function prevImage() {
    if (currentIndex > 0) {
      openLightbox(currentIndex - 1);
    } else {
      showToast(I18nModule.t('lightbox_first_image'), 'info');
    }
  }

  function nextImage() {
    if (currentIndex < filteredImages.length - 1) {
      openLightbox(currentIndex + 1);
    } else {
      showToast(I18nModule.t('lightbox_last_image'), 'info');
    }
  }

  /**
   * 依檔案實體絕對路徑在清單中比對並自動開啟 Lightbox 大圖檢視
   */
  function openTargetImageByPath(targetPath) {
    if (!targetPath) return;
    const normTarget = targetPath.replace(/\\/g, '/').toLowerCase();
    const targetIdx = filteredImages.findIndex(img => img.fullPath.replace(/\\/g, '/').toLowerCase() === normTarget);
    if (targetIdx !== -1) {
      setTimeout(() => {
        openLightbox(targetIdx);
        const cardEl = galleryGridEl.querySelector(`.image-card[data-path="${CSS.escape(filteredImages[targetIdx].fullPath)}"]`);
        if (cardEl) {
          cardEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }, 50);
    }
  }

  // 10. 游標錨點滾輪縮放核心 (Cursor-Anchored Zoom)
  lightboxCanvasEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!lightboxModalEl.classList.contains('active')) return;
    if (naturalWidth <= 0 || naturalHeight <= 0) return;

    // 縮放係數 (向內滾動放大 1.15 倍，向外縮小)
    const zoomFactor = e.deltaY < 0 ? 1.15 : (1 / 1.15);
    const newScale = Math.min(Math.max(scale * zoomFactor, 0.05), 40.0);

    // 取得游標相對於視窗的座標
    const rect = lightboxCanvasEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // 以游標為固定錨點補償平移量 (Matrix Anchored Translation)
    panX = mouseX - (mouseX - panX) * (newScale / scale);
    panY = mouseY - (mouseY - panY) * (newScale / scale);
    scale = newScale;

    updateTransform(false);
  }, { passive: false });

  // 11. 滑鼠左鍵拖曳平移 (Pointer Events Dragging)
  lightboxCanvasEl.addEventListener('pointerdown', (e) => {
    // 僅響應滑鼠左鍵
    if (e.button !== 0) return;
    if (!lightboxModalEl.classList.contains('active')) return;

    isDragging = true;
    startX = e.clientX - panX;
    startY = e.clientY - panY;
    lightboxCanvasEl.setPointerCapture(e.pointerId);
    lightboxCanvasEl.classList.add('dragging');
  });

  lightboxCanvasEl.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    updateTransform(false);
  });

  const endDrag = (e) => {
    if (!isDragging) return;
    isDragging = false;
    try {
      lightboxCanvasEl.releasePointerCapture(e.pointerId);
    } catch (_) {}
    lightboxCanvasEl.classList.remove('dragging');
  };

  lightboxCanvasEl.addEventListener('pointerup', endDrag);
  lightboxCanvasEl.addEventListener('pointercancel', endDrag);

  // 12. 雙擊畫布切換 1:1 與最適大小
  lightboxCanvasEl.addEventListener('dblclick', (e) => {
    if (e.target.closest('.lightbox-header') || e.target.closest('.nav-arrow')) return;
    if (Math.abs(scale - 1.0) < 0.1) {
      fitToScreen(true);
    } else {
      zoomActual(true);
    }
  });

  // ==============================================================================
  // 13. 工具列互動事件綁定
  // ==============================================================================

  // 搜尋即時篩選
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

  // 排序下拉
  sortSelectEl.addEventListener('change', () => {
    applyFilterAndSort();
    saveUiState();
  });

  // 縮圖尺寸滑桿與滾輪縮放核心（具備即時 CSS 響應、localStorage 本地快取與後端全域持久化）
  let saveThumbTimer = null;
  function persistThumbSize(sizeVal) {
    const numericSize = parseInt(sizeVal, 10);
    if (!numericSize || isNaN(numericSize)) return;

    try {
      localStorage.setItem(STORAGE_KEY_THUMB_SIZE, String(numericSize));
    } catch (e) {}

    if (vscode) {
      vscode.postMessage({ type: 'saveThumbSize', size: numericSize });
    }
  }

  function applyThumbnailSize(sizeVal, immediate = false) {
    const minVal = parseInt(sizeSliderEl.min, 10) || 110;
    const maxVal = parseInt(sizeSliderEl.max, 10) || 360;
    const clamped = Math.min(maxVal, Math.max(minVal, parseInt(sizeVal, 10) || 180));

    sizeSliderEl.value = clamped;
    document.documentElement.style.setProperty('--thumb-size', `${clamped}px`);
    saveUiState();

    try {
      localStorage.setItem(STORAGE_KEY_THUMB_SIZE, String(clamped));
    } catch (e) {}

    clearTimeout(saveThumbTimer);
    if (immediate) {
      persistThumbSize(clamped);
    } else {
      saveThumbTimer = setTimeout(() => {
        persistThumbSize(clamped);
      }, 150);
    }
  }

  sizeSliderEl.addEventListener('input', () => {
    applyThumbnailSize(sizeSliderEl.value, false);
  });

  sizeSliderEl.addEventListener('change', () => {
    applyThumbnailSize(sizeSliderEl.value, true);
  });

  // 壓住 Ctrl + 滑鼠滾輪 快速縮放縮圖尺寸 (支援全域畫廊滾動，自動阻斷瀏覽器全頁面放大)
  window.addEventListener('wheel', (e) => {
    // 若在大圖檢視 (Lightbox) 開啟狀態，由 Lightbox Canvas 自身的 wheel 事件處理大圖平移縮放
    if (lightboxModalEl.classList.contains('active')) return;

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();

      const step = 15;
      const curSize = parseInt(sizeSliderEl.value, 10) || 180;
      // 滾輪向上 (deltaY < 0) 放大縮圖，滾輪向下 (deltaY > 0) 縮小縮圖
      const delta = e.deltaY < 0 ? step : -step;
      applyThumbnailSize(curSize + delta, false);
    }
  }, { passive: false });

  // 子資料夾搜尋切換
  recursiveBtnEl.addEventListener('click', () => {
    isRecursive = !isRecursive;
    updateRecursiveButton();
    saveUiState();
    if (vscode) {
      vscode.postMessage({ type: 'toggleRecursive', recursive: isRecursive });
    }
  });

  // 重新整理
  refreshBtnEl.addEventListener('click', () => {
    if (vscode) {
      vscode.postMessage({ type: 'refresh' });
    }
  });

  // 開啟系統資料夾
  revealFolderBtnEl.addEventListener('click', () => {
    if (vscode && currentFolder) {
      vscode.postMessage({ type: 'revealFolder', folderPath: currentFolder });
    }
  });

  // ==============================================================================
  // 13.5 畫廊圖片列表 - 壓住右鍵拖曳滾動 (Right-Click Drag to Scroll)
  // 右鍵專注於極速滑動瀏覽；全面阻斷無效且易引發狀態錯亂的原生「剪下、貼上」選單
  // ==============================================================================
  let isRightDragging = false;
  let rightDragStartY = 0;
  let rightDragStartX = 0;
  let rightDragStartScrollTop = 0;
  let rightDragStartScrollLeft = 0;
  let hasRightDragged = false;
  let rightDragPointerId = null;

  // 滾動靈敏倍率：原本 1.5x 的 3 倍速度（4.5x），提供超高效率滑動手感
  const RIGHT_DRAG_SPEED = 4.5;

  galleryViewportEl.addEventListener('pointerdown', (e) => {
    // 僅響應右鍵 (button === 2) 且非大圖 Lightbox 模式
    if (e.button !== 2 || lightboxModalEl.classList.contains('active')) return;

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
      endRightDrag(e);
      return;
    }

    const deltaY = e.clientY - rightDragStartY;
    const deltaX = e.clientX - rightDragStartX;

    if (!hasRightDragged && (Math.abs(deltaY) > 2 || Math.abs(deltaX) > 2)) {
      hasRightDragged = true;
      galleryViewportEl.classList.add('is-right-dragging');
      document.body.classList.add('is-right-dragging');
    }

    if (hasRightDragged) {
      // 抓手手勢模式：往上推 -> 畫面往下滾 (scrollTop 增加)；往下拉 -> 畫面往上捲 (scrollTop 減少)
      galleryViewportEl.scrollTop = rightDragStartScrollTop - deltaY * RIGHT_DRAG_SPEED;
      if (galleryViewportEl.scrollWidth > galleryViewportEl.clientWidth) {
        galleryViewportEl.scrollLeft = rightDragStartScrollLeft - deltaX * RIGHT_DRAG_SPEED;
      }
    }
  });

  const endRightDrag = (e) => {
    if (!isRightDragging) return;
    isRightDragging = false;
    hasRightDragged = false;

    if (rightDragPointerId !== null) {
      try {
        galleryViewportEl.releasePointerCapture(rightDragPointerId);
      } catch (_) {}
      rightDragPointerId = null;
    }

    galleryViewportEl.classList.remove('is-right-dragging');
    document.body.classList.remove('is-right-dragging');
  };

  galleryViewportEl.addEventListener('pointerup', (e) => {
    if (e.button === 2) {
      endRightDrag(e);
    }
  });
  galleryViewportEl.addEventListener('pointercancel', endRightDrag);

  // 全域阻斷看圖區的原生右鍵選單（杜絕無效「剪下、貼上」奪取焦點導致介面異常）
  // 僅在搜尋輸入框內保留右鍵選單以利貼上關鍵字；若在大圖檢視模式則退出大圖（如同 Esc）
  document.addEventListener('contextmenu', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    e.preventDefault();
    if (lightboxModalEl.classList.contains('active')) {
      closeLightbox();
    }
  });

  // ==============================================================================
  // 13.6 畫廊圖片列表 - 滑鼠左鍵拖曳框選與 Shift 加選 (Marquee Box Selection)
  // ==============================================================================
  let isLeftBoxSelecting = false;
  let hasDraggedLeftBox = false;
  let boxStartX = 0;
  let boxStartY = 0;
  let initialSelectedPathsOnDrag = new Set();
  let leftBoxPointerId = null;

  galleryViewportEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || lightboxModalEl.classList.contains('active')) return;
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
      const cardEls = galleryGridEl.querySelectorAll('.image-card');
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
      if (!e.shiftKey && !e.target.closest('.image-card') && !e.target.closest('.batch-action-bar')) {
        clearSelection();
      }
    }
    leftBoxPointerId = null;
  }

  galleryViewportEl.addEventListener('pointerup', endLeftBoxSelect);
  galleryViewportEl.addEventListener('pointercancel', endLeftBoxSelect);

  // ==============================================================================
  // 13.7 批量操作工具列邏輯 (Batch Action Dock Logic)
  // ==============================================================================

  // 1. 複製路徑名稱列表 (Format B: 純絕對路徑清單，每行一個路徑)
  batchCopyPathsBtnEl.addEventListener('click', () => {
    if (selectedPaths.size === 0) return;
    const text = Array.from(selectedPaths).join('\n');
    copyToClipboard(text);
    showToast(I18nModule.t('toast_batch_copied', { count: selectedPaths.size }), 'success');
  });

  // 2. 取消所有選取
  batchClearBtnEl.addEventListener('click', () => {
    clearSelection();
  });

  // 3. 刪除檔案 (安全移入系統資源回收筒)
  batchDeleteBtnEl.addEventListener('click', () => {
    if (selectedPaths.size === 0) return;
    if (vscode) {
      vscode.postMessage({
        type: 'deleteFiles',
        filePaths: Array.from(selectedPaths)
      });
    }
  });

  // 4. 90 度雙向旋轉 (HTML5 Canvas 變換後送往後端覆蓋檔案)
  const ROTATABLE_EXTS = new Set(['jpg', 'jpeg', 'jfif', 'png', 'webp', 'bmp']);

  function rotateImageViaCanvas(srcUri, ext, angleDeg) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const is90 = Math.abs(angleDeg) === 90 || Math.abs(angleDeg) === 270;
          canvas.width = is90 ? img.naturalHeight : img.naturalWidth;
          canvas.height = is90 ? img.naturalWidth : img.naturalHeight;

          const ctx = canvas.getContext('2d');
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate((angleDeg * Math.PI) / 180);
          ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

          let mime = 'image/png';
          const lowerExt = (ext || '').toLowerCase().replace(/^\./, '');
          if (lowerExt === 'jpg' || lowerExt === 'jpeg' || lowerExt === 'jfif') {
            mime = 'image/jpeg';
          } else if (lowerExt === 'webp') {
            mime = 'image/webp';
          } else if (lowerExt === 'bmp') {
            mime = 'image/bmp';
          }

          const dataUrl = canvas.toDataURL(mime, 0.95);
          const base64 = dataUrl.split(',')[1];
          resolve(base64);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('圖片載入失敗，無法旋轉'));
      img.src = srcUri;
    });
  }

  async function rotateSelectedImages(angleDeg) {
    if (selectedPaths.size === 0) return;
    const targets = Array.from(selectedPaths);
    const total = targets.length;

    batchRotateCwBtnEl.disabled = true;
    batchRotateCcwBtnEl.disabled = true;
    showToast(I18nModule.t('toast_rotating_prep', { count: total }), 'info');

    const updates = [];
    let skippedCount = 0;

    for (let i = 0; i < total; i++) {
      const p = targets[i];
      const imgObj = allImages.find(img => img.fullPath === p);
      if (!imgObj) continue;

      const cleanExt = (imgObj.ext || '').toLowerCase().replace(/^\./, '');
      if (!ROTATABLE_EXTS.has(cleanExt)) {
        skippedCount++;
        continue;
      }

      showToast(I18nModule.t('toast_rotating_progress', { current: i + 1, total, name: imgObj.fileName }), 'info');

      try {
        const base64Data = await rotateImageViaCanvas(imgObj.uri, imgObj.ext, angleDeg);
        updates.push({
          fullPath: imgObj.fullPath,
          base64Data
        });
      } catch (err) {
        console.error(`旋轉失敗: ${imgObj.fileName}`, err);
      }
    }

    batchRotateCwBtnEl.disabled = false;
    batchRotateCcwBtnEl.disabled = false;

    if (updates.length > 0 && vscode) {
      if (skippedCount > 0) {
        showToast(I18nModule.t('toast_rotate_saving', { count: updates.length, skipped: skippedCount }), 'info');
      }
      vscode.postMessage({
        type: 'saveRotatedImages',
        updates
      });
    } else {
      if (skippedCount > 0) {
        showToast(I18nModule.t('toast_rotate_not_supported'), 'warn');
      } else {
        showToast(I18nModule.t('toast_rotate_failed'), 'warn');
      }
    }
  }

  batchRotateCwBtnEl.addEventListener('click', () => {
    rotateSelectedImages(90);
  });

  batchRotateCcwBtnEl.addEventListener('click', () => {
    rotateSelectedImages(-90);
  });

  // 檢視器按鈕與滑鼠事件（點擊關閉按鈕或在檢視器內按滑鼠右鍵均可退出，如同 Esc）
  lightboxCloseBtnEl.addEventListener('click', closeLightbox);
  lightboxModalEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeLightbox();
  });
  prevBtnEl.addEventListener('click', prevImage);
  nextBtnEl.addEventListener('click', nextImage);

  zoomInBtnEl.addEventListener('click', () => {
    const rect = lightboxCanvasEl.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const newScale = Math.min(scale * 1.25, 40.0);
    panX = centerX - (centerX - panX) * (newScale / scale);
    panY = centerY - (centerY - panY) * (newScale / scale);
    scale = newScale;
    updateTransform(true);
  });

  zoomOutBtnEl.addEventListener('click', () => {
    const rect = lightboxCanvasEl.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const newScale = Math.max(scale / 1.25, 0.05);
    panX = centerX - (centerX - panX) * (newScale / scale);
    panY = centerY - (centerY - panY) * (newScale / scale);
    scale = newScale;
    updateTransform(true);
  });

  zoomFitBtnEl.addEventListener('click', () => fitToScreen(true));
  zoomActualBtnEl.addEventListener('click', () => zoomActual(true));

  selectAndCloseBtnEl.addEventListener('click', () => {
    if (currentIndex >= 0 && currentIndex < filteredImages.length) {
      const cur = filteredImages[currentIndex];
      closeLightbox();
      selectedPaths.add(cur.fullPath);
      updateSelectionUI();

      // 滾動畫廊至該圖片卡片可見位置
      setTimeout(() => {
        const cardEl = galleryGridEl.querySelector(`.image-card[data-path="${CSS.escape(cur.fullPath)}"]`);
        if (cardEl) {
          cardEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }, 50);

      showToast(I18nModule.t('toast_selected_in_gallery', { name: cur.fileName }), 'success');
    }
  });

  // 刪除當前大圖檢視的圖片 (送往後端彈出確認視窗後移至資源回收筒)
  function deleteCurrentLightboxImage() {
    if (currentIndex >= 0 && currentIndex < filteredImages.length) {
      const cur = filteredImages[currentIndex];
      if (vscode) {
        vscode.postMessage({
          type: 'deleteFiles',
          filePaths: [cur.fullPath]
        });
      }
    }
  }

  if (lightboxDeleteBtnEl) {
    lightboxDeleteBtnEl.addEventListener('click', deleteCurrentLightboxImage);
  }

  // 14. 全域鍵盤快速鍵
  window.addEventListener('keydown', (e) => {
    // 若在大圖檢視模式
    if (lightboxModalEl.classList.contains('active')) {
      if (e.key === 'Escape') {
        closeLightbox();
        e.preventDefault();
      } else if (e.key === 'ArrowLeft') {
        prevImage();
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        nextImage();
        e.preventDefault();
      } else if (e.key === '+' || e.key === '=') {
        zoomInBtnEl.click();
        e.preventDefault();
      } else if (e.key === '-') {
        zoomOutBtnEl.click();
        e.preventDefault();
      } else if (e.key === '0') {
        fitToScreen(true);
        e.preventDefault();
      } else if (e.key === 's' || e.key === 'S' || e.key === 'Enter') {
        selectAndCloseBtnEl.click();
        e.preventDefault();
      } else if (e.key === 'Delete' || e.key === 'Del') {
        deleteCurrentLightboxImage();
        e.preventDefault();
      }
    } else {
      // 畫廊模式快捷鍵
      if (e.key === 'Escape' && selectedPaths.size > 0) {
        clearSelection();
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        if (filteredImages.length > 0 && document.activeElement !== searchInputEl) {
          filteredImages.forEach(img => selectedPaths.add(img.fullPath));
          updateSelectionUI();
          e.preventDefault();
        }
      } else if (e.key === 'F5') {
        refreshBtnEl.click();
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        searchInputEl.focus();
        searchInputEl.select();
        e.preventDefault();
      }
    }
  });

  // 視窗大小改變時保持目前縮放與平移位置（停用自動重置，避免打斷使用者滾輪放大查看細節的狀態；若需最適視窗可點擊工具列按鈕或按快捷鍵 0）
  // window.addEventListener('resize', () => {
  //   if (lightboxModalEl.classList.contains('active')) {
  //     fitToScreen(false);
  //   }
  // });

  // ==============================================================================
  // 15. Extension Host 後端通訊監聽 (IPC Message Handler)
  // ==============================================================================

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) return;

    switch (message.type) {
      case 'initData':
        currentFolder = message.folderPath || '';
        folderNameStr = message.folderName || '';
        allImages = message.images || [];
        isRecursive = !!message.recursive;

        // 若後端有全局記憶之縮圖尺寸，且當前 Panel 尚未被本地 session 覆寫，自動套用全局記憶值
        const currentSavedState = vscode ? vscode.getState() : null;
        if (!currentSavedState || !currentSavedState.thumbSize) {
          const targetThumbSize = message.thumbSize || (function () {
            try { return localStorage.getItem(STORAGE_KEY_THUMB_SIZE); } catch (e) { return null; }
          })();

          if (targetThumbSize) {
            sizeSliderEl.value = targetThumbSize;
            document.documentElement.style.setProperty('--thumb-size', `${targetThumbSize}px`);
            saveUiState();
          }
        }

        folderNameEl.textContent = folderNameStr;
        folderInfoEl.title = currentFolder;
        imgCountBadgeEl.textContent = I18nModule.t('img_count_badge', { count: allImages.length });
        updateRecursiveButton();

        // 清理不存在於當前清單中的選取路徑
        selectedPaths.forEach(p => {
          if (!allImages.some(img => img.fullPath === p)) selectedPaths.delete(p);
        });
        updateSelectionUI();

        applyFilterAndSort();

        // 支援右鍵單圖直接開啟全螢幕大圖檢視
        if (message.targetFilePath) {
          openTargetImageByPath(message.targetFilePath);
        }
        break;

      case 'openTargetImage':
        if (message.filePath) {
          openTargetImageByPath(message.filePath);
        }
        break;

      case 'updateImages': {
        const currentViewingImage = (currentIndex >= 0 && currentIndex < filteredImages.length)
          ? filteredImages[currentIndex]
          : null;

        allImages = message.images || [];
        imgCountBadgeEl.textContent = I18nModule.t('img_count_badge', { count: allImages.length });

        // 清理已被刪除或不存在的選取路徑
        selectedPaths.forEach(p => {
          if (!allImages.some(img => img.fullPath === p)) selectedPaths.delete(p);
        });
        updateSelectionUI();

        applyFilterAndSort();

        // 若大圖視窗正開啟，依據絕對路徑精準校正 currentIndex 與數量，若被刪除則切換至下一張或關閉
        if (lightboxModalEl.classList.contains('active') && currentViewingImage) {
          const newIdx = filteredImages.findIndex(img => img.fullPath === currentViewingImage.fullPath);
          if (newIdx !== -1) {
            currentIndex = newIdx;
            lightboxIndexBadgeEl.textContent = `${currentIndex + 1} / ${filteredImages.length}`;
          } else {
            // 正在檢視的圖片被刪除：若仍有剩餘圖片則平滑顯示下一張（或最後一張），若無圖片則退出檢視器
            if (filteredImages.length > 0) {
              const targetIdx = Math.min(currentIndex, filteredImages.length - 1);
              openLightbox(targetIdx);
            } else {
              closeLightbox();
            }
          }
        }

        if (!message.isSilent) {
          showToast(I18nModule.t('toast_refresh_done', { count: allImages.length }), 'success');
        }
        break;
      }

      case 'toast':
        showToast(message.text, message.level || 'info');
        break;

      case 'localeChanged':
        if (message.locale && (message.locale === 'zh-TW' || message.locale === 'en')) {
          I18nModule.applyLanguage(message.locale, true);
        }
        break;

      case 'refocus':
        window.focus();
        if (lightboxModalEl && lightboxModalEl.classList.contains('active')) {
          if (typeof lightboxModalEl.focus === 'function') {
            lightboxModalEl.focus();
          }
        } else {
          document.body.focus();
        }
        break;
    }
  });

  // 初始化多國語言模組
  I18nModule.init();

  // 初始化還原 UI 設定
  restoreUiState();

  // 通知後端 Webview 前端已就緒，請求首次資料
  if (vscode) {
    vscode.postMessage({ type: 'ready' });
  }
})();
