// ========================================
// 組付・加工系生産計画の共通制御関数
// ========================================
// このファイルは組付と加工の生産計画で共通して使用される制御関数を定義します

import { CELL_TEXT } from './constants.js';
import { getInputElement } from './utils.js';

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

/**
 * 残業上限を設定（汎用版）
 *
 * 機能:
 * - 残業入力のmax属性を設定
 * - 上限が0の場合は値を0にクリア
 * - プログラマティック変更フラグを設定（inputイベント抑制用）
 *
 * @param {number} dateIndex - 日付インデックス
 * @param {string} shift - シフト（'day' または 'night'）
 * @param {number|null} max - 残業上限（nullの場合は上限を解除）
 * @param {Object} options - オプション設定
 * @param {number|null} options.lineIndex - ラインインデックス（デフォルト: null）
 */
export function setOvertimeLimit(dateIndex, shift, max, options = {}) {
    const { lineIndex = null } = options;

    let selector = `.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`;
    if (lineIndex !== null) {
        selector += `[data-line-index="${lineIndex}"]`;
    }

    const input = getInputElement(selector);
    if (input) {
        if (max !== null) {
            input.setAttribute('max', max);
            if (max === 0 && input.value !== '0') {
                // プログラマティック変更フラグを設定（inputイベント抑制用）
                input.dataset.programmaticChange = 'true';
                input.value = '0';
                setTimeout(() => delete input.dataset.programmaticChange, 0);
            }
        } else {
            input.removeAttribute('max');
        }
    }
}

/**
 * 入力フィールドの表示/非表示を制御（汎用版）
 *
 * 機能:
 * - input要素の表示/非表示を制御
 * - 在庫表示（span要素）の制御（オプション）
 * - 非表示時に値を0にクリア
 *
 * @param {number} dateIndex - 日付インデックス
 * @param {string} shift - シフト（'day' または 'night'）
 * @param {boolean} show - 表示する場合はtrue、非表示にする場合はfalse
 * @param {Object} options - オプション設定
 * @param {number|null} options.lineIndex - ラインインデックス（デフォルト: null、加工側では必須）
 * @param {boolean} options.includeStockDisplay - 在庫表示も制御する場合はtrue（デフォルト: false、加工側ではtrue推奨）
 */
export function toggleInputs(dateIndex, shift, show, options = {}) {
    const { lineIndex = null, includeStockDisplay = false } = options;

    // input要素を直接セレクト（親要素経由ではなく、input自体のdata属性で絞り込む）
    let selector = `input[data-shift="${shift}"][data-date-index="${dateIndex}"]`;
    if (lineIndex !== null) {
        selector += `[data-line-index="${lineIndex}"]`;
    }

    document.querySelectorAll(selector).forEach(input => {
        // 残業inputは除外（updateOvertimeInputVisibility()で制御）
        if (input.classList.contains('overtime-input')) {
            return;
        }

        // 非表示時は値を0にクリア
        if (!show) {
            input.value = 0;
        }
        input.style.display = show ? '' : 'none';
    });

    // 在庫表示（span要素）の制御（加工用）
    if (includeStockDisplay) {
        let stockSelector = `.stock-display[data-shift="${shift}"][data-date-index="${dateIndex}"]`;
        if (lineIndex !== null) {
            stockSelector += `[data-line-index="${lineIndex}"]`;
        }
        document.querySelectorAll(stockSelector).forEach(display => {
            if (!show) {
                display.textContent = '';
            }
            display.style.display = show ? '' : 'none';
        });
    }
}

/**
 * 残業inputの表示/非表示を制御（汎用版）
 *
 * 機能:
 * - 週末（休出なし）: 日勤・夜勤とも非表示
 * - 休出: 日勤・夜勤とも非表示
 * - 定時: 日勤のみ非表示、夜勤は表示
 * - 通常: すべて表示
 * - 計画停止時間の制御（オプション）
 *
 * @param {Object} options - オプション設定
 * @param {boolean} options.includeStopTime - 計画停止時間も制御する場合はtrue（デフォルト: false）
 */
