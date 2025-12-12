// ========================================
// 組付・加工系生産計画のナビゲーション関数
// ========================================
// このファイルは組付と加工の生産計画で共通して使用されるナビゲーション関数を定義します

/**
 * ライン選択変更ハンドラーを作成するファクトリー関数
 *
 * @param {string} paramName - URLパラメータ名（'line' or 'line_name'）
 * @returns {Function} ライン選択変更ハンドラー
 */
export function createHandleLineChange(paramName = 'line') {
    return function handleLineChange() {
        const lineValue = $('#line-select').val();
        const targetMonth = $('#target-month').val();
        if (lineValue && targetMonth) {
            const [year, month] = targetMonth.split('-');
            if (paramName === 'line_name') {
                window.location.href = `?${paramName}=${encodeURIComponent(lineValue)}&year=${year}&month=${month}`;
            } else {
                window.location.href = `?${paramName}=${lineValue}&year=${year}&month=${month}`;
            }
        }
    };
}

/**
 * 月選択変更ハンドラーを作成するファクトリー関数
 *
 * @param {string} paramName - URLパラメータ名（'line' or 'line_name'）
 * @returns {Function} 月選択変更ハンドラー
 */
export function createHandleMonthChange(paramName = 'line') {
    return function handleMonthChange() {
        const lineValue = $('#line-select').val();
        const targetMonth = $('#target-month').val();
        if (lineValue && targetMonth) {
            const [year, month] = targetMonth.split('-');
            if (paramName === 'line_name') {
                window.location.href = `?${paramName}=${encodeURIComponent(lineValue)}&year=${year}&month=${month}`;
            } else {
                window.location.href = `?${paramName}=${lineValue}&year=${year}&month=${month}`;
            }
        }
    };
}
