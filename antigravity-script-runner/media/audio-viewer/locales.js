/**
 * 聲音檢視器 - 多國語言字典 (locales.js)
 * 支援：zh-TW (繁體中文), en (English)
 */
(function (root) {
  const LOCALES = {
    'zh-TW': {
      // 頂部工具列
      folder_path_title: '資料夾路徑',
      loading: '載入中...',
      search_placeholder: '搜尋檔名...',
      search_clear_title: '清除搜尋',
      sort_select_title: '排序依據',
      sort_title: '排序依據',
      sort_name_asc: '檔名 (A - Z)',
      sort_name_desc: '檔名 (Z - A)',
      sort_size_desc: '大小 (大到小)',
      sort_size_asc: '大小 (小到大)',
      sort_date_desc: '時間 (新到舊)',
      sort_date_asc: '時間 (舊到新)',
      slider_size_label: '尺寸',
      card_size_slider_title: '調整音訊卡片尺寸 (支援 Ctrl + 滑鼠滾輪)',
      btn_recursive_title: '包含子資料夾中的所有音訊',
      btn_recursive_title_on: '目前：包含子資料夾（點擊切換為僅當前資料夾）',
      btn_recursive_title_off: '目前：僅當前資料夾（點擊切換為搜尋子資料夾）',
      btn_recursive: '子資料夾',
      btn_recursive_text: '子資料夾',
      btn_refresh: '重新整理',
      btn_refresh_title: '重新掃描資料夾 (F5)',
      btn_refresh_text: '重新整理',
      btn_reveal_title: '在系統檔案總管中開啟此資料夾',
      btn_lang_toggle_title: 'Switch to English',
      btn_lang_indicator: 'EN',
      audio_count_badge: '{count} 首音訊',
      filter_count_badge: '已篩選: {count}',

      // 空狀態
      empty_title: '此資料夾內沒有支援的音訊',
      empty_hint: '支援格式：MP3, WAV, FLAC, M4A, OGG, AAC, WMA, AIFF, OPUS, WEBA 等。您可以嘗試開啟子資料夾搜尋或點擊重新整理。',

      // 底部浮動批量操作列
      batch_selected_count: '已選取 {count} 首',
      batch_copy_title: '複製選取音訊的路徑 (每行一個)',
      batch_copy_text: '複製路徑',
      batch_delete_title: '將選取的音訊移至資源回收筒',
      batch_delete_text: '刪除',
      batch_clear_title: '取消所有選取 (Esc)',

      // 畫廊卡片
      card_play_title: '播放此音訊 (Space)',
      card_pause_title: '暫停播放 (Space)',
      card_select_title: '選取此音訊',
      card_copy_btn_title: '複製完整路徑',
      card_open_ext_title: '以系統播放器開啟 (O)',
      card_locate_ide_title: '跳轉到檔案總管',
      card_reveal_title: '在系統檔案總管中顯示',

      // 播放器工具列與控制
      player_autonext_title: '自動播放下一首開關 (C)',
      player_autonext_title_on: '自動連播：已開啟 (點擊關閉 / C)',
      player_autonext_title_off: '自動連播：已關閉（播放一次即停止，點擊開啟 / C）',
      player_loop_title: '單曲循環開關 (R)',
      player_loop_title_on: '單曲循環：已開啟 (點擊關閉 / R)',
      player_loop_title_off: '單曲循環：已關閉 (點擊開啟 / R)',
      player_speed_title: '切換播放速度',
      player_select_and_close_title: '關閉播放器並在畫廊中選取此音訊 (S / Enter)',
      player_close_title: '關閉播放器 (Esc / 右鍵)',
      player_prev_title: '上一首 (← / [)',
      player_next_title: '下一首 (→ / ])',
      ctrl_progress_title: '尋道跳轉 (點擊或拖曳)',
      ctrl_play_pause_title: '播放 / 暫停 (Space)',
      ctrl_rewind_title: '快退 5 秒 (J / ←)',
      ctrl_forward_title: '快進 5 秒 (L / →)',
      ctrl_mute_title: '靜音切換 (M)',
      ctrl_volume_title: '音量調節 (滾輪或 ↑/↓)',
      ctrl_open_external_title: '以系統播放器開啟 (O)',
      ctrl_hide_title: '隱藏控制器 (H，右鍵切換固定常駐)',

      // 提示訊息 (Toasts)
      toast_copy_success: '已複製路徑：{file}',
      toast_batch_copy_success: '已複製 {count} 個音訊路徑',
      toast_open_external: '已透過系統播放器開啟：{file}',
      toast_open_selected_external: '已透過系統播放器開啟選取音訊',
      toast_first_audio: '已是第一首音訊',
      toast_last_audio: '已是最後一首音訊',
      toast_play_error: '播放失敗：{desc}',
      toast_forward: '快進 +{sec}s',
      toast_rewind: '快退 {sec}s',
      toast_autonext_on: '已開啟自動連播（播完自動播下一首）',
      toast_autonext_off: '已關閉自動連播（播放一次即停止）',
      toast_loop_on: '已開啟單曲循環',
      toast_loop_off: '已關閉單曲循環',
      toast_speed: '播放速度：{speed}x',
      toast_locate_success: '已在畫廊選取：{file}',
      toast_refresh_success: '已重新整理（共 {count} 首音訊）',
      toast_lang_switched: '已切換為繁體中文介面',
      toast_controls_pinned: '控制列已鎖定固定（不自動隱藏）',
      toast_controls_autohide: '已恢復自動隱藏（無操作時自動隱藏）'
    },
    'en': {
      // Top Toolbar
      folder_path_title: 'Folder Path',
      loading: 'Loading...',
      search_placeholder: 'Search by name...',
      search_clear_title: 'Clear search',
      sort_select_title: 'Sort by',
      sort_title: 'Sort by',
      sort_name_asc: 'File Name (A - Z)',
      sort_name_desc: 'File Name (Z - A)',
      sort_size_desc: 'Size (Large to Small)',
      sort_size_asc: 'Size (Small to Large)',
      sort_date_desc: 'Modified Time (New to Old)',
      sort_date_asc: 'Modified Time (Old to New)',
      slider_size_label: 'Size',
      card_size_slider_title: 'Adjust audio card size (Ctrl + Mouse Wheel supported)',
      btn_recursive_title: 'Include audios in subfolders',
      btn_recursive_title_on: 'Current: Including subfolders (click to switch to current folder only)',
      btn_recursive_title_off: 'Current: Current folder only (click to include subfolders)',
      btn_recursive: 'Subfolders',
      btn_recursive_text: 'Subfolders',
      btn_refresh: 'Refresh',
      btn_refresh_title: 'Rescan folder (F5)',
      btn_refresh_text: 'Refresh',
      btn_reveal_title: 'Reveal this folder in File Explorer',
      btn_lang_toggle_title: '切換為繁體中文',
      btn_lang_indicator: '繁中',
      audio_count_badge: '{count} Audios',
      filter_count_badge: 'Filtered: {count}',

      // Empty State
      empty_title: 'No supported audio files found in this folder',
      empty_hint: 'Supported formats: MP3, WAV, FLAC, M4A, OGG, AAC, WMA, AIFF, OPUS, WEBA, etc. Try enabling subfolders or refresh.',

      // Batch Action Bar
      batch_selected_count: '{count} selected',
      batch_copy_title: 'Copy paths of selected audios (one per line)',
      batch_copy_text: 'Copy Paths',
      batch_delete_title: 'Move selected audios to Recycle Bin',
      batch_delete_text: 'Delete',
      batch_clear_title: 'Deselect all (Esc)',

      // Gallery Cards
      card_play_title: 'Play this audio (Space)',
      card_pause_title: 'Pause playback (Space)',
      card_select_title: 'Select this audio',
      card_copy_btn_title: 'Copy full path',
      card_open_ext_title: 'Open in system player (O)',
      card_locate_ide_title: 'Reveal in IDE Explorer',
      card_reveal_title: 'Reveal in File Explorer',

      // Player Toolbar & Controls
      player_autonext_title: 'Toggle Auto-play Next (C)',
      player_autonext_title_on: 'Auto-play Next: ON (Click to turn off / C)',
      player_autonext_title_off: 'Auto-play Next: OFF (Stop after playing once, click to turn on / C)',
      player_loop_title: 'Toggle repeat loop (R)',
      player_loop_title_on: 'Single track loop: ON (Click to turn off / R)',
      player_loop_title_off: 'Single track loop: OFF (Click to turn on / R)',
      player_speed_title: 'Change playback speed',
      player_select_and_close_title: 'Close player and select in gallery (S / Enter)',
      player_close_title: 'Close player (Esc / Right-click)',
      player_prev_title: 'Previous (← / [)',
      player_next_title: 'Next (→ / ])',
      ctrl_progress_title: 'Seek (Click or Drag)',
      ctrl_play_pause_title: 'Play / Pause (Space)',
      ctrl_rewind_title: 'Rewind 5s (J / ←)',
      ctrl_forward_title: 'Forward 5s (L / →)',
      ctrl_mute_title: 'Mute / Unmute (M)',
      ctrl_volume_title: 'Volume (Wheel or ↑/↓)',
      ctrl_open_external_title: 'Open with default system player (O)',
      ctrl_hide_title: 'Hide controls (H, Right-click to toggle pin)',

      // Toast Notifications
      toast_copy_success: 'Copied path: {file}',
      toast_batch_copy_success: 'Copied {count} audio paths',
      toast_open_external: 'Opened in system player: {file}',
      toast_open_selected_external: 'Opened selected audio in system player',
      toast_first_audio: 'Already at the first audio',
      toast_last_audio: 'Already at the last audio',
      toast_play_error: 'Playback error: {desc}',
      toast_forward: 'Forward +{sec}s',
      toast_rewind: 'Rewind {sec}s',
      toast_autonext_on: 'Auto-play next enabled (Continuous playback)',
      toast_autonext_off: 'Auto-play next disabled (Stop after playing once)',
      toast_loop_on: 'Single track loop ON',
      toast_loop_off: 'Single track loop OFF',
      toast_speed: 'Playback speed: {speed}x',
      toast_locate_success: 'Selected in gallery: {file}',
      toast_refresh_success: 'Refreshed ({count} audios)',
      toast_lang_switched: 'Switched interface language to English',
      toast_controls_pinned: 'Controls pinned (always visible)',
      toast_controls_autohide: 'Controls auto-hide restored'
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LOCALES;
  }
  if (root) {
    root.AUDIO_VIEWER_LOCALES = LOCALES;
  }
})(typeof window !== 'undefined' ? window : globalThis);
