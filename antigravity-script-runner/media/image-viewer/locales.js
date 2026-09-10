/**
 * 內容區圖片檢視器 - 多國語言字典 (locales.js)
 * 支援：zh-TW (繁體中文), en (English)
 * 規範：僅限於工具介面 (UI Chrome) 翻譯，不干擾檔案名稱與實際路徑
 */
(function (root) {
  const LOCALES = {
    'zh-TW': {
      // 工具列頂部
      folder_path_title: '資料夾路徑',
      loading: '載入中...',
      img_count_badge: '{count} 張圖片',
      filter_count_badge: '已篩選: {count}',
      search_placeholder: '搜尋檔名...',
      search_clear_title: '清除搜尋',
      sort_select_title: '排序依據',
      sort_name_asc: '檔名 (A - Z)',
      sort_name_desc: '檔名 (Z - A)',
      sort_size_desc: '大小 (大到小)',
      sort_size_asc: '大小 (小到大)',
      sort_date_desc: '時間 (新到舊)',
      sort_date_asc: '時間 (舊到新)',
      slider_size_label: '尺寸',
      slider_size_title: '調整縮圖尺寸 (110px - 360px，支援 Ctrl + 滑鼠滾輪)',
      btn_recursive: '子資料夾',
      btn_recursive_title_on: '目前：包含子資料夾（點擊切換為僅當前資料夾）',
      btn_recursive_title_off: '目前：僅當前資料夾（點擊切換為搜尋子資料夾）',
      btn_refresh: '重新整理',
      btn_refresh_title: '重新掃描資料夾 (F5)',
      btn_reveal_folder_title: '在系統檔案總管中開啟此資料夾',
      btn_lang_toggle_title: 'Switch to English',
      btn_lang_indicator: 'EN',

      // 空狀態
      empty_folder_title: '此資料夾內沒有支援的圖片檔案',
      empty_folder_desc: '支援格式：PNG, JPG, WebP, GIF, SVG, BMP, ICO, AVIF, TIFF 等。您可以嘗試開啟子資料夾搜尋或按重新整理。',
      empty_filter_title: '找不到符合關鍵字的圖片',
      empty_filter_desc: '搜尋條件「{query}」未匹配到任何圖片，請嘗試其他關鍵字。',

      // 卡片動作
      card_select_title: '選取圖片 (Shift+點選加選)',
      card_locate_ide_title: '跳轉到檔案總管',
      card_reveal_title: '在系統檔案總管顯示',
      card_copy_path_title: '複製路徑',
      card_path_prefix: '路徑: ',

      // 底部批量操作
      batch_selected_count: '已選取 {count} 張',
      batch_copy_paths: '複製路徑',
      batch_copy_paths_title: '複製選取圖片的絕對路徑列表（每行一個路徑，適合貼到 AI 對話）',
      batch_rotate_cw: '順時針 90°',
      batch_rotate_cw_title: '順時針旋轉 90 度 (覆蓋實體檔案)',
      batch_rotate_ccw: '逆時針 90°',
      batch_rotate_ccw_title: '逆時針旋轉 90 度 (覆蓋實體檔案)',
      batch_delete: '刪除',
      batch_delete_title: '將選取檔案移至系統資源回收筒',
      batch_clear_title: '取消所有選取 (Esc)',

      // Lightbox 大圖檢視器
      lightbox_zoom_out_title: '縮小 (滾輪向下 / -)',
      lightbox_zoom_in_title: '放大 (滾輪向上 / +)',
      lightbox_zoom_fit_title: '最適視窗大小 (雙擊滑鼠)',
      lightbox_zoom_actual_title: '1:1 原始解析度',
      lightbox_select_close_title: '關閉檢視器並在畫廊中選取此圖片 (S / Enter)',
      lightbox_delete_title: '刪除此圖片 (Delete)',
      lightbox_close_title: '關閉檢視器 (Esc / 右鍵)',
      lightbox_prev_title: '上一張 (← 鍵)',
      lightbox_next_title: '下一張 (→ 鍵)',
      lightbox_first_image: '已是第一張圖片',
      lightbox_last_image: '已是最後一張圖片',
      lightbox_meta_loading: '載入中... • {size}',
      lightbox_meta_dim: '{width} × {height} px • {size}',

      // Toast 提示
      toast_path_copied: '已複製路徑：{name}',
      toast_batch_copied: '已複製 {count} 個檔案之絕對路徑',
      toast_selected_in_gallery: '已在畫廊中選取：{name}',
      toast_refresh_done: '已重新整理（共 {count} 張圖片）',
      toast_rotating_prep: '正在準備旋轉 {count} 張圖片...',
      toast_rotating_progress: '正在旋轉圖片 ({current}/{total})：{name}',
      toast_rotate_saving: '正在儲存 {count} 張圖片（已略過 {skipped} 個不支援旋轉之檔案）',
      toast_rotate_not_supported: '所選的檔案均不支援物理旋轉（如 SVG 向量或 GIF 動態圖）',
      toast_rotate_failed: '旋轉未能完成',
      toast_lang_switched: '已切換為繁體中文介面'
    },
    'en': {
      // 工具列頂部
      folder_path_title: 'Folder Path',
      loading: 'Loading...',
      img_count_badge: '{count} Images',
      filter_count_badge: 'Filtered: {count}',
      search_placeholder: 'Search file names...',
      search_clear_title: 'Clear search',
      sort_select_title: 'Sort by',
      sort_name_asc: 'File Name (A - Z)',
      sort_name_desc: 'File Name (Z - A)',
      sort_size_desc: 'Size (Large to Small)',
      sort_size_asc: 'Size (Small to Large)',
      sort_date_desc: 'Modified Time (New to Old)',
      sort_date_asc: 'Modified Time (Old to New)',
      slider_size_label: 'Size',
      slider_size_title: 'Adjust thumbnail size (110px - 360px, Ctrl + Mouse Wheel)',
      btn_recursive: 'Subfolders',
      btn_recursive_title_on: 'Current: Including subfolders (Click to switch to current folder only)',
      btn_recursive_title_off: 'Current: Current folder only (Click to search subfolders)',
      btn_refresh: 'Refresh',
      btn_refresh_title: 'Rescan folder (F5)',
      btn_reveal_folder_title: 'Reveal this folder in System File Explorer',
      btn_lang_toggle_title: '切換至繁體中文',
      btn_lang_indicator: '中',

      // 空狀態
      empty_folder_title: 'No supported image files found in this folder',
      empty_folder_desc: 'Supported formats: PNG, JPG, WebP, GIF, SVG, BMP, ICO, AVIF, TIFF, etc. Try enabling subfolder search or clicking Refresh.',
      empty_filter_title: 'No matching images found',
      empty_filter_desc: 'Query "{query}" did not match any images. Please try other keywords.',

      // 卡片動作
      card_select_title: 'Select image (Shift + click to add)',
      card_locate_ide_title: 'Reveal in IDE Explorer',
      card_reveal_title: 'Reveal in System File Explorer',
      card_copy_path_title: 'Copy Path',
      card_path_prefix: 'Path: ',

      // 底部批量操作
      batch_selected_count: '{count} selected',
      batch_copy_paths: 'Copy Paths',
      batch_copy_paths_title: 'Copy absolute paths of selected images (one per line, ideal for AI chat)',
      batch_rotate_cw: 'Rotate CW 90°',
      batch_rotate_cw_title: 'Rotate clockwise 90 degrees (overwrites physical files)',
      batch_rotate_ccw: 'Rotate CCW 90°',
      batch_rotate_ccw_title: 'Rotate counter-clockwise 90 degrees (overwrites physical files)',
      batch_delete: 'Delete',
      batch_delete_title: 'Move selected files to System Trash',
      batch_clear_title: 'Clear all selections (Esc)',

      // Lightbox 大圖檢視器
      lightbox_zoom_out_title: 'Zoom Out (Wheel Down / -)',
      lightbox_zoom_in_title: 'Zoom In (Wheel Up / +)',
      lightbox_zoom_fit_title: 'Fit to Screen (Double Click)',
      lightbox_zoom_actual_title: '1:1 Actual Size',
      lightbox_select_close_title: 'Close viewer and select this image in gallery (S / Enter)',
      lightbox_delete_title: 'Delete this image (Delete)',
      lightbox_close_title: 'Close Viewer (Esc / Right Click)',
      lightbox_prev_title: 'Previous (Left Arrow)',
      lightbox_next_title: 'Next (Right Arrow)',
      lightbox_first_image: 'Already the first image',
      lightbox_last_image: 'Already the last image',
      lightbox_meta_loading: 'Loading... • {size}',
      lightbox_meta_dim: '{width} × {height} px • {size}',

      // Toast 提示
      toast_path_copied: 'Copied path: {name}',
      toast_batch_copied: 'Copied absolute paths of {count} files',
      toast_selected_in_gallery: 'Selected in gallery: {name}',
      toast_refresh_done: 'Refreshed ({count} images)',
      toast_rotating_prep: 'Preparing to rotate {count} images...',
      toast_rotating_progress: 'Rotating image ({current}/{total}): {name}',
      toast_rotate_saving: 'Saving {count} images (skipped {skipped} unsupported files)',
      toast_rotate_not_supported: 'Selected files do not support physical rotation (e.g. SVG or GIF)',
      toast_rotate_failed: 'Rotation could not be completed',
      toast_lang_switched: 'Switched to English interface'
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LOCALES;
  }
  if (root) {
    root.LOCALES = LOCALES;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
