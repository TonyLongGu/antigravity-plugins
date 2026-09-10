/**
 * Antigravity IDE - Audio Viewer (自訂聲音播放器與畫廊核心互動引擎)
 * 1. 單擊直接播放 (點擊就播、無彈窗遮蔽、原音高保真輸出)
 * 2. 底部常駐播控列 (Docked Player Bar)，支援 Seek 尋道、音量、倍速與循環
 * 3. 完美支援滑鼠左鍵框選 (Marquee Box Selection) 與批量操作
 * 4. 支援滑鼠右鍵 4.5x 高速抓手滾動翻閱
 */

(function () {
  // 1. VS Code API 雙軌安全適配
  let vscode = null;
  try {
    if (typeof acquireVsCodeApi === 'function') {
      vscode = acquireVsCodeApi();
    }
  } catch (err) {
    console.log('[AudioViewer] 獨立瀏覽器除錯環境');
  }

  // 2. 全域狀態
  let allAudios = [];
  let filteredAudios = [];
  let currentFolder = '';
  let folderNameStr = '';
  let isRecursive = false;

  // 播放器狀態
  let currentIndex = -1;
  let isSeeking = false;
  let currentSpeed = 1.0;
  let isLooping = false;
  let isAutoNext = false; // 預設關閉：播完單曲即停止，不自動跳下一首
  let isMuted = false;
  let currentVolume = 0.5;
  let lastVolume = 0.5;
  let justDraggedMarquee = false;

  // 3. DOM 節點引用 - 工具列與畫廊
  const playerAudioEl = document.getElementById('playerAudio');
  const folderNameEl = document.getElementById('folderName');
  const folderInfoEl = document.getElementById('folderInfo');
  const audioCountBadgeEl = document.getElementById('audioCountBadge');
  const filterCountBadgeEl = document.getElementById('filterCountBadge');
  const searchInputEl = document.getElementById('searchInput');
  const searchClearEl = document.getElementById('searchClear');
  const sortSelectEl = document.getElementById('sortSelect');
  const sizeSliderEl = document.getElementById('sizeSlider');
  const recursiveBtnEl = document.getElementById('recursiveBtn');
  const refreshBtnEl = document.getElementById('refreshBtn');
  const revealFolderBtnEl = document.getElementById('revealFolderBtn');
  const btnLangToggleEl = document.getElementById('btn-lang-toggle');
  const langIndicatorEl = document.getElementById('lang-indicator');
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

  // 底部常駐播放列 DOM
  const dockedPlayerBarEl = document.getElementById('dockedPlayerBar');
  const playerTitleEl = document.getElementById('playerTitle');
  const playerMetaEl = document.getElementById('playerMeta');
  const playerMiniDiscEl = document.getElementById('playerMiniDisc');

  const prevBtnEl = document.getElementById('prevBtn');
  const nextBtnEl = document.getElementById('nextBtn');
  const playPauseBtnEl = document.getElementById('playPauseBtn');
  const iconPlayEl = playPauseBtnEl.querySelector('.icon-play');
  const iconPauseEl = playPauseBtnEl.querySelector('.icon-pause');

  const progressContainerEl = document.getElementById('progressContainer');
  const progressBarBufferedEl = document.getElementById('progressBarBuffered');
  const progressBarPlayedEl = document.getElementById('progressBarPlayed');
  const progressThumbEl = document.getElementById('progressThumb');
  const progressTooltipEl = document.getElementById('progressTooltip');
  const currentTimeTextEl = document.getElementById('currentTimeText');
  const durationTextEl = document.getElementById('durationText');

  const autoNextBtnEl = document.getElementById('autoNextBtn');
  const loopBtnEl = document.getElementById('loopBtn');
  const speedBtnEl = document.getElementById('speedBtn');
  const speedMenuEl = document.getElementById('speedMenu');
  const volumeBtnEl = document.getElementById('volumeBtn');
  const iconVolHighEl = volumeBtnEl.querySelector('.icon-vol-high');
  const iconVolMutedEl = volumeBtnEl.querySelector('.icon-vol-muted');
  const volumeSliderEl = document.getElementById('volumeSlider');
  const ctrlOpenExternalBtnEl = document.getElementById('ctrlOpenExternalBtn');
  const closePlayerBtnEl = document.getElementById('closePlayerBtn');

  const toastContainerEl = document.getElementById('toastContainer');

  // 多選追蹤集合 (Set of fullPath)
  const selectedPaths = new Set();
  let lastSelectedIndex = -1;

  // ============================================================================
  // 4. 國際化核心模組 (I18n Module)
  // ============================================================================
  const I18nModule = {
    currentLang: 'zh-TW',

    init() {
      const initial = (typeof window !== 'undefined' && window.INITIAL_LOCALE) || null;
      let saved = null;
      try {
        saved = localStorage.getItem('antigravity_locale');
      } catch (e) {}

      if (initial && (initial === 'zh-TW' || initial === 'en')) {
        this.applyLanguage(initial, false);
      } else if (saved && (saved === 'zh-TW' || saved === 'en')) {
        this.applyLanguage(saved, false);
      } else {
        this.applyLanguage('zh-TW', false);
      }
    },

    applyLanguage(lang, save = true) {
      if (lang !== 'zh-TW' && lang !== 'en') return;
      this.currentLang = lang;
      if (save) {
        try {
          localStorage.setItem('antigravity_locale', lang);
        } catch (e) {}
      }
      document.documentElement.lang = lang === 'zh-TW' ? 'zh-TW' : 'en';
      this.applyTranslations();
    },

    setLanguage(lang) {
      this.applyLanguage(lang, true);
    },

    toggleLanguage() {
      const next = this.currentLang === 'zh-TW' ? 'en' : 'zh-TW';
      this.applyLanguage(next, true);

      if (vscode) {
        vscode.postMessage({
          type: 'setGlobalLocale',
          locale: next,
          payload: { locale: next }
        });
      }

      showToast(this.t('toast_lang_switched'), 'info');
    },

    t(key, params = {}) {
      const locales = window.AUDIO_VIEWER_LOCALES || {};
      const dict = locales[this.currentLang] || locales['zh-TW'] || {};
      let text = dict[key] !== undefined ? dict[key] : key;
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
      return text;
    },

    applyTranslations() {
      document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        el.textContent = this.t(key);
      });

      document.querySelectorAll('[data-i18n-title]').forEach((el) => {
        const key = el.getAttribute('data-i18n-title');
        el.setAttribute('title', this.t(key));
      });

      document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.setAttribute('placeholder', this.t(key));
      });

      if (langIndicatorEl) {
        langIndicatorEl.textContent = this.t('btn_lang_indicator');
      }
      if (btnLangToggleEl) {
        btnLangToggleEl.title = this.t('btn_lang_toggle_title');
      }

      updateCountBadges();
      updateBatchBar();
      updateAutoNextUI();
      updateLoopUI();
    }
  };

  // ============================================================================
  // 5. Toast 訊息提示系統 (已依需求移除彈窗訊息，杜絕遮擋畫面內容)
  // ============================================================================
  function showToast(message, type = 'info') {
    // 彈窗訊息已停用
  }

  // ============================================================================
  // 6. 時間與格式化輔助函數
  // ============================================================================
  function formatTime(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0 || !isFinite(seconds)) {
      return '00:00';
    }
    const s = Math.floor(seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  // ============================================================================
  // 7. 畫廊卡片渲染與搜尋排序
  // ============================================================================
  function renderGallery() {
    galleryGridEl.innerHTML = '';

    if (filteredAudios.length === 0) {
      emptyStateEl.style.display = 'flex';
      return;
    }
    emptyStateEl.style.display = 'none';

    const frag = document.createDocumentFragment();

    filteredAudios.forEach((audio, idx) => {
      const card = document.createElement('div');
      card.className = 'audio-card';
      card.dataset.index = idx;
      card.dataset.path = audio.fullPath;

      if (selectedPaths.has(audio.fullPath)) {
        card.classList.add('is-selected');
      }

      if (currentIndex === idx && !playerAudioEl.paused) {
        card.classList.add('is-playing');
      }

      const durStr = (audio.durationFormatted && audio.durationFormatted !== '--:--') ? audio.durationFormatted : '--:--';

      card.innerHTML = `
        <div class="card-thumb-wrapper">
          <button class="card-select-btn" title="${I18nModule.t('card_select_title')}" data-path="${audio.fullPath}">
            <svg class="check-icon" viewBox="0 0 24 24" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </button>
          <div class="card-mini-disc"></div>
          <span class="card-ext-badge" data-ext="${(audio.ext || '').toLowerCase()}">${(audio.ext || 'AUDIO').toUpperCase()}</span>
          <div class="thumb-tag thumb-tag-duration">${durStr}</div>
          <div class="playing-bars">
            <div class="playing-bar"></div>
            <div class="playing-bar"></div>
            <div class="playing-bar"></div>
            <div class="playing-bar"></div>
          </div>
          <div class="card-play-overlay">
            <button class="card-play-btn" data-action="play-btn" title="${I18nModule.t('card_play_title')}">
              <svg class="icon-play" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              <svg class="icon-pause" viewBox="0 0 24 24" style="display:none;"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
            </button>
          </div>
        </div>
        <div class="card-info">
          <div class="card-name" title="${audio.fileName}">${audio.fileName}</div>
          <div class="card-meta-row">
            <div class="card-actions">
              <button class="card-action-btn" data-action="copy" title="${I18nModule.t('card_copy_btn_title')}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>
              </button>
              <button class="card-action-btn" data-action="external" title="${I18nModule.t('card_open_ext_title')}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.033 9.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56V7.648a.645.645 0 0 1 .967-.56z"></path><path d="M12 17v4"></path><path d="M8 21h8"></path><rect x="2" y="3" width="20" height="14" rx="2"></rect></svg>
              </button>
              <button class="card-action-btn" data-action="reveal" title="${I18nModule.t('card_reveal_title')}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </button>
            </div>
            <span class="card-date" title="${audio.mtimeMs ? new Date(audio.mtimeMs).toLocaleString() : ''}">${audio.mtimeMs ? new Date(audio.mtimeMs).toLocaleDateString() : ''}</span>
          </div>
        </div>
      `;

      frag.appendChild(card);
    });

    galleryGridEl.appendChild(frag);
  }

  function applyFilterAndSort() {
    const query = (searchInputEl.value || '').trim().toLowerCase();

    if (!query) {
      filteredAudios = [...allAudios];
      searchClearEl.style.display = 'none';
    } else {
      filteredAudios = allAudios.filter((a) => a.fileName.toLowerCase().includes(query));
      searchClearEl.style.display = 'block';
    }

    const sortType = sortSelectEl.value;
    filteredAudios.sort((a, b) => {
      switch (sortType) {
        case 'name-asc':
          return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' });
        case 'name-desc':
          return b.fileName.localeCompare(a.fileName, undefined, { numeric: true, sensitivity: 'base' });
        case 'dur-desc':
          return (b.duration || 0) - (a.duration || 0);
        case 'dur-asc':
          return (a.duration || 0) - (b.duration || 0);
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

    updateCountBadges();
    renderGallery();
  }

  function updateCountBadges() {
    audioCountBadgeEl.textContent = I18nModule.t('audio_count_badge', { count: allAudios.length });
    const query = (searchInputEl.value || '').trim();
    if (query) {
      filterCountBadgeEl.style.display = 'inline-flex';
      filterCountBadgeEl.textContent = I18nModule.t('filter_count_badge', { count: filteredAudios.length });
    } else {
      filterCountBadgeEl.style.display = 'none';
    }
  }

  // ============================================================================
  // 8. 多選與批量操作
  // ============================================================================
  function updateBatchBar() {
    const count = selectedPaths.size;
    if (count > 0) {
      batchActionBarEl.style.display = 'flex';
      batchSelectedCountEl.textContent = I18nModule.t('batch_selected_count', { count });
    } else {
      batchActionBarEl.style.display = 'none';
    }
  }

  function updateSelectionUI() {
    galleryGridEl.querySelectorAll('.audio-card').forEach((c) => {
      if (selectedPaths.has(c.dataset.path)) {
        c.classList.add('is-selected');
      } else {
        c.classList.remove('is-selected');
      }
    });

    if (selectedPaths.size > 0) {
      document.body.classList.add('has-selection');
    } else {
      document.body.classList.remove('has-selection');
    }

    updateBatchBar();
  }

  function toggleSelectCard(fullPath, cardEl, multi = false, range = false) {
    if (range && lastSelectedIndex !== -1) {
      const curIdx = parseInt(cardEl.dataset.index, 10);
      const start = Math.min(lastSelectedIndex, curIdx);
      const end = Math.max(lastSelectedIndex, curIdx);
      for (let i = start; i <= end; i++) {
        if (filteredAudios[i]) {
          selectedPaths.add(filteredAudios[i].fullPath);
        }
      }
    } else if (multi) {
      if (selectedPaths.has(fullPath)) {
        selectedPaths.delete(fullPath);
      } else {
        selectedPaths.add(fullPath);
        lastSelectedIndex = parseInt(cardEl.dataset.index, 10);
      }
    } else {
      selectedPaths.clear();
      selectedPaths.add(fullPath);
      lastSelectedIndex = parseInt(cardEl.dataset.index, 10);
    }

    updateSelectionUI();
  }

  function clearSelection() {
    selectedPaths.clear();
    lastSelectedIndex = -1;
    updateSelectionUI();
  }

  // ============================================================================
  // 9. 核心單點即播引擎 (Direct Audio Player Engine)
  // ============================================================================
  function playTrack(index) {
    if (index < 0 || index >= filteredAudios.length) return;

    // 若點擊同一首且正在播放，切換暫停
    if (currentIndex === index && !playerAudioEl.paused) {
      playerAudioEl.pause();
      return;
    }

    // 若點擊同一首且處於暫停，繼續播放
    if (currentIndex === index && playerAudioEl.paused && playerAudioEl.src) {
      playerAudioEl.play().catch(handlePlayError);
      return;
    }

    currentIndex = index;
    const audio = filteredAudios[currentIndex];

    // 更新底部常駐播控列資訊
    playerTitleEl.textContent = audio.fileName;
    playerTitleEl.title = audio.fileName;
    playerMetaEl.textContent = `${(audio.ext || 'AUDIO').toUpperCase()} • ${audio.sizeFormatted} • ${currentIndex + 1} / ${filteredAudios.length}`;

    // 顯示底部播控列
    dockedPlayerBarEl.style.display = 'flex';
    document.body.classList.add('has-player');

    // 設置音訊來源（支援本機 HTTP 串流，並內建 localUri 備援）
    playerAudioEl.src = audio.uri;
    playerAudioEl.playbackRate = currentSpeed;
    playerAudioEl.loop = isLooping;
    playerAudioEl.volume = isMuted ? 0 : currentVolume;
    playerAudioEl.muted = isMuted;

    const playPromise = playerAudioEl.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn('[AudioViewer] HTTP 串流播放失敗，嘗試備援 localUri:', err);
        if (audio.localUri && playerAudioEl.src !== audio.localUri) {
          playerAudioEl.src = audio.localUri;
          playerAudioEl.volume = isMuted ? 0 : currentVolume;
          playerAudioEl.muted = isMuted;
          playerAudioEl.play().catch(handlePlayError);
        } else {
          handlePlayError(err);
        }
      });
    }

    updatePlayingCardState();
  }

  function handlePlayError(err) {
    console.error('[AudioViewer] 播放失敗:', err);
    showToast(I18nModule.t('toast_play_error', { desc: err.message || '音訊解碼失敗' }), 'error');
    updatePlayPauseState(false);
  }

  function togglePlayPause() {
    if (currentIndex === -1) {
      if (filteredAudios.length > 0) {
        playTrack(0);
      }
      return;
    }

    if (playerAudioEl.paused) {
      if (playerAudioEl.ended || (playerAudioEl.duration > 0 && playerAudioEl.currentTime >= playerAudioEl.duration)) {
        playerAudioEl.currentTime = 0;
      }
      playerAudioEl.play().catch(handlePlayError);
    } else {
      playerAudioEl.pause();
    }
  }

  function updatePlayPauseState(isPlaying) {
    if (isPlaying) {
      iconPlayEl.style.display = 'none';
      iconPauseEl.style.display = 'block';
      playerMiniDiscEl.classList.add('is-spinning');
    } else {
      iconPlayEl.style.display = 'block';
      iconPauseEl.style.display = 'none';
      playerMiniDiscEl.classList.remove('is-spinning');
    }
    updatePlayingCardState();
  }

  function updatePlayingCardState() {
    const isPlaying = !playerAudioEl.paused;
    galleryGridEl.querySelectorAll('.audio-card').forEach((c) => {
      const idx = parseInt(c.dataset.index, 10);
      const playBtn = c.querySelector('.card-play-btn');
      const iconPlay = playBtn ? playBtn.querySelector('.icon-play') : null;
      const iconPause = playBtn ? playBtn.querySelector('.icon-pause') : null;

      if (idx === currentIndex) {
        if (isPlaying) {
          c.classList.add('is-playing');
          if (iconPlay) iconPlay.style.display = 'none';
          if (iconPause) iconPause.style.display = 'block';
        } else {
          c.classList.remove('is-playing');
          if (iconPlay) iconPlay.style.display = 'block';
          if (iconPause) iconPause.style.display = 'none';
        }
      } else {
        c.classList.remove('is-playing');
        if (iconPlay) iconPlay.style.display = 'block';
        if (iconPause) iconPause.style.display = 'none';
      }
    });
  }

  function playPrev() {
    if (filteredAudios.length === 0) return;
    if (currentIndex > 0) {
      playTrack(currentIndex - 1);
    } else {
      showToast(I18nModule.t('toast_first_audio'), 'info');
    }
  }

  function playNext() {
    if (filteredAudios.length === 0) return;
    if (currentIndex < filteredAudios.length - 1) {
      playTrack(currentIndex + 1);
    } else {
      showToast(I18nModule.t('toast_last_audio'), 'info');
      updatePlayPauseState(false);
    }
  }

  function seekRelative(sec) {
    if (!isFinite(playerAudioEl.duration) || playerAudioEl.duration <= 0) return;
    const target = Math.max(0, Math.min(playerAudioEl.duration, playerAudioEl.currentTime + sec));
    playerAudioEl.currentTime = target;
    if (sec > 0) {
      showToast(I18nModule.t('toast_forward', { sec }), 'info');
    } else {
      showToast(I18nModule.t('toast_rewind', { sec: Math.abs(sec) }), 'info');
    }
  }

  function setSpeed(speed) {
    currentSpeed = speed;
    playerAudioEl.playbackRate = speed;
    speedBtnEl.textContent = `${speed}x`;
    speedMenuEl.querySelectorAll('.speed-item').forEach((item) => {
      if (parseFloat(item.dataset.speed) === speed) {
        item.classList.add('is-active');
      } else {
        item.classList.remove('is-active');
      }
    });
    speedMenuEl.style.display = 'none';
    showToast(I18nModule.t('toast_speed', { speed }), 'info');
  }

  function toggleAutoNext() {
    isAutoNext = !isAutoNext;
    // 互斥邏輯：開啟自動連播時，自動取消單曲循環
    if (isAutoNext && isLooping) {
      isLooping = false;
      updateLoopUI();
      try {
        localStorage.setItem('antigravity_audio_loop', 'false');
      } catch (e) {}
      if (vscode) {
        vscode.postMessage({ type: 'saveLoop', loop: false });
      }
    }
    updateAutoNextUI();
    try {
      localStorage.setItem('antigravity_audio_autonext', String(isAutoNext));
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
    // 互斥邏輯：開啟單曲循環時，自動取消自動連播
    if (isLooping && isAutoNext) {
      isAutoNext = false;
      updateAutoNextUI();
      try {
        localStorage.setItem('antigravity_audio_autonext', 'false');
      } catch (e) {}
      if (vscode) {
        vscode.postMessage({ type: 'saveAutoNext', autoNext: false });
      }
    }
    updateLoopUI();
    try {
      localStorage.setItem('antigravity_audio_loop', String(isLooping));
    } catch (e) {}
    if (vscode) {
      vscode.postMessage({ type: 'saveLoop', loop: isLooping });
    }
    showToast(isLooping ? I18nModule.t('toast_loop_on') : I18nModule.t('toast_loop_off'), 'info');
  }

  function updateLoopUI() {
    playerAudioEl.loop = isLooping;
    if (loopBtnEl) {
      loopBtnEl.classList.toggle('active', isLooping);
      loopBtnEl.title = isLooping
        ? I18nModule.t('player_loop_title_on')
        : I18nModule.t('player_loop_title_off');
    }
  }

  function updateVolume(val) {
    currentVolume = Math.max(0, Math.min(1, val));
    if (currentVolume > 0) isMuted = false;
    playerAudioEl.volume = isMuted ? 0 : currentVolume;
    volumeSliderEl.value = currentVolume;
    updateVolumeIcon();

    if (vscode) {
      vscode.postMessage({
        type: 'saveVolume',
        volume: currentVolume,
        muted: isMuted,
        lastVolume: currentVolume > 0 ? currentVolume : lastVolume
      });
    }
  }

  function toggleMute() {
    isMuted = !isMuted;
    if (isMuted) {
      lastVolume = currentVolume > 0 ? currentVolume : lastVolume;
      playerAudioEl.volume = 0;
      volumeSliderEl.value = 0;
    } else {
      currentVolume = lastVolume > 0 ? lastVolume : 0.5;
      playerAudioEl.volume = currentVolume;
      volumeSliderEl.value = currentVolume;
    }
    updateVolumeIcon();
  }

  function updateVolumeIcon() {
    if (isMuted || playerAudioEl.volume === 0) {
      iconVolHighEl.style.display = 'none';
      iconVolMutedEl.style.display = 'block';
    } else {
      iconVolHighEl.style.display = 'block';
      iconVolMutedEl.style.display = 'none';
    }
  }

  function closeDockedPlayer() {
    currentIndex = -1;
    playerAudioEl.pause();
    playerAudioEl.removeAttribute('src');
    playerAudioEl.load();
    dockedPlayerBarEl.style.display = 'none';
    document.body.classList.remove('has-player');
    updatePlayingCardState();
  }

  // 尋道進度條設置
  function setupProgressBar() {
    let isDragging = false;

    function seekFromEvent(e) {
      const rect = progressContainerEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const dur = playerAudioEl.duration;
      if (isFinite(dur) && dur > 0) {
        playerAudioEl.currentTime = ratio * dur;
        currentTimeTextEl.textContent = formatTime(ratio * dur);
      }
      progressBarPlayedEl.style.width = `${ratio * 100}%`;
      progressThumbEl.style.left = `${ratio * 100}%`;
    }

    progressContainerEl.addEventListener('pointerdown', (e) => {
      isDragging = true;
      isSeeking = true;
      progressContainerEl.classList.add('is-dragging');
      try { progressContainerEl.setPointerCapture(e.pointerId); } catch (_) {}
      seekFromEvent(e);
    });

    progressContainerEl.addEventListener('pointermove', (e) => {
      const rect = progressContainerEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

      if (isFinite(playerAudioEl.duration) && playerAudioEl.duration > 0) {
        const hoverTime = ratio * playerAudioEl.duration;
        progressTooltipEl.style.display = 'block';
        progressTooltipEl.style.left = `${ratio * 100}%`;
        progressTooltipEl.textContent = formatTime(hoverTime);
      }

      if (isDragging) {
        seekFromEvent(e);
      }
    });

    const endSeek = (e) => {
      if (isDragging) {
        if (e) seekFromEvent(e);
        isDragging = false;
        isSeeking = false;
        progressContainerEl.classList.remove('is-dragging');
        if (e && e.pointerId !== undefined) {
          try { progressContainerEl.releasePointerCapture(e.pointerId); } catch (_) {}
        }
      }
    };

    progressContainerEl.addEventListener('pointerup', endSeek);
    progressContainerEl.addEventListener('pointercancel', endSeek);

    progressContainerEl.addEventListener('pointerleave', () => {
      if (!isDragging) {
        progressTooltipEl.style.display = 'none';
      }
    });
  }

  // ============================================================================
  // 10. 畫廊框選 (Marquee Box Selection) 與滑鼠右鍵抓手手勢
  // ============================================================================
  function setupGalleryInteractions() {
    let isLeftBoxSelecting = false;
    let hasDraggedLeftBox = false;
    let boxStartX = 0;
    let boxStartY = 0;
    let initialSelectedPathsOnDrag = new Set();
    let leftBoxPointerId = null;

    let isRightDragging = false;
    let rightStartX = 0;
    let rightStartY = 0;
    let startScrollTop = 0;
    let startScrollLeft = 0;
    let rightDragPointerId = null;

    // 滑鼠指針按下
    galleryViewportEl.addEventListener('pointerdown', (e) => {
      // 1. 滑鼠右鍵抓手拖曳
      if (e.button === 2) {
        isRightDragging = true;
        rightStartX = e.clientX;
        rightStartY = e.clientY;
        startScrollTop = galleryViewportEl.scrollTop;
        startScrollLeft = galleryViewportEl.scrollLeft;
        rightDragPointerId = e.pointerId;
        document.body.classList.add('is-right-dragging');
        try { galleryViewportEl.setPointerCapture(e.pointerId); } catch (_) {}
        return;
      }

      // 2. 滑鼠左鍵：框選判定（允許在卡片與縮圖上按住拖曳框選；排除按鈕、核取方塊、底部播控列與批量操作列）
      if (e.button === 0) {
        if (
          e.target.closest('button') ||
          e.target.closest('.card-checkbox') ||
          e.target.closest('.card-actions') ||
          e.target.closest('.batch-action-bar') ||
          e.target.closest('.docked-player-bar')
        ) {
          return;
        }

        isLeftBoxSelecting = true;
        hasDraggedLeftBox = false;
        boxStartX = e.clientX;
        boxStartY = e.clientY;
        leftBoxPointerId = e.pointerId;
        initialSelectedPathsOnDrag = e.shiftKey ? new Set(selectedPaths) : new Set();
        // 切勿在 pointerdown 過早調用 setPointerCapture，避免劫持單擊事件導致卡片無法觸發 click 播放
      }
    });

    // 滑鼠指針移動
    galleryViewportEl.addEventListener('pointermove', (e) => {
      // 右鍵抓手手勢
      if (isRightDragging) {
        const deltaY = (e.clientY - rightStartY) * 4.5;
        const deltaX = (e.clientX - rightStartX) * 4.5;
        galleryViewportEl.scrollTop = startScrollTop - deltaY;
        galleryViewportEl.scrollLeft = startScrollLeft - deltaX;
        return;
      }

      // 左鍵框選
      if (isLeftBoxSelecting) {
        if ((e.buttons & 1) === 0) {
          endLeftBoxSelect(e);
          return;
        }

        const dx = e.clientX - boxStartX;
        const dy = e.clientY - boxStartY;

        // 超過 6px 閥值啟動矩形框選，避免單擊時的微小指針抖動
        if (!hasDraggedLeftBox && Math.hypot(dx, dy) > 6) {
          hasDraggedLeftBox = true;
          selectionMarqueeEl.style.display = 'block';
          try { galleryViewportEl.setPointerCapture(e.pointerId); } catch (_) {}
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

          // AABB 螢幕座標矩形碰撞檢測
          const newSelection = new Set(initialSelectedPathsOnDrag);
          const cardEls = galleryGridEl.querySelectorAll('.audio-card');

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
          newSelection.forEach((p) => selectedPaths.add(p));
          updateSelectionUI();
        }
      }
    });

    function endLeftBoxSelect(e) {
      if (!isLeftBoxSelecting) return;
      isLeftBoxSelecting = false;

      if (hasDraggedLeftBox) {
        if (leftBoxPointerId !== null) {
          try { galleryViewportEl.releasePointerCapture(leftBoxPointerId); } catch (_) {}
        }
        selectionMarqueeEl.style.display = 'none';
        justDraggedMarquee = true;
        setTimeout(() => {
          hasDraggedLeftBox = false;
          justDraggedMarquee = false;
        }, 120);
      } else {
        // 若只是空白處單擊且未按 Shift/Ctrl，清空選擇
        if (e && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.target.closest('.audio-card') && !e.target.closest('.batch-action-bar')) {
          clearSelection();
        }
      }
      leftBoxPointerId = null;
    }

    const endRightDrag = () => {
      if (!isRightDragging) return;
      isRightDragging = false;
      if (rightDragPointerId !== null) {
        try { galleryViewportEl.releasePointerCapture(rightDragPointerId); } catch (_) {}
        rightDragPointerId = null;
      }
      document.body.classList.remove('is-right-dragging');
    };

    galleryViewportEl.addEventListener('pointerup', (e) => {
      if (e.button === 2) endRightDrag();
      if (e.button === 0) endLeftBoxSelect(e);
    });

    galleryViewportEl.addEventListener('pointercancel', () => {
      endRightDrag();
      endLeftBoxSelect(null);
    });

    // 防止原生拖曳干擾自訂框選
    window.addEventListener('dragstart', (e) => e.preventDefault());

    // 徹底阻斷原生右鍵選單（杜絕剪下、複製、貼上選單），維持純淨 IDE 介面，並支援右鍵 4.5x 抓手滾動
    // 僅在搜尋輸入框內保留原生選單以利文字剪貼
    document.addEventListener('contextmenu', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      e.preventDefault();
    });
  }

  // ============================================================================
  // 11. 事件監聽綁定
  // ============================================================================
  function bindEvents() {
    // 搜尋與排序
    searchInputEl.addEventListener('input', applyFilterAndSort);
    searchClearEl.addEventListener('click', () => {
      searchInputEl.value = '';
      applyFilterAndSort();
      searchInputEl.focus();
    });
    sortSelectEl.addEventListener('change', applyFilterAndSort);

    // 卡片尺寸滑桿
    sizeSliderEl.addEventListener('input', (e) => {
      const val = e.target.value;
      document.documentElement.style.setProperty('--card-size', `${val}px`);
      if (vscode) {
        vscode.postMessage({ type: 'saveCardSize', size: parseInt(val, 10) });
      }
    });

    // Ctrl + 滾輪縮放卡片
    galleryViewportEl.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        let cur = parseInt(sizeSliderEl.value, 10);
        cur += e.deltaY < 0 ? 15 : -15;
        cur = Math.max(160, Math.min(360, cur));
        sizeSliderEl.value = cur;
        document.documentElement.style.setProperty('--card-size', `${cur}px`);
        if (vscode) {
          vscode.postMessage({ type: 'saveCardSize', size: cur });
        }
      }
    }, { passive: false });

    // 工具列按鈕
    recursiveBtnEl.addEventListener('click', () => {
      isRecursive = !isRecursive;
      recursiveBtnEl.classList.toggle('active', isRecursive);
      recursiveBtnEl.title = isRecursive ? I18nModule.t('btn_recursive_title_on') : I18nModule.t('btn_recursive_title_off');
      if (vscode) {
        vscode.postMessage({ type: 'toggleRecursive', recursive: isRecursive });
      }
    });

    refreshBtnEl.addEventListener('click', () => {
      if (vscode) vscode.postMessage({ type: 'refresh' });
    });

    revealFolderBtnEl.addEventListener('click', () => {
      if (vscode) vscode.postMessage({ type: 'revealFolder' });
    });

    btnLangToggleEl.addEventListener('click', () => {
      I18nModule.toggleLanguage();
    });

    // 畫廊卡片單點即播 (核心：直接單擊播放，無需彈窗)
    galleryGridEl.addEventListener('click', (e) => {
      if (justDraggedMarquee) return;
      const card = e.target.closest('.audio-card');
      if (!card) return;

      const idx = parseInt(card.dataset.index, 10);
      const audio = filteredAudios[idx];
      if (!audio) return;

      // 點擊左上角圓形選取按鈕：僅切換多選，不播放
      const selectBtn = e.target.closest('.card-select-btn') || e.target.closest('.card-checkbox');
      if (selectBtn) {
        e.stopPropagation();
        toggleSelectCard(audio.fullPath, card, true);
        return;
      }

      // 點擊卡片內部小動作按鈕
      const actionBtn = e.target.closest('button');
      if (actionBtn) {
        const action = actionBtn.dataset.action;
        if (action === 'play-btn') {
          e.stopPropagation();
          if (currentIndex === idx) {
            togglePlayPause();
          } else {
            playTrack(idx);
          }
          return;
        } else if (action === 'copy') {
          e.stopPropagation();
          navigator.clipboard.writeText(audio.fullPath);
          showToast(I18nModule.t('toast_copy_success', { file: audio.fileName }), 'success');
          return;
        } else if (action === 'external') {
          e.stopPropagation();
          if (!playerAudioEl.paused) {
            playerAudioEl.pause();
          }
          if (vscode) vscode.postMessage({ type: 'openWithDefaultApp', filePath: audio.fullPath });
          showToast(I18nModule.t('toast_open_external', { file: audio.fileName }), 'info');
          return;
        } else if (action === 'reveal') {
          e.stopPropagation();
          if (vscode) vscode.postMessage({ type: 'revealFile', filePath: audio.fullPath });
          return;
        }
      }

      // 壓住 Shift 或 Ctrl/Cmd + 滑鼠左鍵：才進入單選/切換選取狀態，不播放
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        toggleSelectCard(audio.fullPath, card, true);
        return;
      }

      // 一般直接單擊卡片：不要進入選擇狀態，只要播放就可以了！
      lastSelectedIndex = idx;
      playTrack(idx);
    });

    // 批量工具列按鈕
    batchCopyPathsBtnEl.addEventListener('click', () => {
      const paths = Array.from(selectedPaths);
      if (paths.length === 0) return;
      navigator.clipboard.writeText(paths.join('\n'));
      showToast(I18nModule.t('toast_batch_copy_success', { count: paths.length }), 'success');
    });

    batchDeleteBtnEl.addEventListener('click', () => {
      const paths = Array.from(selectedPaths);
      if (paths.length === 0) return;
      if (vscode) {
        vscode.postMessage({ type: 'deleteFiles', filePaths: paths });
      }
    });

    batchClearBtnEl.addEventListener('click', clearSelection);

    // 底部常駐播放列播控事件
    playPauseBtnEl.addEventListener('click', togglePlayPause);
    prevBtnEl.addEventListener('click', playPrev);
    nextBtnEl.addEventListener('click', playNext);
    if (autoNextBtnEl) autoNextBtnEl.addEventListener('click', toggleAutoNext);
    loopBtnEl.addEventListener('click', toggleLoop);
    closePlayerBtnEl.addEventListener('click', closeDockedPlayer);

    // 倍速下拉
    speedBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      speedMenuEl.style.display = speedMenuEl.style.display === 'block' ? 'none' : 'block';
    });

    speedMenuEl.addEventListener('click', (e) => {
      const item = e.target.closest('.speed-item');
      if (item) {
        setSpeed(parseFloat(item.dataset.speed));
      }
    });

    window.addEventListener('click', () => {
      speedMenuEl.style.display = 'none';
    });

    // 音量
    volumeBtnEl.addEventListener('click', toggleMute);
    volumeSliderEl.addEventListener('input', (e) => {
      updateVolume(parseFloat(e.target.value));
    });

    ctrlOpenExternalBtnEl.addEventListener('click', () => {
      if (currentIndex >= 0 && currentIndex < filteredAudios.length) {
        if (!playerAudioEl.paused) {
          playerAudioEl.pause();
        }
        const audio = filteredAudios[currentIndex];
        if (vscode) vscode.postMessage({ type: 'openWithDefaultApp', filePath: audio.fullPath });
        showToast(I18nModule.t('toast_open_external', { file: audio.fileName }), 'info');
      }
    });

    // 尋道進度條設置
    setupProgressBar();

    // 原生音訊元件事件
    playerAudioEl.addEventListener('play', () => updatePlayPauseState(true));
    playerAudioEl.addEventListener('pause', () => updatePlayPauseState(false));
    playerAudioEl.addEventListener('error', () => {
      // 若播放器已關閉或 src 屬性已被移除/為空，視為正常卸載，直接忽略
      if (currentIndex === -1 || !playerAudioEl.getAttribute('src')) {
        return;
      }
      const err = playerAudioEl.error;
      console.warn('[AudioViewer] 原生音訊元件回報錯誤:', err);
      if (currentIndex >= 0 && currentIndex < filteredAudios.length) {
        const audio = filteredAudios[currentIndex];
        if (audio.localUri && playerAudioEl.src !== audio.localUri) {
          console.warn('[AudioViewer] 嘗試自動切換 localUri 備援播放:', audio.localUri);
          playerAudioEl.src = audio.localUri;
          playerAudioEl.volume = isMuted ? 0 : currentVolume;
          playerAudioEl.muted = isMuted;
          playerAudioEl.play().catch(handlePlayError);
          return;
        }
      }
      handlePlayError(err || new Error('音訊解碼失敗'));
    });
    playerAudioEl.addEventListener('ended', () => {
      if (isLooping) {
        playerAudioEl.currentTime = 0;
        playerAudioEl.play().catch(handlePlayError);
        return;
      }

      if (isAutoNext) {
        playNext();
        return;
      }

      // 預設行為：播放一次就停止
      updatePlayPauseState(false);
      currentTimeTextEl.textContent = formatTime(playerAudioEl.duration || 0);
      progressBarPlayedEl.style.width = '100%';
      progressThumbEl.style.left = '100%';
    });

    playerAudioEl.addEventListener('timeupdate', () => {
      if (!isSeeking && isFinite(playerAudioEl.duration) && playerAudioEl.duration > 0) {
        const cur = playerAudioEl.currentTime;
        const dur = playerAudioEl.duration;
        currentTimeTextEl.textContent = formatTime(cur);
        durationTextEl.textContent = formatTime(dur);

        const pct = (cur / dur) * 100;
        progressBarPlayedEl.style.width = `${pct}%`;
        progressThumbEl.style.left = `${pct}%`;
      }
    });

    playerAudioEl.addEventListener('progress', () => {
      if (playerAudioEl.buffered.length > 0 && isFinite(playerAudioEl.duration) && playerAudioEl.duration > 0) {
        const bufEnd = playerAudioEl.buffered.end(playerAudioEl.buffered.length - 1);
        const pct = (bufEnd / playerAudioEl.duration) * 100;
        progressBarBufferedEl.style.width = `${pct}%`;
      }
    });

    playerAudioEl.addEventListener('loadedmetadata', () => {
      durationTextEl.textContent = formatTime(playerAudioEl.duration);
      if (currentIndex >= 0 && currentIndex < filteredAudios.length) {
        const audio = filteredAudios[currentIndex];
        if (!audio.duration || audio.duration <= 0) {
          audio.duration = playerAudioEl.duration;
          audio.durationFormatted = formatTime(playerAudioEl.duration);
          const card = galleryGridEl.querySelector(`[data-path="${CSS.escape(audio.fullPath)}"]`);
          if (card) {
            const durTag = card.querySelector('.thumb-tag-duration');
            if (durTag) durTag.textContent = audio.durationFormatted;
          }
        }
      }
    });

    // 全域鍵盤快捷鍵
    window.addEventListener('keydown', (e) => {
      if (document.activeElement === searchInputEl) {
        if (e.key === 'Escape') searchInputEl.blur();
        return;
      }

      switch (e.code) {
        case 'Enter':
          e.preventDefault();
          if (selectedPaths.size > 0) {
            const firstSelected = Array.from(selectedPaths)[0];
            const selIdx = filteredAudios.findIndex((a) => a.fullPath === firstSelected);
            if (selIdx !== -1) playTrack(selIdx);
          } else if (currentIndex !== -1) {
            togglePlayPause();
          } else if (filteredAudios.length > 0) {
            playTrack(0);
          }
          break;
        case 'Space':
          e.preventDefault();
          togglePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekRelative(-5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekRelative(5);
          break;
        case 'KeyJ':
          seekRelative(-5);
          break;
        case 'KeyL':
          seekRelative(5);
          break;
        case 'BracketLeft':
          playPrev();
          break;
        case 'BracketRight':
          playNext();
          break;
        case 'ArrowUp':
          e.preventDefault();
          updateVolume(currentVolume + 0.05);
          break;
        case 'ArrowDown':
          e.preventDefault();
          updateVolume(currentVolume - 0.05);
          break;
        case 'KeyM':
          toggleMute();
          break;
        case 'KeyC':
          if (!e.ctrlKey && !e.metaKey && !e.altKey) {
            toggleAutoNext();
          }
          break;
        case 'KeyR':
          toggleLoop();
          break;
        case 'KeyO':
          if (!playerAudioEl.paused) {
            playerAudioEl.pause();
          }
          if (currentIndex >= 0 && currentIndex < filteredAudios.length) {
            const audio = filteredAudios[currentIndex];
            if (vscode) vscode.postMessage({ type: 'openWithDefaultApp', filePath: audio.fullPath });
            showToast(I18nModule.t('toast_open_external', { file: audio.fileName }), 'info');
          } else if (selectedPaths.size === 1) {
            const path = Array.from(selectedPaths)[0];
            const audio = filteredAudios.find((a) => a.fullPath === path);
            if (vscode) vscode.postMessage({ type: 'openWithDefaultApp', filePath: path });
            showToast(audio ? I18nModule.t('toast_open_external', { file: audio.fileName }) : I18nModule.t('toast_open_selected_external'), 'info');
          }
          break;
        case 'KeyF':
          if (e.ctrlKey) {
            e.preventDefault();
            searchInputEl.focus();
          }
          break;
        case 'F5':
          e.preventDefault();
          if (vscode) vscode.postMessage({ type: 'refresh' });
          break;
        case 'Escape':
          if (selectedPaths.size > 0) {
            clearSelection();
          } else if (dockedPlayerBarEl.style.display !== 'none') {
            closeDockedPlayer();
          }
          break;
      }
    });
  }

  // ============================================================================
  // 12. Webview 通訊監聽 (Message Receiver)
  // ============================================================================
  function setupWebviewMessages() {
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) return;

      switch (msg.type) {
        case 'initData':
          currentFolder = msg.folderPath || '';
          folderNameStr = msg.folderName || '';
          allAudios = Array.isArray(msg.audios) ? msg.audios : [];
          isRecursive = !!msg.recursive;

          folderNameEl.textContent = folderNameStr;
          folderInfoEl.title = currentFolder;
          recursiveBtnEl.classList.toggle('active', isRecursive);

          if (typeof msg.cardSize === 'number' && msg.cardSize >= 160 && msg.cardSize <= 360) {
            sizeSliderEl.value = msg.cardSize;
            document.documentElement.style.setProperty('--card-size', `${msg.cardSize}px`);
          }

          if (typeof msg.volume === 'number') {
            currentVolume = msg.volume;
            volumeSliderEl.value = currentVolume;
          }
          if (typeof msg.muted === 'boolean') {
            isMuted = msg.muted;
          }
          if (typeof msg.lastVolume === 'number') {
            lastVolume = msg.lastVolume;
          }
          updateVolumeIcon();

          if (typeof msg.autoNext === 'boolean') {
            isAutoNext = msg.autoNext;
          } else {
            try {
              const savedAuto = localStorage.getItem('antigravity_audio_autonext');
              if (savedAuto !== null) isAutoNext = savedAuto === 'true';
            } catch (e) {}
          }
          if (typeof msg.loop === 'boolean') {
            isLooping = msg.loop;
          } else {
            try {
              const savedLoop = localStorage.getItem('antigravity_audio_loop');
              if (savedLoop !== null) isLooping = savedLoop === 'true';
            } catch (e) {}
          }
          // 互斥安全防護：若歷史儲存狀態兩者同時開啟，以單曲循環為優先，自動關閉自動連播
          if (isLooping && isAutoNext) {
            isAutoNext = false;
            try {
              localStorage.setItem('antigravity_audio_autonext', 'false');
            } catch (e) {}
            if (vscode) {
              vscode.postMessage({ type: 'saveAutoNext', autoNext: false });
            }
          }
          updateAutoNextUI();
          updateLoopUI();

          applyFilterAndSort();

          // 若直接在某個音訊檔案上按右鍵開啟
          if (msg.targetFilePath) {
            const targetIdx = filteredAudios.findIndex((a) => a.fullPath === msg.targetFilePath);
            if (targetIdx !== -1) {
              playTrack(targetIdx);
            }
          }
          break;

        case 'updateAudios': {
          const currentPlayingAudio = (currentIndex >= 0 && currentIndex < filteredAudios.length)
            ? filteredAudios[currentIndex]
            : null;

          allAudios = Array.isArray(msg.audios) ? msg.audios : [];

          // 清理已被刪除或不存在的選取路徑
          selectedPaths.forEach(p => {
            if (!allAudios.some(a => a.fullPath === p)) selectedPaths.delete(p);
          });
          updateSelectionUI();

          applyFilterAndSort();

          // 保持當前播放中曲目的 index 同步與元資料更新
          if (currentPlayingAudio) {
            const newIdx = filteredAudios.findIndex(a => a.fullPath === currentPlayingAudio.fullPath);
            if (newIdx !== -1) {
              currentIndex = newIdx;
              playerMetaEl.textContent = `${(filteredAudios[currentIndex].ext || 'AUDIO').toUpperCase()} • ${filteredAudios[currentIndex].sizeFormatted} • ${currentIndex + 1} / ${filteredAudios.length}`;
            }
          }
          updatePlayingCardState();

          if (!msg.isSilent) {
            showToast(I18nModule.t('toast_refresh_success', { count: allAudios.length }), 'success');
          }
          break;
        }

        case 'openTargetAudio':
          if (msg.filePath) {
            const targetIdx = filteredAudios.findIndex((a) => a.fullPath === msg.filePath);
            if (targetIdx !== -1) {
              playTrack(targetIdx);
            }
          }
          break;

        case 'localeChanged':
          if (msg.locale && (msg.locale === 'zh-TW' || msg.locale === 'en')) {
            I18nModule.applyLanguage(msg.locale, true);
          }
          break;

        case 'toast':
          showToast(msg.text || '', msg.level || 'info');
          break;

        case 'refocus':
          window.focus();
          document.body.focus();
          break;
      }
    });

    if (vscode) {
      vscode.postMessage({ type: 'ready' });
    }
  }

  // 初始化啟動
  document.addEventListener('DOMContentLoaded', () => {
    I18nModule.init();
    bindEvents();
    setupGalleryInteractions();
    setupWebviewMessages();
  });
})();
