// ========================================
// 保存機能モジュール（鋳造・CVT共通）
// ========================================
// 生産計画の保存処理を共通化
//
// 使用例:
// import { saveProductionPlan } from './shared/casting/save.js';
// saveProductionPlan({
//     includeMoldCount: true,
//     getMoldCountData: (container, shift, dateIndex, machineIndex) => {...},
//     getAdditionalData: () => ({...}),
//     getCookie: (name) => {...},
//     showToast: (type, message) => {...}
// });

import { getInputElement, getInputValue, getCookie as defaultGetCookie } from './utils.js';

/**
 * 生産計画を保存
 * @param {Object} options - オプション設定
 * @param {boolean} options.includeMoldCount - 金型カウントを含めるか（デフォルト: false）
 * @param {Function} options.getMoldCountData - 金型データを取得する関数（Casting用）
 * @param {Function} options.getAdditionalData - 追加データを取得する関数（Casting: usable_molds_data等）
 * @param {Object} options.domConstantCache - DOM定数キャッシュ
 * @param {Function} options.getCookie - Cookieを取得する関数（オプション）
 * @param {Function} options.showToast - トースト表示関数（オプション）
 */
export function saveProductionPlan(options = {}) {
    const {
        includeMoldCount = false,
        getMoldCountData = null,
        getAdditionalData = null,
        domConstantCache = null,
        getCookie: getCookieFn = defaultGetCookie,
        showToast = window.showToast || ((type, msg) => alert(msg))
    } = options;

    const saveBtn = document.getElementById('save-btn');
    if (!saveBtn) {
        console.error('Save button not found');
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';

    // 保存データを収集
    const planData = [];

    // 休出が消された日付を収集（週末で休出がチェックされていない日）
    const weekendsToDelete = [];
    document.querySelectorAll('.check-cell').forEach(checkCell => {
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const checkText = checkCell.textContent.trim();
        const dateIndex = Array.from(checkCell.parentElement.children).indexOf(checkCell) - 1;

        if (isWeekend && checkText !== '休出') {
            weekendsToDelete.push(dateIndex);
        }
    });

    // 計画停止、残業時間、金型交換、生産計画を収集
    const stopTimeInputs = document.querySelectorAll('.stop-time-input');
    const overtimeInputs = document.querySelectorAll('.overtime-input');
    const moldChangeInputs = document.querySelectorAll('.mold-change-input');
    const vehicleSelects = document.querySelectorAll('.vehicle-select');

    // 計画停止時間データを収集
    stopTimeInputs.forEach(input => {
        // 非表示のフィールドはスキップ
        if (input.style.display === 'none') return;

        const dateIndex = parseInt(input.dataset.dateIndex);
        const shift = input.dataset.shift;
        const machineIndex = parseInt(input.dataset.machineIndex);
        const stopTime = parseInt(input.value) || 0;

        planData.push({
            date_index: dateIndex,
            shift: shift,
            machine_index: machineIndex,
            stop_time: stopTime,
            type: 'stop_time'
        });
    });

    // 残業時間データを収集
    overtimeInputs.forEach(input => {
        // 非表示のフィールドはスキップ
        if (input.style.display === 'none') return;

        const dateIndex = parseInt(input.dataset.dateIndex);
        const shift = input.dataset.shift;
        const machineIndex = parseInt(input.dataset.machineIndex);
        const overtime = parseInt(input.value) || 0;

        planData.push({
            date_index: dateIndex,
            shift: shift,
            machine_index: machineIndex,
            overtime: overtime,
            type: 'overtime'
        });
    });

    // 金型交換データを収集
    moldChangeInputs.forEach(input => {
        // 非表示のフィールドはスキップ
        if (input.style.display === 'none') return;

        const dateIndex = parseInt(input.dataset.dateIndex);
        const shift = input.dataset.shift;
        const machineIndex = parseInt(input.dataset.machineIndex);
        const moldChange = parseInt(input.value) || 0;

        planData.push({
            date_index: dateIndex,
            shift: shift,
            machine_index: machineIndex,
            mold_change: moldChange,
            type: 'mold_change'
        });
    });

    // 生産計画データを収集
    vehicleSelects.forEach(select => {
        // 非表示のフィールドはスキップ
        const container = select.closest('.select-container');
        if (container && container.style.display === 'none') return;

        const dateIndex = parseInt(select.dataset.dateIndex);
        const shift = select.dataset.shift;
        const machineIndex = parseInt(select.dataset.machineIndex);
        const itemName = select.value;

        // 金型カウントの取得（ライン別処理）
        let moldCount = 0;
        if (includeMoldCount && getMoldCountData) {
            moldCount = getMoldCountData(container, shift, dateIndex, machineIndex);
        }

        planData.push({
            date_index: dateIndex,
            shift: shift,
            machine_index: machineIndex,
            item_name: itemName,
            mold_count: moldCount,
            type: 'production_plan'
        });
    });

    // 在庫数データを収集（0でもすべて保存）
    const inventoryElements = document.querySelectorAll('.inventory-display');
    inventoryElements.forEach(element => {
        const dateIndex = parseInt(element.dataset.dateIndex);
        const shift = element.dataset.shift;
        const itemName = element.dataset.item;
        const stock = parseInt(element.dataset.value) || 0;

        // 在庫数はすべて保存（0でも保存して連続性を保つ）
        planData.push({
            date_index: dateIndex,
            shift: shift,
            item_name: itemName,
            stock: stock,
            type: 'inventory'
        });
    });

    // 出庫数データを収集（0でもすべて保存）
    const deliveryElements = document.querySelectorAll('.delivery-display');
    deliveryElements.forEach(element => {
        const dateIndex = parseInt(element.dataset.dateIndex);
        const shift = element.dataset.shift;
        const itemName = element.dataset.item;
        const delivery = parseInt(element.dataset.value) || 0;

        // 出庫数はすべて保存（週末で休出がなくても出庫がある場合がある）
        planData.push({
            date_index: dateIndex,
            shift: shift,
            item_name: itemName,
            delivery: delivery,
            type: 'delivery'
        });
    });

    // 在庫調整データを収集（棚卸や不良品などによる手動調整）
    const stockAdjustmentInputs = document.querySelectorAll('.stock-adjustment-input');
    stockAdjustmentInputs.forEach(input => {
        // 非表示のフィールド（週末の夜勤など）はスキップ
        if (input.style.display === 'none') return;

        const dateIndex = parseInt(input.dataset.dateIndex);
        const shift = input.dataset.shift;
        const itemName = input.dataset.item;
        const stockAdjustment = parseInt(input.value) || 0;

        // 在庫調整はすべて保存（0でも保存して既存の調整をクリア可能に）
        planData.push({
            date_index: dateIndex,
            shift: shift,
            item_name: itemName,
            stock_adjustment: stockAdjustment,
            type: 'stock_adjustment'
        });
    });

    // 生産台数データを収集（spanから取得）
    const productionElements = document.querySelectorAll('.production-display');
    productionElements.forEach(element => {
        const dateIndex = parseInt(element.dataset.dateIndex);
        const shift = element.dataset.shift;
        const itemName = element.dataset.item;
        const productionCount = parseInt(element.dataset.value) || 0;

        if (productionCount > 0) {  // 0より大きい生産台数のみ保存
            planData.push({
                date_index: dateIndex,
                shift: shift,
                item_name: itemName,
                production_count: productionCount,
                type: 'production'
            });
        }
    });

    // 稼働率データを収集
    const occupancyRateData = [];
    const operationRateInputs = document.querySelectorAll('.operation-rate-input');
    operationRateInputs.forEach(input => {
        const dateIndex = parseInt(input.dataset.dateIndex);
        const occupancyRate = parseFloat(input.value) || 0;

        if (occupancyRate > 0) {
            occupancyRateData.push({
                date_index: dateIndex,
                occupancy_rate: occupancyRate
            });
        }
    });

    // 定時データを収集（平日で「定時」が設定されている場合のみ）
    const regularWorkingHoursData = [];
    document.querySelectorAll('.check-cell').forEach(checkCell => {
        const checkText = checkCell.textContent.trim();
        const dateIndex = Array.from(checkCell.parentElement.children).indexOf(checkCell) - 1;
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';

        // 平日で定時が設定されている場合のみ送信
        if (checkText === '定時' && !isWeekend) {
            regularWorkingHoursData.push({
                date_index: dateIndex,
                regular_working_hours: true
            });
        }
    });

    // 追加データを取得（Casting: usable_molds_data等）
    let additionalPayload = {};
    if (getAdditionalData) {
        additionalPayload = getAdditionalData();
    }

    // CSRFトークンを取得
    const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]')?.value || getCookieFn('csrftoken');

    if (!csrfToken) {
        showToast('error', 'CSRFトークンが取得できませんでした。ページをリロードしてください。');
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';
        return;
    }

    // POSTリクエスト送信
    fetch(window.location.href, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken
        },
        body: JSON.stringify({
            plan_data: planData,
            weekends_to_delete: weekendsToDelete,
            occupancy_rate_data: occupancyRateData,
            regular_working_hours_data: regularWorkingHoursData,
            ...additionalPayload
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                showToast('success', '保存しました');
            } else {
                showToast('error', '保存に失敗しました: ' + (data.message || ''));
            }
        })
        .catch(error => {
            showToast('error', '保存に失敗しました: ' + error.message);
        })
        .finally(() => {
            saveBtn.disabled = false;
            saveBtn.textContent = '保存';
        });
}