export function updateOvertimeInputVisibility(options = {}) {
    const { includeStopTime = false } = options;

    const checkCells = document.querySelectorAll('.check-cell');

    checkCells.forEach((checkCell) => {
        const dateIndex = parseInt(checkCell.getAttribute('data-date-index'));
        const lineIndex = checkCell.hasAttribute('data-line-index')
            ? parseInt(checkCell.getAttribute('data-line-index'))
            : null;
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const checkText = checkCell.textContent.trim();
        const isHolidayWork = checkText === CELL_TEXT.WEEKEND_WORK;
        const isRegularTime = checkText === CELL_TEXT.REGULAR;

        // 残業inputを取得（lineIndexの有無で分岐）
        let dayOvertimeSelector = `.overtime-input[data-shift="day"][data-date-index="${dateIndex}"]`;
        let nightOvertimeSelector = `.overtime-input[data-shift="night"][data-date-index="${dateIndex}"]`;
        if (lineIndex !== null) {
            dayOvertimeSelector += `[data-line-index="${lineIndex}"]`;
            nightOvertimeSelector += `[data-line-index="${lineIndex}"]`;
        }

        const dayOvertimeInputs = document.querySelectorAll(dayOvertimeSelector);
        const nightOvertimeInputs = document.querySelectorAll(nightOvertimeSelector);

        if (isWeekend && !isHolidayWork) {
            // 週末で休出がついていない場合：日勤・夜勤両方とも非表示
            dayOvertimeInputs.forEach(input => {
                input.style.display = 'none';
                input.value = 0;
            });
            nightOvertimeInputs.forEach(input => {
                input.style.display = 'none';
                input.value = 0;
            });

            // 計画停止時間も非表示（加工用）
            if (includeStopTime) {
                let dayStopTimeSelector = `.stop-time-input[data-shift="day"][data-date-index="${dateIndex}"]`;
                let nightStopTimeSelector = `.stop-time-input[data-shift="night"][data-date-index="${dateIndex}"]`;
                if (lineIndex !== null) {
                    dayStopTimeSelector += `[data-line-index="${lineIndex}"]`;
                    nightStopTimeSelector += `[data-line-index="${lineIndex}"]`;
                }

                const dayStopTimeInputs = document.querySelectorAll(dayStopTimeSelector);
                const nightStopTimeInputs = document.querySelectorAll(nightStopTimeSelector);

                dayStopTimeInputs.forEach(input => {
                    input.style.display = 'none';
                    input.value = 0;
                });
                nightStopTimeInputs.forEach(input => {
                    input.style.display = 'none';
                    input.value = 0;
                });
            }
        } else if (isHolidayWork) {
            // 休出の場合：日勤・夜勤両方とも非表示
            dayOvertimeInputs.forEach(input => {
                input.style.display = 'none';
                input.value = 0;
            });
            nightOvertimeInputs.forEach(input => {
                input.style.display = 'none';
                input.value = 0;
            });

            // 計画停止時間は表示（加工用）
            if (includeStopTime) {
                let dayStopTimeSelector = `.stop-time-input[data-shift="day"][data-date-index="${dateIndex}"]`;
                let nightStopTimeSelector = `.stop-time-input[data-shift="night"][data-date-index="${dateIndex}"]`;
                if (lineIndex !== null) {
                    dayStopTimeSelector += `[data-line-index="${lineIndex}"]`;
                    nightStopTimeSelector += `[data-line-index="${lineIndex}"]`;
                }

                const dayStopTimeInputs = document.querySelectorAll(dayStopTimeSelector);
                const nightStopTimeInputs = document.querySelectorAll(nightStopTimeSelector);

                dayStopTimeInputs.forEach(input => {
                    input.style.display = '';
                });
                nightStopTimeInputs.forEach(input => {
                    input.style.display = 'none';
                    input.value = 0;
                });
            }
        } else if (isRegularTime) {
            // 定時の場合：日勤のみ非表示、夜勤は表示
            dayOvertimeInputs.forEach(input => {
                input.style.display = 'none';
                input.value = 0;
            });
            nightOvertimeInputs.forEach(input => {
                input.style.display = '';
            });

            // 計画停止時間は両方表示（加工用）
            if (includeStopTime) {
                let dayStopTimeSelector = `.stop-time-input[data-shift="day"][data-date-index="${dateIndex}"]`;
                let nightStopTimeSelector = `.stop-time-input[data-shift="night"][data-date-index="${dateIndex}"]`;
                if (lineIndex !== null) {
                    dayStopTimeSelector += `[data-line-index="${lineIndex}"]`;
                    nightStopTimeSelector += `[data-line-index="${lineIndex}"]`;
                }

                const dayStopTimeInputs = document.querySelectorAll(dayStopTimeSelector);
                const nightStopTimeInputs = document.querySelectorAll(nightStopTimeSelector);

                dayStopTimeInputs.forEach(input => {
                    input.style.display = '';
                });
                nightStopTimeInputs.forEach(input => {
                    input.style.display = '';
                });
            }
        } else {
            // それ以外は両方表示
            dayOvertimeInputs.forEach(input => {
                input.style.display = '';
            });
            nightOvertimeInputs.forEach(input => {
                input.style.display = '';
            });

            // 計画停止時間も両方表示（加工用）
            if (includeStopTime) {
                let dayStopTimeSelector = `.stop-time-input[data-shift="day"][data-date-index="${dateIndex}"]`;
                let nightStopTimeSelector = `.stop-time-input[data-shift="night"][data-date-index="${dateIndex}"]`;
                if (lineIndex !== null) {
                    dayStopTimeSelector += `[data-line-index="${lineIndex}"]`;
                    nightStopTimeSelector += `[data-line-index="${lineIndex}"]`;
                }

                const dayStopTimeInputs = document.querySelectorAll(dayStopTimeSelector);
                const nightStopTimeInputs = document.querySelectorAll(nightStopTimeSelector);

                dayStopTimeInputs.forEach(input => {
                    input.style.display = '';
                });
                nightStopTimeInputs.forEach(input => {
                    input.style.display = '';
                });
            }
        }
    });
}
