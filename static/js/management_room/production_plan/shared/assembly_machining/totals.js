// ========================================
// 組付・加工系生産計画の合計計算関数
// ========================================
// このファイルは組付と加工の生産計画で共通して使用される合計計算関数を定義します

import {
    REGULAR_TIME_DAY,
    REGULAR_TIME_NIGHT,
    OVERTIME_MAX_DAY,
    OVERTIME_MAX_NIGHT,
    OVERTIME_ROUND_MINUTES
} from './constants.js';

import {
    getInputElement,
    getInputValue,
    getItemNames
} from './utils.js';

/**
 * セクションごとの合計を計算（汎用版）
 *
 * 機能:
 * - input要素またはspan要素の値を合計
 * - 月間合計セルに結果を表示
 * - 在庫差分セルの特別なスタイル対応
 *
 * @param {NodeList} rows - 対象行のNodeList
 * @param {string} elementClass - 集計対象要素のクラス名
 * @param {Object} options - オプション設定
 * @param {boolean} options.showZero - 合計が0の場合も表示するか（デフォルト: false）
 * @param {string} options.targetCellClass - 合計を表示するセルのクラス名（デフォルト: 'monthly-total'）
 */
export function calculateSectionTotal(rows, elementClass, options = {}) {
    const { showZero = false, targetCellClass = 'monthly-total' } = options;

    rows.forEach(row => {
        let total = 0;
        const elements = row.querySelectorAll(`.${elementClass}`);

        elements.forEach(element => {
            if (element.style.display !== 'none') {
                // input要素とspan要素の両方に対応
                const value = element.tagName === 'SPAN'
                    ? (parseInt(element.textContent) || 0)
                    : (parseInt(element.value) || 0);
                total += value;
            }
        });

        const targetCell = row.querySelector(`.${targetCellClass}`);
        if (targetCell) {
            targetCell.textContent = (total > 0 || showZero) ? total : '';
            targetCell.style.fontWeight = 'bold';
            targetCell.style.textAlign = 'center';

            // 在庫差分セルの特別なスタイル
            if (targetCellClass === 'stock-difference') {
                targetCell.style.backgroundColor = '#e0f2fe';
            }
        }
    });
}

/**
 * 生産数から残業時間を逆算（汎用版）
 *
 * 機能:
 * - 全品番の生産数合計から必要な残業時間を計算
 * - 定時/休出の場合の残業不可チェック
 * - 残業上限チェックとエラー表示
 *
 * @param {number} dateIndex - 日付インデックス
 * @param {string} shift - シフト（'day' または 'night'）
 * @param {string} itemName - 品番名（未使用だが互換性のため保持）
 * @param {Object} options - オプション設定
 * @param {number} options.lineIndex - ラインインデックス（デフォルト: 0）
 * @param {string} options.roundingMethod - 丸め方法（'round' または 'ceil'、デフォルト: 'round'）
 * @param {Object} options.linesItemData - ラインごとのアイテムデータ（加工用）
 * @param {Object} options.itemData - アイテムデータ（組付用）
 * @param {Function} options.showToast - トースト表示関数
 * @returns {boolean} 入力が許可される場合はtrue、拒否される場合はfalse
 */
