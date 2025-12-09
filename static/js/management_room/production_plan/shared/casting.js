// ========================================
// 生産計画共通JavaScript
// ========================================
// 鋳造・CVT生産計画で共有される関数群
// 各ラインの特有処理は個別ファイルで実装

// ========================================
// ユーティリティ関数
// ========================================

/**
 * デバウンス関数
 * 連続した関数呼び出しを遅延させ、最後の呼び出しのみ実行
 * @param {Function} func - 実行する関数
 * @param {number} wait - 待機時間（ミリ秒）
 * @returns {Function} デバウンスされた関数
 */
function debounce(func, wait) {
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
function moveToNextShift(dateIndex, shift) {
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
function moveToPrevShift(dateIndex, shift) {
    if (shift === 'night') {
        return { dateIndex: dateIndex, shift: 'day' };
    } else {
        return { dateIndex: dateIndex - 1, shift: 'night' };
    }
}

/**
 * 設備名を取得
 * @param {number} machineIndex - 設備インデックス
 * @returns {string} 設備名（例: "#1"）
 */
function getMachineName(machineIndex) {
    const facilityNumbers = domConstantCache.facilityNumbers;
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
 * @returns {Object|null} { dateIndex, shift } または null
 */
function getNextWorkingShift(dateIndex, shift, machineIndex) {
    const dateCount = domConstantCache.dateCount;
    const totalMachines = domConstantCache.totalMachines;

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
 * @returns {Object|null} { dateIndex, shift } または null
 */
function getPrevWorkingShift(dateIndex, shift, machineIndex) {
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
function getItemNames() {
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
function getInputElement(selector) {
    return document.querySelector(selector);
}

/**
 * input要素の値を取得（数値）
 * @param {HTMLElement} input - input要素
 * @returns {number} 数値（空の場合は0）
 */
function getInputValue(input) {
    return input ? (parseInt(input.value) || 0) : 0;
}

/**
 * Cookieを取得
 * @param {string} name - Cookie名
 * @returns {string|null} Cookie値
 */
function getCookie(name) {
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

// ========================================
// チェックセル操作
// ========================================

/**
 * チェックセルのクリックイベント処理
 * @param {HTMLElement} element - チェックセル要素
 */
function toggleCheck(element) {
    const isWeekend = element.getAttribute('data-weekend') === 'true';
    const currentText = element.textContent.trim();

    if (isWeekend) {
        if (currentText === '休出') {
            element.textContent = '';
            element.setAttribute('data-regular-hours', 'false');
        } else {
            element.textContent = '休出';
            element.setAttribute('data-regular-hours', 'false');
        }
    } else {
        if (currentText === '定時') {
            element.textContent = '';
            element.setAttribute('data-regular-hours', 'false');
        } else {
            element.textContent = '定時';
            element.setAttribute('data-regular-hours', 'true');
        }
    }

    updateWorkingDayStatus();
}

/**
 * 週末勤務状態を初期化
 */
function initializeWeekendWorkingStatus() {
    document.querySelectorAll('.check-cell').forEach(checkCell => {
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const isRegularHours = checkCell.getAttribute('data-regular-hours') === 'true';

        if (isWeekend) {
            const hasWeekendWork = checkCell.getAttribute('data-has-weekend-work') === 'true';
            if (hasWeekendWork) {
                checkCell.textContent = '休出';
                checkCell.setAttribute('data-regular-hours', 'false');
            } else {
                checkCell.textContent = '';
                checkCell.setAttribute('data-regular-hours', 'false');
            }
        } else {
            if (isRegularHours) {
                checkCell.textContent = '定時';
                checkCell.setAttribute('data-regular-hours', 'true');
            } else {
                checkCell.textContent = '';
                checkCell.setAttribute('data-regular-hours', 'false');
            }
        }
    });
}

/**
 * 稼働日状態を更新
 * @param {boolean} recalculate - 再計算するかどうか（デフォルト: true）
 */
function updateWorkingDayStatus(recalculate = true) {
    document.querySelectorAll('.check-cell').forEach(checkCell => {
        const dateStr = checkCell.getAttribute('data-date');
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const checkText = checkCell.textContent.trim();

        const dateIndex = Array.from(checkCell.parentElement.children).indexOf(checkCell) - 1;

        if (isWeekend) {
            const isWorking = checkText === '休出';
            const hasWeekendDelivery = checkCell.getAttribute('data-has-weekend-delivery') === 'true';

            const dayInputs = document.querySelectorAll(
                `input[data-date-index="${dateIndex}"][data-shift="day"]:not(.overtime-input):not(.operation-rate-input)`
            );
            const nightInputs = document.querySelectorAll(
                `input[data-date-index="${dateIndex}"][data-shift="night"]:not(.overtime-input):not(.operation-rate-input)`
            );

            dayInputs.forEach(input => {
                if (isWorking) {
                    input.style.display = '';
                    input.disabled = false;
                } else if (hasWeekendDelivery && input.classList.contains('delivery-input')) {
                    input.style.display = '';
                    input.disabled = false;
                } else {
                    input.style.display = 'none';
                    input.value = input.classList.contains('delivery-input') ? input.value : 0;
                    input.disabled = true;
                }
            });

            nightInputs.forEach(input => {
                input.style.display = 'none';
                input.value = 0;
                input.disabled = true;
            });

            const daySelects = document.querySelectorAll(
                `select[data-date-index="${dateIndex}"][data-shift="day"]`
            );
            daySelects.forEach(select => {
                const container = select.closest('.select-container');
                if (container) {
                    if (isWorking) {
                        container.style.display = '';
                        select.disabled = false;
                    } else {
                        container.style.display = 'none';
                        select.value = '';
                        select.setAttribute('data-vehicle', '');
                        select.disabled = true;
                    }
                }
            });

            const nightSelects = document.querySelectorAll(
                `select[data-date-index="${dateIndex}"][data-shift="night"]`
            );
            nightSelects.forEach(select => {
                const container = select.closest('.select-container');
                if (container) {
                    container.style.display = 'none';
                    select.value = '';
                    select.setAttribute('data-vehicle', '');
                    select.disabled = true;
                }
            });
        }
    });

    if (recalculate) {
        updateOvertimeInputVisibility();
        const dateCount = domConstantCache.dateCount;
        for (let i = 0; i < dateCount; i++) {
            calculateProduction(i, 'day');
            calculateProduction(i, 'night');
        }
        recalculateAllInventory();
    }
}

// ========================================
// セレクトボックスの色管理
// ========================================

/**
 * セレクトボックスの背景色を更新
 * @param {HTMLElement} select - select要素
 */
function updateSelectColor(select) {
    const selectedValue = select.value;
    select.setAttribute('data-vehicle', selectedValue);

    if (selectedValue && colorMap[selectedValue]) {
        select.style.backgroundColor = colorMap[selectedValue];
    } else {
        select.style.backgroundColor = '';
    }
}

// ========================================
// 在庫計算
// ========================================

/**
 * 在庫計算に必要な全入力要素をキャッシュ
 * @returns {Object} キャッシュオブジェクト
 */
function buildInventoryElementCache() {
    const cache = {
        inventory: {},
        delivery: {},
        production: {},
        stockAdjustment: {}
    };

    const itemNames = getItemNames();

    for (let i = 0; i < itemNames.length; i++) {
        const itemName = itemNames[i];
        cache.inventory[itemName] = { day: {}, night: {} };
        cache.delivery[itemName] = { day: {}, night: {} };
        cache.production[itemName] = { day: {}, night: {} };
        cache.stockAdjustment[itemName] = { day: {}, night: {} };

        document.querySelectorAll(`.inventory-input[data-item="${itemName}"]`).forEach(input => {
            const shift = input.dataset.shift;
            const dateIndex = parseInt(input.dataset.dateIndex);
            cache.inventory[itemName][shift][dateIndex] = input;
        });

        document.querySelectorAll(`.delivery-input[data-item="${itemName}"]`).forEach(input => {
            const shift = input.dataset.shift;
            const dateIndex = parseInt(input.dataset.dateIndex);
            cache.delivery[itemName][shift][dateIndex] = input;
        });

        document.querySelectorAll(`.production-input[data-item="${itemName}"]`).forEach(input => {
            const shift = input.dataset.shift;
            const dateIndex = parseInt(input.dataset.dateIndex);
            cache.production[itemName][shift][dateIndex] = input;
        });

        document.querySelectorAll(`.stock-adjustment-input[data-item="${itemName}"]`).forEach(input => {
            const shift = input.dataset.shift;
            const dateIndex = parseInt(input.dataset.dateIndex);
            cache.stockAdjustment[itemName][shift][dateIndex] = input;
        });
    }

    return cache;
}

/**
 * 指定した日付・直・品番の在庫を計算
 * @param {number} dateIndex - 日付インデックス
 * @param {string} shift - 直（'day' or 'night'）
 * @param {string} itemName - 品番名
 */
function calculateInventory(dateIndex, shift, itemName) {
    let previousInventory = 0;

    if (dateIndex === 0 && shift === 'day') {
        previousInventory = previousMonthInventory[itemName] || 0;
    } else {
        const prev = moveToPrevShift(dateIndex, shift);
        const prevInput = inventoryElementCache.inventory[itemName]?.[prev.shift]?.[prev.dateIndex];
        previousInventory = getInputValue(prevInput);
    }

    const deliveryInput = inventoryElementCache.delivery[itemName]?.[shift]?.[dateIndex];
    const delivery = getInputValue(deliveryInput);

    const productionInput = inventoryElementCache.production[itemName]?.[shift]?.[dateIndex];
    const production = getInputValue(productionInput);

    const stockAdjustmentInput = inventoryElementCache.stockAdjustment[itemName]?.[shift]?.[dateIndex];
    const stockAdjustment = getInputValue(stockAdjustmentInput);

    const inventory = previousInventory - delivery + production + stockAdjustment;

    const inventoryInput = inventoryElementCache.inventory[itemName]?.[shift]?.[dateIndex];
    if (inventoryInput) {
        inventoryInput.value = inventory;
    }
}

// ========================================
// 合計計算
// ========================================

/**
 * input要素の合計を計算
 * @param {NodeList} inputs - input要素のリスト
 * @returns {number} 合計値
 */
function sumInputValues(inputs) {
    let sum = 0;
    inputs.forEach(input => {
        sum += getInputValue(input);
    });
    return sum;
}

/**
 * 品番ごとの直別合計を計算（出庫、生産）
 * @param {string} className - 合計セルのクラス名
 * @param {string} inputClass - input要素のクラス名
 * @param {string} dataKey - data属性のキー名
 */
function calculateShiftTotalByItem(className, inputClass, dataKey) {
    document.querySelectorAll(`.${className}`).forEach(cell => {
        const shift = cell.dataset.shift;
        const itemValue = cell.dataset[dataKey];
        const inputs = document.querySelectorAll(`.${inputClass}[data-shift="${shift}"][data-${dataKey}="${itemValue}"]`);
        cell.textContent = sumInputValues(inputs);
    });
}

/**
 * 設備ごとの直別合計を計算（金型交換、残業、計画停止）
 * @param {string} className - 合計セルのクラス名
 * @param {string} inputClass - input要素のクラス名
 */
function calculateShiftTotalByMachine(className, inputClass) {
    document.querySelectorAll(`.${className}`).forEach(cell => {
        const shift = cell.dataset.shift;
        const machineIndex = cell.dataset.machineIndex;
        const inputs = document.querySelectorAll(`.${inputClass}[data-shift="${shift}"][data-machine-index="${machineIndex}"]`);
        cell.textContent = sumInputValues(inputs);
    });
}

/**
 * 品番ごとの日勤+夜勤合計を計算
 * @param {string} className - 合計セルのクラス名
 * @param {string} inputClass - input要素のクラス名
 * @param {string} dataKey - data属性のキー名
 */
function calculateCombinedTotalByItem(className, inputClass, dataKey) {
    document.querySelectorAll(`.${className}`).forEach(cell => {
        const itemValue = cell.dataset[dataKey];
        const inputs = document.querySelectorAll(`.${inputClass}[data-${dataKey}="${itemValue}"]`);
        cell.textContent = sumInputValues(inputs);
    });
}

/**
 * 設備ごとの日勤+夜勤合計を計算
 * @param {string} className - 合計セルのクラス名
 * @param {string} inputClass - input要素のクラス名
 */
function calculateCombinedTotalByMachine(className, inputClass) {
    document.querySelectorAll(`.${className}`).forEach(cell => {
        const machineIndex = cell.dataset.machineIndex;
        const inputs = document.querySelectorAll(`.${inputClass}[data-machine-index="${machineIndex}"]`);
        cell.textContent = sumInputValues(inputs);
    });
}

// ========================================
// 溶湯・ポット数計算
// ========================================

/**
 * 溶湯計算用の要素をキャッシュ
 * @returns {Object} キャッシュオブジェクト
 */
function buildMoltenMetalElementCache() {
    const cache = {
        day: {},
        night: {}
    };

    const dateCount = domConstantCache.dateCount;

    for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
        const dayCell = document.querySelector(
            `tr[data-section="molten_metal"][data-shift="day"] td[data-date-index="${dateIndex}"]`
        );
        const nightCell = document.querySelector(
            `tr[data-section="molten_metal"][data-shift="night"] td[data-date-index="${dateIndex}"]`
        );
        cache.day[dateIndex] = dayCell;
        cache.night[dateIndex] = nightCell;
    }

    return cache;
}

// ========================================
// 残業input表示制御
// ========================================

/**
 * 残業inputのキャッシュを構築
 * @returns {Object} キャッシュオブジェクト
 */
function buildOvertimeInputCache() {
    const cache = {};
    document.querySelectorAll('.overtime-input').forEach(input => {
        const shift = input.dataset.shift;
        const dateIndex = input.dataset.dateIndex;
        const key = `${shift}-${dateIndex}`;
        if (!cache[key]) {
            cache[key] = [];
        }
        cache[key].push(input);
    });
    return cache;
}

/**
 * 残業inputの表示/非表示を更新
 */
function updateOvertimeInputVisibility() {
    if (!overtimeInputCache) {
        overtimeInputCache = buildOvertimeInputCache();
    }

    const checkCells = domConstantCache.checkCells;

    for (let dateIndex = 0; dateIndex < checkCells.length; dateIndex++) {
        const checkCell = checkCells[dateIndex];
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const checkText = checkCell.textContent.trim();
        const isHolidayWork = checkText === '休出';
        const isRegularTime = checkText === '定時';

        const dayOvertimeInputs = overtimeInputCache[`day-${dateIndex}`] || [];
        const nightOvertimeInputs = overtimeInputCache[`night-${dateIndex}`] || [];

        if (isWeekend && !isHolidayWork) {
            for (let i = 0; i < dayOvertimeInputs.length; i++) {
                dayOvertimeInputs[i].style.display = 'none';
                dayOvertimeInputs[i].value = 0;
            }
            for (let i = 0; i < nightOvertimeInputs.length; i++) {
                nightOvertimeInputs[i].style.display = 'none';
                nightOvertimeInputs[i].value = 0;
            }
        } else if (isHolidayWork) {
            for (let i = 0; i < dayOvertimeInputs.length; i++) {
                dayOvertimeInputs[i].style.display = 'none';
                dayOvertimeInputs[i].value = 0;
            }
            for (let i = 0; i < nightOvertimeInputs.length; i++) {
                nightOvertimeInputs[i].style.display = 'none';
                nightOvertimeInputs[i].value = 0;
            }
        } else if (isRegularTime) {
            for (let i = 0; i < dayOvertimeInputs.length; i++) {
                dayOvertimeInputs[i].style.display = 'none';
                dayOvertimeInputs[i].value = 0;
            }
            for (let i = 0; i < nightOvertimeInputs.length; i++) {
                nightOvertimeInputs[i].style.display = '';
            }
        } else {
            for (let i = 0; i < dayOvertimeInputs.length; i++) {
                dayOvertimeInputs[i].style.display = '';
            }
            for (let i = 0; i < nightOvertimeInputs.length; i++) {
                nightOvertimeInputs[i].style.display = '';
            }
        }
    }
}
