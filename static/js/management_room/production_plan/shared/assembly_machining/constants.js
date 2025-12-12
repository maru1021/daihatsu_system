// ========================================
// 組付・加工系生産計画の共通定数
// ========================================
// このファイルは組付と加工の生産計画で共通して使用される定数を定義します

// 定時時間（分）
export const REGULAR_TIME_DAY = 455;    // 日勤の定時時間
export const REGULAR_TIME_NIGHT = 450;  // 夜勤の定時時間

// 残業上限（分）
export const OVERTIME_MAX_DAY = 120;    // 日勤の残業上限
export const OVERTIME_MAX_NIGHT = 60;   // 夜勤の残業上限

// その他の定数
export const OVERTIME_ROUND_MINUTES = 5;              // 残業時間の丸め単位（分）
export const OVERTIME_CONSTRAINT_THRESHOLD = 5;       // 残業時間の均等制約閾値（分）
export const NIGHT_SHIFT_UNIFORM_THRESHOLD = 60;      // 夜勤の均等配分閾値（分）
export const STOP_TIME_MAX = 480;                     // 計画停止の上限（分）
export const DEBOUNCE_DELAY = 100;                    // デバウンス遅延時間（ミリ秒）
export const STOCK_UPDATE_DELAY = 150;                // 在庫更新遅延時間（ミリ秒）
export const MAX_ADJUSTMENT_ROUNDS = 3;               // 微調整の最大反復回数
export const MAX_OVERTIME_ADJUST_ROUNDS = 100;        // 残業調整の最大ループ回数

// シフト定数
export const SHIFT = {
    DAY: 'day',
    NIGHT: 'night'
};

// セル表示文字列
export const CELL_TEXT = {
    REGULAR: '定時',
    WEEKEND_WORK: '休出'
};

// スタイル定数
export const STYLE = {
    UNDER_REGULAR_TIME_BG: '#fef9c3',          // 定時未満の背景色（薄い黄色）
    MONTHLY_PLAN_OVER_BG: '#fef9c3',           // 月別計画超過の背景色
    MONTHLY_PLAN_UNDER_BG: '#fee2e2',          // 月別計画未達の背景色
    DAILY_TOTAL_BG: '#e0f2fe'                  // 日別合計の背景色
};
