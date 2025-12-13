// ========================================
// 組付・加工系生産計画モジュール - エントリーポイント
// ========================================
// このファイルから全ての機能をインポートして使用します
//
// 使用例:
// <script type="module">
//   import * as AssemblyMachiningCommon from './shared/assembly_machining/index.js';
//   const { REGULAR_TIME_DAY, debounce, getItemNames } = AssemblyMachiningCommon;
// </script>

// 定数
export * from './constants.js';

// ユーティリティ関数
export * from './utils.js';

// 制御関数
export * from './control.js';

// ナビゲーション関数
export * from './navigation.js';

// 合計計算関数
export * from './totals.js';

// 共通モジュール (鋳造・加工・組付・CVTで共有)
export {
    setupRowHover,
    setupColumnHover,
    addDateHighlight,
    removeDateHighlight,
    OVERTIME_MAX_DAY,
    OVERTIME_MAX_NIGHT
} from '../common.js';