export function recalculateOvertimeFromProduction(
    dateIndex,
    shift,
    itemName,
    options = {}
) {
    const {
        lineIndex = 0,
        roundingMethod = 'round',
        linesItemData = null,
        itemData = null,
        showToast = null
    } = options;

    // タクトを取得（加工はlinesItemData、組付はitemData）
    const data = linesItemData ? (linesItemData[lineIndex] || {}) : (itemData || {});
    const tact = data.tact || 0;
    if (tact === 0) return true;

    // 稼働率入力の取得
    let occupancyRateSelector = `.operation-rate-input[data-date-index="${dateIndex}"]`;
    if (linesItemData !== null) {
        occupancyRateSelector += `[data-line-index="${lineIndex}"]`;
    }
    const occupancyRateInput = getInputElement(occupancyRateSelector);
    if (!occupancyRateInput || occupancyRateInput.style.display === 'none') return true;

    const occupancyRate = (parseFloat(occupancyRateInput.value) || 0) / 100;
    if (occupancyRate === 0) return true;

    // 残業入力の取得
    let overtimeSelector = `.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`;
    if (linesItemData !== null) {
        overtimeSelector += `[data-line-index="${lineIndex}"]`;
    }
    const overtimeInput = getInputElement(overtimeSelector);

    // 計画停止の取得
    let stopTimeSelector = `.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`;
    if (linesItemData !== null) {
        stopTimeSelector += `[data-line-index="${lineIndex}"]`;
    }
    const stopTimeInput = getInputElement(stopTimeSelector);
    const stopTime = getInputValue(stopTimeInput);

    const regularTime = shift === 'day' ? REGULAR_TIME_DAY : REGULAR_TIME_NIGHT;

    // 全品番の生産数を合計
    const itemNames = getItemNames(linesItemData !== null ? lineIndex : null);
    let totalProduction = 0;

    itemNames.forEach(name => {
        let productionSelector = `.production-input[data-shift="${shift}"][data-item="${name}"][data-date-index="${dateIndex}"]`;
        if (linesItemData !== null) {
            productionSelector += `[data-line-index="${lineIndex}"]`;
        }
        const productionInput = getInputElement(productionSelector);
        if (productionInput && productionInput.style.display !== 'none') {
            totalProduction += parseInt(productionInput.value) || 0;
        }
    });

    if (totalProduction === 0) {
        if (overtimeInput) overtimeInput.value = 0;
        return true;
    }

    // 定時間で生産できる台数を計算
    const regularProductionTime = regularTime - stopTime;
    const regularTotalProduction = regularProductionTime > 0
        ? Math.ceil(regularProductionTime / tact * occupancyRate)
        : 0;

    // 残業で必要な追加生産数
    const additionalProduction = totalProduction - regularTotalProduction;

    // チェックセル取得
    let checkCellSelector = `.check-cell[data-date-index="${dateIndex}"]`;
    if (linesItemData !== null) {
        checkCellSelector += `[data-line-index="${lineIndex}"]`;
    }
    const checkCell = document.querySelector(checkCellSelector);
    const date = checkCell?.getAttribute('data-date') || '';
    const shiftName = shift === 'day' ? '日勤' : '夜勤';

    // 日勤のみ：定時ONまたは休出の場合は残業不可
    if (shift === 'day') {
        const isRegularHours = checkCell && checkCell.getAttribute('data-regular-hours') === 'true';
        const checkText = checkCell ? checkCell.textContent.trim() : '';
        const isHolidayWork = checkText === '休出';

        if (isRegularHours || isHolidayWork) {
            if (additionalProduction > 0) {
                const mode = isRegularHours ? '定時' : '休出';
                if (showToast) {
                    showToast('error', `${date} 日勤：${mode}の場合は残業できません。生産数合計を${regularTotalProduction}以下にしてください。`);
                }
                return false;
            }
            // 定時内に収まっている場合は正常終了
            return true;
        }
    }

    // 定時・休出でない場合のみ残業入力の存在を確認
    if (!overtimeInput || overtimeInput.style.display === 'none') return true;

    if (additionalProduction <= 0) {
        overtimeInput.value = 0;
        return true;
    }

    // 残業時間を逆算
    let calculatedOvertime = (additionalProduction * tact) / occupancyRate;
    calculatedOvertime = Math.max(0, calculatedOvertime);

    const maxOvertime = shift === 'day' ? OVERTIME_MAX_DAY : OVERTIME_MAX_NIGHT;

    // 残業上限を超える場合
    if (calculatedOvertime > maxOvertime) {
        if (showToast) {
            showToast('error', `${date} ${shiftName}：残業時間が上限（${maxOvertime}分）に達しています。生産数合計を${regularTotalProduction + Math.floor(maxOvertime * occupancyRate / tact)}以下にしてください。`);
        }
        return false;
    }

    // 残業時間を丸める（assembly: round、machining: ceil）
    const roundFn = roundingMethod === 'ceil' ? Math.ceil : Math.round;
    calculatedOvertime = roundFn(calculatedOvertime / OVERTIME_ROUND_MINUTES) * OVERTIME_ROUND_MINUTES;
    overtimeInput.value = calculatedOvertime;
    return true;
}
