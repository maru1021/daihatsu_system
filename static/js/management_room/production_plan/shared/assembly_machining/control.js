// ========================================
// 組付・加工系生産計画の共通制御関数
// ========================================
// このファイルは組付と加工の生産計画で共通して使用される制御関数を定義します

import { CELL_TEXT } from './constants.js';

/**
 * チェックセルの切り替え（組付専用）
 *
 * @param {HTMLElement} element - チェックセル要素
 * @param {Function} updateWorkingDayStatusCallback - 稼働日状態更新のコールバック関数
 */
export function toggleCheck(element, updateWorkingDayStatusCallback) {
    const isWeekend = element.getAttribute('data-weekend') === 'true';
    const currentText = element.textContent;

    const newText = currentText === '' ? (isWeekend ? CELL_TEXT.WEEKEND_WORK : CELL_TEXT.REGULAR) : '';
    element.textContent = newText;

    // data-regular-hours属性を更新
    element.setAttribute('data-regular-hours', newText === CELL_TEXT.REGULAR ? 'true' : 'false');

    const dateIndex = Array.from(element.parentElement.children).indexOf(element) - 1;

    // 稼働日状態を更新（コールバック関数を呼び出し）
    if (updateWorkingDayStatusCallback) {
        updateWorkingDayStatusCallback(dateIndex);
    }
}
