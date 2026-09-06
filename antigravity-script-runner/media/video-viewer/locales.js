/**
 * 影片檢視器 - 多國語言字典 (locales.js)
 * 支援：zh-TW (繁體中文), en (English)
 */
(function (root) {
  const LOCALES = {
    'zh-TW': {
      // 頂部工具列
      folder_path_title: '資料夾路徑',
      loading: '載入中...',
      search_placeholder: '搜尋檔名 (Ctrl+F)...',
      search_clear_title: '清除搜尋',
      sort_name_asc: '檔名 (A - Z)',
      sort_name_desc: '檔名 (Z - A)',
      sort_date_desc: '修改時間 (新 → 舊)',
      sort_date_asc: '修改時間 (舊 → 新)',
      sort_size_desc: '檔案大小 (大 → 小)',
      sort_size_asc: '檔案大小 (小 → 大)',
      sort_dur_desc: '影片時長 (長 → 短)',
      sort_dur_asc: '影片時長 (短 → 長)',
      sort_title: '排序依據',
      slider_size_label: '尺寸',
      thumb_size_slider_title: '調整卡片縮圖大小 (支援 Ctrl + 滑鼠滾輪)',
      btn_thumb_toggle_title: '縮圖生成開關 (T)',
      btn_thumb_toggle_title_on: '縮圖生成開關：目前開啟（快捷鍵 T，點擊關閉可極速載入大量檔案且 0 負擔）',
      btn_thumb_toggle_title_off: '縮圖生成開關：目前關閉（快捷鍵 T，點擊開啟縮圖生成）',
      btn_thumb_toggle_text: '縮圖',
      btn_recursive_title: '包含子資料夾中的所有影片',
      btn_recursive_title_on: '目前：包含子資料夾（點擊切換為僅當前資料夾）',
      btn_recursive_title_off: '目前：僅當前資料夾（點擊切換為搜尋子資料夾）',
      btn_recursive_text: '子資料夾',
      btn_refresh_title: '重新掃描資料夾 (F5)',
      btn_refresh_text: '重新整理',
      btn_reveal_title: '在系統檔案總管中開啟此資料夾',
      btn_lang_toggle_title: 'Switch to English',
      btn_lang_indicator: 'EN',
      video_count_badge: '{count} 部影片',
      filter_count_badge: '已篩選: {count}',

      // 空狀態
      empty_title: '此資料夾內沒有支援的影片',
      empty_hint: '支援格式：MP4, WebM, MKV, MOV, AVI, WMV, FLV, M4V, TS, OGV 等。您可以嘗試開啟子資料夾搜尋或點擊重新整理。',

      // 底部浮動批量操作列
      batch_selected_count: '已選取 {count} 部',
      batch_copy_title: '複製選取影片的路徑 (每行一個)',
      batch_copy_text: '複製路徑',
      batch_delete_title: '將選取的影片移至資源回收筒',
      batch_delete_text: '刪除',
      batch_clear_title: '取消所有選取 (Esc)',

      // 畫廊卡片
      card_select_title: '選取此影片',
      card_copy_btn_title: '複製完整路徑',
      card_open_ext_title: '以系統播放器開啟 (O)',
      card_reveal_title: '在系統檔案總管中顯示',

      // 播放器工具列與控制
      player_loop_title: '循環播放開關 (R)',
      player_speed_title: '切換播放速度',
      player_select_and_close_title: '關閉播放器並在畫廊中選取此影片 (S / Enter)',
      player_close_title: '關閉播放器 (Esc / 右鍵)',
      player_prev_title: '上一部 (← / [)',
      player_next_title: '下一部 (→ / ])',
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
      toast_batch_copy_success: '已複製 {count} 個影片路徑',
      toast_open_external: '已透過系統播放器開啟：{file}',
      toast_open_selected_external: '已透過系統播放器開啟選取影片',
      toast_first_video: '已是第一部影片',
      toast_last_video: '已是最後一部影片',
      toast_play_error: '播放失敗：{desc}',
      toast_forward: '快進 +{sec}s',
      toast_rewind: '快退 {sec}s',
      toast_loop_on: '已開啟循環',
      toast_loop_off: '已關閉循環',
      toast_speed: '播放速度：{speed}x',
      toast_locate_success: '已在畫廊選取：{file}',
      toast_refresh_success: '已重新整理（共 {count} 部影片）',
      toast_lang_switched: '已切換為繁體中文介面',
      toast_thumb_lazy: '已開啟縮圖生成',
      toast_thumb_disabled: '已關閉縮圖生成（極速輕量模式）',
      toast_controls_pinned: '控制列已鎖定固定（不自動隱藏）',
      toast_controls_autohide: '已恢復自動隱藏（無操作時自動隱藏）'
    },
    'en': {
      // Top Toolbar
      folder_path_title: 'Folder Path',
      loading: 'Loading...',
      search_placeholder: 'Search video file name (Ctrl+F)...',
      search_clear_title: 'Clear search',
      sort_name_asc: 'File Name (A - Z)',
      sort_name_desc: 'File Name (Z - A)',
      sort_date_desc: 'Modified Time (New to Old)',
      sort_date_asc: 'Modified Time (Old to New)',
      sort_size_desc: 'Size (Large to Small)',
      sort_size_asc: 'Size (Small to Large)',
      sort_dur_desc: 'Duration (Long to Short)',
      sort_dur_asc: 'Duration (Short to Long)',
      sort_title: 'Sort by',
      slider_size_label: 'Size',
      thumb_size_slider_title: 'Adjust thumbnail size (Ctrl + Mouse Wheel)',
      btn_thumb_toggle_title: 'Thumbnail Toggle (T)',
      btn_thumb_toggle_title_on: 'Thumbnails: Currently Enabled (Shortcut T, click to disable for instant opening)',
      btn_thumb_toggle_title_off: 'Thumbnails: Currently Disabled (Shortcut T, click to enable thumbnails)',
      btn_thumb_toggle_text: 'Thumb',
      btn_recursive_title: 'Include all videos in subfolders',
      btn_recursive_title_on: 'Current: Including subfolders (Click to switch to current folder only)',
      btn_recursive_title_off: 'Current: Current folder only (Click to search subfolders)',
      btn_recursive_text: 'Subfolders',
      btn_refresh_title: 'Rescan folder (F5)',
      btn_refresh_text: 'Refresh',
      btn_reveal_title: 'Reveal this folder in System File Explorer',
      btn_lang_toggle_title: '切換至繁體中文',
      btn_lang_indicator: '中',
      video_count_badge: '{count} Videos',
      filter_count_badge: 'Filtered: {count}',

      // Empty State
      empty_title: 'No supported video files in this folder',
      empty_hint: 'Supported formats: MP4, WebM, MKV, MOV, AVI, WMV, FLV, M4V, TS, OGV, etc. Try enabling subfolder search or clicking Refresh.',

      // Batch Action Bar
      batch_selected_count: '{count} selected',
      batch_copy_title: 'Copy absolute paths of selected videos (one per line)',
      batch_copy_text: 'Copy Paths',
      batch_delete_title: 'Move selected files to System Trash',
      batch_delete_text: 'Delete',
      batch_clear_title: 'Clear all selections (Esc)',

      // Gallery Cards
      card_select_title: 'Select video',
      card_copy_btn_title: 'Copy full path',
      card_open_ext_title: 'Open with system player (O)',
      card_reveal_title: 'Reveal in System File Explorer',

      // Player Toolbar & Controls
      player_loop_title: 'Toggle loop playback (R)',
      player_speed_title: 'Change playback speed',
      player_select_and_close_title: 'Close player and select this video in gallery (S / Enter)',
      player_close_title: 'Close player (Esc / Right-click)',
      player_prev_title: 'Previous (← / [)',
      player_next_title: 'Next (→ / ])',
      ctrl_progress_title: 'Seek (Click or Drag)',
      ctrl_play_pause_title: 'Play / Pause (Space)',
      ctrl_rewind_title: 'Rewind 5s (J / ←)',
      ctrl_forward_title: 'Forward 5s (L / →)',
      ctrl_mute_title: 'Mute toggle (M)',
      ctrl_volume_title: 'Volume adjustment (Wheel or ↑/↓)',
      ctrl_open_external_title: 'Open with system player (O)',
      ctrl_hide_title: 'Hide Controller (H, Right-click to pin)',

      // Toasts
      toast_copy_success: 'Path copied: {file}',
      toast_batch_copy_success: 'Copied absolute paths of {count} files',
      toast_open_external: 'Opened with system player: {file}',
      toast_open_selected_external: 'Opened selected video with system player',
      toast_first_video: 'Already the first video',
      toast_last_video: 'Already the last video',
      toast_play_error: 'Playback error: {desc}',
      toast_forward: 'Forward +{sec}s',
      toast_rewind: 'Rewind {sec}s',
      toast_loop_on: 'Loop enabled',
      toast_loop_off: 'Loop disabled',
      toast_speed: 'Playback speed: {speed}x',
      toast_locate_success: 'Selected in gallery: {file}',
      toast_refresh_success: 'Refreshed ({count} videos total)',
      toast_lang_switched: 'Switched to English interface',
      toast_thumb_lazy: 'Thumbnails enabled',
      toast_thumb_disabled: 'Thumbnails disabled (lightweight mode)',
      toast_controls_pinned: 'Controls pinned (Auto-hide disabled)',
      toast_controls_autohide: 'Auto-hide restored'
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LOCALES;
  }
  if (typeof window !== 'undefined') {
    window.LOCALES = LOCALES;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.LOCALES = LOCALES;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
