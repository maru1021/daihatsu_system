// ========================================
// 組付・加工系生産計画の共通ユーティリティ関数
// ========================================
// このファイルは組付と加工の生産計画で共通して使用されるユーティリティ関数を定義します

/**
 * デバウンス関数
 * 関数の実行を遅延させ、連続した呼び出しを抑制する
 *
 * @param {Function} func - 実行する関数
 * @param {number} wait - 遅延時間（ミリ秒）
 * @returns {Function} デバウンスされた関数
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * 入力要素を取得
 *
 * @param {string} selector - CSSセレクタ
 * @returns {HTMLElement|null} 入力要素
 */
export function getInputElement(selector) {
    return document.querySelector(selector);
}

/**
 * 入力値を取得（非表示の場合は0を返す）
 *
 * @param {HTMLElement} input - 入力要素
 * @returns {number} 入力値
 */
export function getInputValue(input) {
    return input && input.style.display !== 'none' ? (parseInt(input.value) || 0) : 0;
}

/**
 * セルのスタイルを設定
 *
 * @param {HTMLElement} cell - セル要素
 * @param {number} value - 値
 */
export function setCellStyle(cell, value) {
    if (cell) {
        cell.textContent = value > 0 ? value : '';
        cell.style.fontWeight = 'bold';
        cell.style.textAlign = 'center';
    }
}

/**
 * 品番リストを取得
 *
 * @param {number|null} lineIndex - ラインインデックス（オプション、加工用）
 * @returns {string[]} 品番リスト
 */
export function getItemNames(lineIndex = null) {
    const itemNames = [];

    if (lineIndex !== undefined && lineIndex !== null) {
        // 特定のテーブルから品番を取得（加工用）
        const table = document.querySelector(`table[data-line-index="${lineIndex}"]`);
        if (table) {
            table.querySelectorAll('[data-section="production"][data-shift="day"] .vehicle-label').forEach(label => {
                itemNames.push(label.textContent.trim());
            });
        }
    } else {
        // 全体から品番を取得（組付用）
        document.querySelectorAll('[data-section="production"][data-shift="day"] .vehicle-label').forEach(label => {
            itemNames.push(label.textContent.trim());
        });
    }

    return itemNames;
}

/**
 * 出庫数の値を取得（span要素から）
 * 加工用のユーティリティ関数
 *
 * @param {HTMLElement} shipmentDisplay - 出庫数表示要素
 * @returns {number} 出庫数
 */
export function getShipmentValue(shipmentDisplay) {
    return shipmentDisplay && shipmentDisplay.style.display !== 'none' ? (parseInt(shipmentDisplay.textContent) || 0) : 0;
}

/**
 * 全品番の生産数を更新（共通処理）
 *
 * @param {number} dateIndex - 日付インデックス
 * @param {string[]} shifts - シフト配列
 * @param {boolean} forceRecalculate - 強制再計算フラグ
 * @param {Function} updateProductionQuantity - 生産数更新関数
 * @param {number|null} lineIndex - ラインインデックス（オプション、加工用）
 */
export function updateAllItemsProduction(dateIndex, shifts, forceRecalculate, updateProductionQuantity, lineIndex = null) {
    const itemNames = getItemNames(lineIndex);
    shifts.forEach(shift => {
        itemNames.forEach(itemName => {
            if (lineIndex !== null) {
                updateProductionQuantity(dateIndex, shift, itemName, forceRecalculate, lineIndex);
            } else {
                updateProductionQuantity(dateIndex, shift, itemName, forceRecalculate);
            }
        });
    });
}
