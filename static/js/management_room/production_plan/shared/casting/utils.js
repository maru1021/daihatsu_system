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
 * 要素の値を取得（inputまたはspan両方に対応）
 * @param {HTMLElement} element - input要素またはspan要素
 * @returns {number} 数値（空の場合は0）
 */
export function getElementValue(element) {
    if (!element) return 0;
    if (element.tagName === 'INPUT') {
        return parseInt(element.value) || 0;
    } else {
        // spanの場合はdata-value属性またはtextContentから取得
        const dataValue = element.dataset.value;
        if (dataValue !== undefined && dataValue !== '') {
            return parseInt(dataValue) || 0;
        }
        return parseInt(element.textContent) || 0;
    }
}

/**
 * 要素に値を設定（inputまたはspan両方に対応）
 * @param {HTMLElement} element - input要素またはspan要素
 * @param {number|string} value - 設定する値
 */
export function setElementValue(element, value) {
    if (!element) return;
    const strValue = String(value);
    if (element.tagName === 'INPUT') {
        element.value = strValue;
    } else {
        // spanの場合はtextContentとdata-value属性の両方を設定
        element.textContent = strValue;
        element.dataset.value = strValue;
    }
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

/**
 * 次の稼働している直のselect要素を取得（品番が入っているセルのみ）
 * 土日や休日を跨いで次の稼働直を探す（型替え判定用）
 * @param {number} dateIndex - 開始日付インデックス
 * @param {string} shift - 開始直（'day' or 'night'）
 * @param {number} machineIndex - 設備インデックス
 * @param {Map} vehicleSelectCache - vehicleSelectCacheマップ（key: "shift-dateIndex-machineIndex"）
 * @returns {HTMLElement|null} 次の稼働直のselect要素、または見つからなければnull
 */
export function getNextWorkingShiftSelect(dateIndex, shift, machineIndex, vehicleSelectCache) {
    if (shift === 'day') {
        // 日勤の場合: 同じ日の夜勤を取得
        const nightKey = `night-${dateIndex}-${machineIndex}`;
        const nightCandidate = vehicleSelectCache.get(nightKey);
        // 夜勤が存在し、かつ品番が入っている場合のみ
        if (nightCandidate && nightCandidate.value && nightCandidate.value.trim() !== '') {
            return nightCandidate;
        }
    } else {
        // 夜勤の場合: 次の稼働日の日勤を取得（土日や休日を跨ぐ可能性を考慮）
        // 最大10日先まで探す（長期休暇も考慮）
        for (let offset = 1; offset <= 10; offset++) {
            const nextDayKey = `day-${dateIndex + offset}-${machineIndex}`;
            const candidateSelect = vehicleSelectCache.get(nextDayKey);
            // 次の日勤が存在し、かつ品番が入っている場合のみ
            if (candidateSelect && candidateSelect.value && candidateSelect.value.trim() !== '') {
                return candidateSelect;
            }
        }
    }
    return null;
}

/**
 * 前の稼働している直のselect要素を取得（品番が入っているセルのみ）
 * 土日や休日を跨いで前の稼働直を探す
 * @param {number} dateIndex - 開始日付インデックス
 * @param {string} shift - 開始直（'day' or 'night'）
 * @param {number} machineIndex - 設備インデックス
 * @param {Map} vehicleSelectCache - vehicleSelectCacheマップ（key: "shift-dateIndex-machineIndex"）
 * @returns {HTMLElement|null} 前の稼働直のselect要素、または見つからなければnull
 */
export function getPrevWorkingShiftSelect(dateIndex, shift, machineIndex, vehicleSelectCache) {
    if (shift === 'day') {
        // 日勤の場合: 前の稼働日の夜勤を取得（夜勤→日勤の変更チェック）
        // 最大10日前まで探す（土日や長期休暇を考慮）
        for (let offset = 1; offset <= 10; offset++) {
            const prevNightKey = `night-${dateIndex - offset}-${machineIndex}`;
            const candidateSelect = vehicleSelectCache.get(prevNightKey);
            // 前の夜勤が存在し、かつ品番が入っている場合のみ
            if (candidateSelect && candidateSelect.value && candidateSelect.value.trim() !== '') {
                return candidateSelect;
            }
        }
    } else {
        // 夜勤の場合: 同じ日の日勤を取得
        const dayKey = `day-${dateIndex}-${machineIndex}`;
        const dayCandidate = vehicleSelectCache.get(dayKey);
        // 日勤が存在し、かつ品番が入っている場合のみ
        if (dayCandidate && dayCandidate.value && dayCandidate.value.trim() !== '') {
            return dayCandidate;
        }
    }
    return null;
}

// ========================================
// 生産数計算ヘルパー関数
// ========================================

/** デフォルト良品率（100%） */
const DEFAULT_YIELD_RATE = 1.0;

/**
 * 総生産数を計算
 * @param {number} workingTime - 稼働時間（分）
 * @param {number} tact - タクト（分/個）
 * @param {number} operationRate - 稼働率（0.0～1.0）
 * @returns {number} 総生産数（切り上げ）
 */
export function calculateTotalProduction(workingTime, tact, operationRate) {
    if (tact === 0) return 0;
    return Math.ceil((workingTime / tact) * operationRate);
}

/**
 * 良品生産数を計算
 * @param {number} totalProduction - 総生産数
 * @param {number} yieldRate - 良品率（0.0～1.0）、省略時は100%
 * @returns {number} 良品生産数（切り上げ）
 */
export function calculateGoodProduction(totalProduction, yieldRate = DEFAULT_YIELD_RATE) {
    return Math.ceil(totalProduction * yieldRate);
}

/**
 * 設備の生産数を計算（総生産数と良品生産数の両方）
 * @param {number} workingTime - 稼働時間（分）
 * @param {number} tact - タクト（分/個）
 * @param {number} operationRate - 稼働率（0.0～1.0）
 * @param {number} yieldRate - 良品率（0.0～1.0）、省略時は100%
 * @returns {Object} { totalProduction: 総生産数, goodProduction: 良品生産数 }
 */
export function calculateMachineProduction(workingTime, tact, operationRate, yieldRate = DEFAULT_YIELD_RATE) {
    const totalProduction = calculateTotalProduction(workingTime, tact, operationRate);
    const goodProduction = calculateGoodProduction(totalProduction, yieldRate);
    return { totalProduction, goodProduction };
}

/**
 * 生産要素をクリア（表示値とdata-good-production属性の両方）
 * @param {HTMLElement} productionElement - 生産要素
 */
export function clearProductionElement(productionElement) {
    if (productionElement) {
        setElementValue(productionElement, '');
        productionElement.dataset.goodProduction = '0';
    }
}

/**
 * 指定した直の全品番の生産要素をクリア
 * @param {Object} inventoryElementCache - 在庫要素キャッシュ
 * @param {string} shift - 直（'day' or 'night'）
 * @param {number} dateIndex - 日付インデックス
 */
export function clearAllProductionElements(inventoryElementCache, shift, dateIndex) {
    if (!inventoryElementCache) return;

    Object.keys(inventoryElementCache.production).forEach(itemName => {
        const productionElement = inventoryElementCache.production[itemName]?.[shift]?.[dateIndex];
        clearProductionElement(productionElement);
    });
}
