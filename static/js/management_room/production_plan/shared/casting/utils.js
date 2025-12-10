// ========================================
// ユーティリティ関数モジュール
// ========================================
// 鋳造・CVT生産計画で使用される汎用関数群

/**
 * デバウンス関数
 * 連続した関数呼び出しを遅延させ、最後の呼び出しのみ実行
 * @param {Function} func - 実行する関数
 * @param {number} wait - 待機時間（ミリ秒）
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
 * 次の直に移動するヘルパー関数
 * @param {number} dateIndex - 日付インデックス
 * @param {string} shift - 現在の直（'day' or 'night'）
 * @returns {Object} { dateIndex: 次の日付, shift: 次の直 }
 */
export function moveToNextShift(dateIndex, shift) {
    if (shift === 'day') {
        return { dateIndex: dateIndex, shift: 'night' };
    } else {
        return { dateIndex: dateIndex + 1, shift: 'day' };
    }
}

/**
 * 前の直に移動するヘルパー関数
 * @param {number} dateIndex - 日付インデックス
 * @param {string} shift - 現在の直（'day' or 'night'）
 * @returns {Object} { dateIndex: 前の日付, shift: 前の直 }
 */
export function moveToPrevShift(dateIndex, shift) {
    if (shift === 'night') {
        return { dateIndex: dateIndex, shift: 'day' };
    } else {
        return { dateIndex: dateIndex - 1, shift: 'night' };
    }
}

/**
 * 設備名を取得
 * @param {number} machineIndex - 設備インデックス
 * @param {Object} domCache - DOMキャッシュオブジェクト
 * @returns {string} 設備名（例: "#1"）
 */
export function getMachineName(machineIndex, domCache) {
    const facilityNumbers = domCache.facilityNumbers;
    if (!facilityNumbers || machineIndex >= facilityNumbers.length / 4) {
        return '';
    }
    return facilityNumbers[machineIndex].textContent.trim();
}

/**
 * 次の稼働直を取得（土日スキップ）
 * @param {number} dateIndex - 開始日付インデックス
 * @param {string} shift - 開始直
 * @param {number} machineIndex - 設備インデックス
 * @param {Object} caches - キャッシュオブジェクト（selectElementCache, domConstantCache）
 * @returns {Object|null} { dateIndex, shift } または null
 */
export function getNextWorkingShift(dateIndex, shift, machineIndex, caches) {
    const { selectElementCache, domConstantCache } = caches;
    const dateCount = domConstantCache.dateCount;

    let next = moveToNextShift(dateIndex, shift);
    let currentDateIndex = next.dateIndex;
    let currentShift = next.shift;

    while (currentDateIndex < dateCount) {
        const select = selectElementCache[currentShift]?.[currentDateIndex]?.[machineIndex];
        if (select) {
            return { dateIndex: currentDateIndex, shift: currentShift };
        }
        next = moveToNextShift(currentDateIndex, currentShift);
        currentDateIndex = next.dateIndex;
        currentShift = next.shift;
    }

    return null;
}

/**
 * 前の稼働直を取得（土日スキップ）
 * @param {number} dateIndex - 開始日付インデックス
 * @param {string} shift - 開始直
 * @param {number} machineIndex - 設備インデックス
 * @param {Object} caches - キャッシュオブジェクト（selectElementCache）
 * @returns {Object|null} { dateIndex, shift } または null
 */
export function getPrevWorkingShift(dateIndex, shift, machineIndex, caches) {
    const { selectElementCache } = caches;
    let prev = moveToPrevShift(dateIndex, shift);
    let currentDateIndex = prev.dateIndex;
    let currentShift = prev.shift;

    while (currentDateIndex >= 0) {
        const select = selectElementCache[currentShift]?.[currentDateIndex]?.[machineIndex];
        if (select) {
            return { dateIndex: currentDateIndex, shift: currentShift };
        }
        prev = moveToPrevShift(currentDateIndex, currentShift);
        currentDateIndex = prev.dateIndex;
        currentShift = prev.shift;
    }

    return null;
}

/**
 * 全品番名を取得
 * @returns {Array<string>} 品番名の配列
 */
export function getItemNames() {
    const vehicleLabels = document.querySelectorAll('.vehicle-label');
    const names = [];
    vehicleLabels.forEach(label => {
        const name = label.textContent.trim();
        if (name && !names.includes(name)) {
            names.push(name);
        }
    });
    return names;
}

/**
 * input要素を取得
 * @param {string} selector - セレクタ
 * @returns {HTMLElement|null} input要素
 */
export function getInputElement(selector) {
    return document.querySelector(selector);
}

/**
 * input要素の値を取得（数値）
 * @param {HTMLElement} input - input要素
 * @returns {number} 数値（空の場合は0）
 */
export function getInputValue(input) {
    return input ? (parseInt(input.value) || 0) : 0;
}

/**
 * Cookieを取得
 * @param {string} name - Cookie名
 * @returns {string|null} Cookie値
 */
export function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}
