/**
 * AI 上下文檢視器 - 多國語言字典 (locales.js)
 * 支援：zh-TW (繁體中文), en (English)
 * 規範：僅限於工具介面 (UI Chrome) 翻譯，100% 不干擾使用者專案資料、路徑、規範與技能名稱
 */
(function (root) {
  const LOCALES = {
    'zh-TW': {
      // 頂部 Header
      header_title: 'AI 上下文檢視器',
      btn_collapse_all_title: '摺疊全部卡片',
      btn_expand_all_title: '展開全部卡片',
      btn_copy_summary_title: '複製當前上下文摘要',
      btn_refresh_title: '重新整理',
      btn_lang_toggle_title: 'Switch to English',
      btn_lang_indicator: 'EN',

      // 模式切換按鈕方陣
      btn_mode_live: '當前環境配置',
      btn_mode_snapshot: '最近對話快照',

      // 歷史對話快照下拉選擇器
      custom_conv_trigger_title: '點擊選擇歷史對話快照',
      trigger_conv_loading: '載入對話快照中...',
      conv_search_placeholder: '搜尋對話主題、關鍵字或短 ID...',
      btn_clear_search_title: '清除搜尋',
      pills_label: '筆數:',
      pill_limit_all: '全',
      meta_model_label: '對話使用模型:',
      conv_item_ws_prefix: '工作區：',

      // 狀態列
      status_mode_live: '模式：環境即時掃描',
      status_mode_snapshot: '模式：對話已調用快照',

      // 卡片 1：常駐規範
      card_rules_active_title: '常駐規範 (Always-Active)',
      btn_title_mode_title: '內文標題',
      btn_title_mode_title_tooltip: '目前顯示：內文標題（點擊切換為：檔案名稱）',
      btn_title_mode_name: '檔案名稱',
      btn_title_mode_name_tooltip: '目前顯示：檔案名稱（點擊切換為：內文標題）',

      // 卡片 2：條件式規範
      card_rules_conditional_title: '條件式規範 (Conditional)',

      // 卡片 3：技能清單
      card_skills_title: '技能清單 (Skills)',
      btn_title_mode_skill_title_tooltip: '目前顯示：內文標題（點擊切換為：技能名稱）',
      btn_title_mode_skill_name: '技能名稱',
      btn_title_mode_skill_name_tooltip: '目前顯示：技能名稱（點擊切換為：內文標題）',
      group_skills_workspace: '工作區專屬技能 ({count})',
      group_skills_global: '全域客製技能 ({count})',
      group_skills_builtin: 'IDE 內建技能 ({count})',

      // 卡片 4：MCP 伺服器
      card_mcp_title: 'MCP 伺服器與 API',
      btn_open_mcp_dir: '開啟',
      btn_open_mcp_dir_title: '開啟 MCP 存放資料夾 (C:\\Users\\User\\.gemini\\antigravity-ide\\mcp)',

      // 卡片子項目通用動作按鈕
      btn_copy_name: '複製名稱',
      btn_copy_rule_name_title: '複製規範名稱：{name}',
      btn_copy_skill_name_title: '複製技能名稱：{name}',
      btn_reveal_path: '跳轉',
      btn_reveal_rule_title: '在檔案總管中選取此檔案',
      btn_reveal_skill_title: '在檔案總管中選取此技能資料夾',
      btn_open_file: '開啟',
      btn_open_rule_title: '在編輯器中開啟',
      btn_open_skill_title: '在編輯器中開啟 SKILL.md',
      tag_source_title: '所屬專案：{source}',
      desc_none: '無描述',

      // 單位與計數
      unit_items: '{count} 項',
      unit_servers: '{count} 個',
      unit_apis: '{count} 個 API',

      // 空狀態提示 (Empty States)
      empty_rules_active_snapshot: '此對話無常駐規範',
      empty_rules_active_live: '無常駐規範',
      empty_rules_cond_snapshot: '此對話未觸發條件式規範',
      empty_rules_cond_live: '無條件式規範',
      empty_skills_snapshot: '此對話未調用額外技能',
      empty_skills_live: '無可用技能',
      empty_mcp_snapshot: '此對話未調用 MCP 工具',
      empty_mcp_live: '無註冊之 MCP 伺服器',
      conv_empty_none: '無任何歷史對話記錄',
      conv_empty_search: '找不到符合的歷史對話快照',
      conv_empty_no_tasks: '無對話任務記錄',

      // Toast 提示訊息
      toast_refreshed: '已重新整理 AI 上下文狀態',
      toast_copied_summary: '已複製上下文摘要至剪貼簿',
      toast_copied_item: '已複製 {label}: {text}',
      toast_copy_failed: '複製失敗: {error}',
      toast_limit_changed: '已切換顯示最近 {limit} 對話',
      toast_limit_all: '全部',
      toast_limit_items: '{count} 筆',
      toast_lang_switched: '已切換為繁體中文',

      // 時間與雜項
      time_today: '今天 {time}',
      conv_snapshot_fallback: '對話快照 ({id})'
    },

    'en': {
      // Top Header
      header_title: 'AI Context Inspector',
      btn_collapse_all_title: 'Collapse All Cards',
      btn_expand_all_title: 'Expand All Cards',
      btn_copy_summary_title: 'Copy Current Context Summary',
      btn_refresh_title: 'Refresh',
      btn_lang_toggle_title: '切換為繁體中文',
      btn_lang_indicator: '中',

      // Mode Switch Grid
      btn_mode_live: 'Live Environment',
      btn_mode_snapshot: 'Recent Snapshot',

      // Conversation Snapshot Custom Dropdown
      custom_conv_trigger_title: 'Click to select conversation snapshot',
      trigger_conv_loading: 'Loading snapshots...',
      conv_search_placeholder: 'Search title, keyword or ID...',
      btn_clear_search_title: 'Clear search',
      pills_label: 'Limit:',
      pill_limit_all: 'All',
      meta_model_label: 'Model:',
      conv_item_ws_prefix: 'Workspace: ',

      // Status Bar
      status_mode_live: 'Mode: Live Environment Scan',
      status_mode_snapshot: 'Mode: Conversation Snapshot',

      // Card 1: Always-Active Rules
      card_rules_active_title: 'Always-Active Rules',
      btn_title_mode_title: 'Doc Title',
      btn_title_mode_title_tooltip: 'Currently: Doc Title (Click to switch to File Name)',
      btn_title_mode_name: 'File Name',
      btn_title_mode_name_tooltip: 'Currently: File Name (Click to switch to Doc Title)',

      // Card 2: Conditional Rules
      card_rules_conditional_title: 'Conditional Rules',

      // Card 3: Skills List
      card_skills_title: 'Skills',
      btn_title_mode_skill_title_tooltip: 'Currently: Doc Title (Click to switch to Skill Name)',
      btn_title_mode_skill_name: 'Skill Name',
      btn_title_mode_skill_name_tooltip: 'Currently: Skill Name (Click to switch to Doc Title)',
      group_skills_workspace: 'Workspace Skills ({count})',
      group_skills_global: 'Global Skills ({count})',
      group_skills_builtin: 'Built-in Skills ({count})',

      // Card 4: MCP Servers
      card_mcp_title: 'MCP Servers & Tools',
      btn_open_mcp_dir: 'Open',
      btn_open_mcp_dir_title: 'Open MCP Storage Folder (C:\\Users\\User\\.gemini\\antigravity-ide\\mcp)',

      // Item Actions
      btn_copy_name: 'Copy Name',
      btn_copy_rule_name_title: 'Copy rule name: {name}',
      btn_copy_skill_name_title: 'Copy skill name: {name}',
      btn_reveal_path: 'Reveal',
      btn_reveal_rule_title: 'Reveal file in File Explorer',
      btn_reveal_skill_title: 'Reveal skill folder in File Explorer',
      btn_open_file: 'Open',
      btn_open_rule_title: 'Open in editor',
      btn_open_skill_title: 'Open SKILL.md in editor',
      tag_source_title: 'Project: {source}',
      desc_none: 'No description',

      // Units & Counts
      unit_items: '{count} items',
      unit_servers: '{count} servers',
      unit_apis: '{count} APIs',

      // Empty States
      empty_rules_active_snapshot: 'No active rules in this conversation',
      empty_rules_active_live: 'No active rules',
      empty_rules_cond_snapshot: 'No conditional rules triggered in this conversation',
      empty_rules_cond_live: 'No conditional rules',
      empty_skills_snapshot: 'No skills invoked in this conversation',
      empty_skills_live: 'No available skills',
      empty_mcp_snapshot: 'No MCP tools invoked in this conversation',
      empty_mcp_live: 'No registered MCP servers',
      conv_empty_none: 'No conversation history',
      conv_empty_search: 'No matching conversation snapshots found',
      conv_empty_no_tasks: 'No conversation tasks',

      // Toast Notifications
      toast_refreshed: 'AI Context Inspector refreshed',
      toast_copied_summary: 'Copied context summary to clipboard',
      toast_copied_item: 'Copied {label}: {text}',
      toast_copy_failed: 'Copy failed: {error}',
      toast_limit_changed: 'Showing recent {limit} conversations',
      toast_limit_all: 'All',
      toast_limit_items: '{count} items',
      toast_lang_switched: 'Switched to English',

      // Time & Misc
      time_today: 'Today {time}',
      conv_snapshot_fallback: 'Snapshot ({id})'
    }
  };

  // 跨環境安全匯出 (支援 Webview 全域變數)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LOCALES;
  }
  if (typeof window !== 'undefined') {
    window.LOCALES = LOCALES;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.LOCALES = LOCALES;
  }
})(typeof self !== 'undefined' ? self : this);
