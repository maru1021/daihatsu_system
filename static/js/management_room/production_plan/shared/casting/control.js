// ========================================
// 制御モジュール
// ========================================
// チェックセル操作、セレクトボックスの色管理、残業入力制御

import { buildOvertimeInputCache } from './cache.js';

/**
 * チェックセルのクリックイベント処理
 * @param {HTMLElement} element - チェックセル要素
 * @param {Function} updateCallback - 状態更新コールバック
 */
export function toggleCheck(element, updateCallback) {
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

    if (updateCallback) {
        updateCallback();
    }
}

/**
 * 週末勤務状態を初期化
 */
export function initializeWeekendWorkingStatus() {
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
 * @param {Object} caches - キャッシュオブジェクト
 * @param {Function} calculateProductionFunc - 生産計算関数
 * @param {Function} recalculateInventoryFunc - 在庫再計算関数
 * @param {Function} updateOvertimeFunc - 残業表示更新関数
 */
export function updateWorkingDayStatus(recalculate, caches, calculateProductionFunc, recalculateInventoryFunc, updateOvertimeFunc) {
    const { domConstantCache } = caches;

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
                } else if (hasWeekendDelivery && input.classList.contains('delivery-display')) {
                    input.style.display = '';
                    input.disabled = false;
                } else {
                    input.style.display = 'none';
                    input.value = input.classList.contains('delivery-display') ? input.value : 0;
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
        if (updateOvertimeFunc) updateOvertimeFunc();

        const dateCount = domConstantCache.dateCount;
        for (let i = 0; i < dateCount; i++) {
            if (calculateProductionFunc) {
                calculateProductionFunc(i, 'day');
                calculateProductionFunc(i, 'night');
            }
        }
        if (recalculateInventoryFunc) recalculateInventoryFunc();
    }
}

/**
 * セレクトボックスの背景色を更新
 * @param {HTMLElement} select - select要素
 * @param {Object} colorMap - 色マッピング
 */
export function updateSelectColor(select, colorMap) {
    const selectedValue = select.value;
    select.setAttribute('data-vehicle', selectedValue);

    if (selectedValue && colorMap[selectedValue]) {
        select.style.backgroundColor = colorMap[selectedValue];
    } else {
        select.style.backgroundColor = '';
    }
}

/**
 * 残業inputの表示/非表示を更新
 * @param {Object} caches - キャッシュオブジェクト
 */
export function updateOvertimeInputVisibility(caches) {
    const { overtimeInputCache, domConstantCache } = caches;

    if (!overtimeInputCache) {
        caches.overtimeInputCache = buildOvertimeInputCache();
    }

    const checkCells = domConstantCache.checkCells;

    for (let dateIndex = 0; dateIndex < checkCells.length; dateIndex++) {
        const checkCell = checkCells[dateIndex];
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const checkText = checkCell.textContent.trim();
        const isHolidayWork = checkText === '休出';
        const isRegularTime = checkText === '定時';

        const dayOvertimeInputs = caches.overtimeInputCache[`day-${dateIndex}`] || [];
        const nightOvertimeInputs = caches.overtimeInputCache[`night-${dateIndex}`] || [];

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
