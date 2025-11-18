// ========================================
// 鋳造生産計画JavaScript
// ========================================
// このファイルは加工生産計画(machining_production_plan.js)と統一された構造を持ちます
// 主な違い:
// - 定時時間: 鋳造 490/485分 vs 加工 455/450分
// - 設備選択: 鋳造は設備ごとに品番を選択、加工は生産数を直接入力
// - 在庫計算: 鋳造は設備ベースで自動計算、加工は手動入力と自動計算の混合

// ========================================
// 定数
// ========================================
const REGULAR_TIME_DAY = 490;     // 鋳造の日勤定時時間（分）
const REGULAR_TIME_NIGHT = 485;   // 鋳造の夜勤定時時間（分）
const OVERTIME_MAX_DAY = 120;     // 日勤の残業上限（分）
const OVERTIME_MAX_NIGHT = 60;    // 夜勤の残業上限（分）

// ========================================
// グローバル変数（HTMLから渡される）
// ========================================
// itemData - 品番データ（タクトと良品率）
// previousMonthInventory - 前月最終在庫
// previousMonthProductionPlans - 前月の生産計画（連続生産チェック用）
// これらはHTMLのscriptタグで設定される

// 初期化フラグ（ページ読み込み時はtrue、その後はfalse）
let isInitializing = true;

// ========================================
// ユーティリティ関数
// ========================================
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

// 品番リストを取得
function getItemNames() {
    const itemNames = [];
    document.querySelectorAll('[data-section="production"][data-shift="day"] .vehicle-label').forEach(label => {
        itemNames.push(label.textContent.trim());
    });
    return itemNames;
}

// 入力要素を取得
function getInputElement(selector) {
    return document.querySelector(selector);
}

// 入力値を取得（非表示の場合は0を返す）
function getInputValue(input) {
    return input && input.style.display !== 'none' ? (parseInt(input.value) || 0) : 0;
}

// セルのスタイルを設定
function setCellStyle(cell, value) {
    if (cell) {
        cell.textContent = value > 0 ? value : '';
        cell.style.fontWeight = 'bold';
        cell.style.textAlign = 'center';
    }
}

// CSRFトークンを取得
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
// 定時チェック機能
// ========================================
// デバウンスされたupdateWorkingDayStatus関数
const debouncedUpdateWorkingDayStatus = debounce(function (dateIndex) {
    updateWorkingDayStatus(dateIndex);
}, 100);

function toggleCheck(element) {
    const isWeekend = element.getAttribute('data-weekend') === 'true';
    const currentText = element.textContent;

    if (currentText === '') {
        element.textContent = isWeekend ? '休出' : '定時';
    } else {
        element.textContent = '';
    }

    // 日付インデックスを取得
    const dateIndex = Array.from(element.parentElement.children).indexOf(element) - 1;

    // デバウンスされた更新関数を呼び出し（特定の日付のみ更新）
    debouncedUpdateWorkingDayStatus(dateIndex);

    // 残業inputの表示/非表示を更新
    updateOvertimeInputVisibility();
}

// ========================================
// 週末の休出状態を初期化
// ========================================
function initializeWeekendWorkingStatus() {
    // 全ての日付のチェックセルを走査
    document.querySelectorAll('.check-cell').forEach(checkCell => {
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        if (!isWeekend) return;

        // DailyMachineCastingProductionPlanデータの有無で判断
        const hasWeekendWork = checkCell.getAttribute('data-has-weekend-work') === 'true';

        // データがあれば「休出」をセット、なければ空にする
        if (hasWeekendWork) {
            checkCell.textContent = '休出';
        } else {
            checkCell.textContent = '';
        }
    });
}

// ========================================
// 稼働日状態の更新
// ========================================
function updateWorkingDayStatus() {
    // 全ての日付のチェックセルを走査
    document.querySelectorAll('.check-cell').forEach(checkCell => {
        const dateStr = checkCell.getAttribute('data-date');
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const checkText = checkCell.textContent.trim();

        // 日付文字列から日付インデックスを取得（"10/1" -> 0）
        const dateIndex = Array.from(checkCell.parentElement.children).indexOf(checkCell) - 1;

        if (isWeekend) {
            // 週末の場合
            const isWorking = checkText === '休出';

            // 日勤の入力フィールドを制御（残業input以外） - 非表示で制御
            const dayInputs = document.querySelectorAll(
                `[data-shift="day"][data-date-index="${dateIndex}"] input`
            );
            dayInputs.forEach(input => {
                // 残業inputは除外（updateOvertimeInputVisibility()で制御）
                if (input.classList.contains('overtime-input')) {
                    return;
                }

                if (isWorking) {
                    input.style.display = '';
                } else {
                    input.style.display = 'none';
                }
            });

            // 生産計画のselectとコンテナを制御
            const daySelectContainers = document.querySelectorAll(
                `td[data-shift="day"][data-date-index="${dateIndex}"] .select-container`
            );
            daySelectContainers.forEach(container => {
                if (isWorking) {
                    container.style.display = '';
                } else {
                    container.style.display = 'none';
                }
            });

            // 稼働率入力を制御 - 非表示で制御
            const operationRateInput = document.querySelector(
                `.operation-rate-input[data-date-index="${dateIndex}"]`
            );
            if (operationRateInput) {
                if (isWorking) {
                    operationRateInput.style.display = '';
                } else {
                    operationRateInput.style.display = 'none';
                }
            }
        } else {
            // 平日の場合
            const isRegularTime = checkText === '定時';

            // 日勤の残業時間入力を制御（定数を使用）
            const dayOvertimeInputs = document.querySelectorAll(
                `.overtime-input[data-shift="day"][data-date-index="${dateIndex}"]`
            );
            dayOvertimeInputs.forEach(input => {
                if (isRegularTime) {
                    input.max = 0;
                    input.value = 0;
                } else {
                    input.max = OVERTIME_MAX_DAY;
                }
            });
        }
    });

    // 生産台数と在庫を再計算
    const dateCount = document.querySelectorAll('thead tr:nth-child(2) th').length;
    for (let i = 0; i < dateCount; i++) {
        calculateProduction(i, 'day');
        calculateProduction(i, 'night');
    }
    recalculateAllInventory();
}

// ========================================
// ドラッグ＆ドロップ機能
// ========================================
let draggedElement = null;

function dragStart(event) {
    // select要素をクリックした場合のみキャンセル（それ以外はドラッグ許可）
    const isSelectElement = event.target.tagName === 'SELECT' ||
        event.target.tagName === 'OPTION' ||
        event.target.closest('select');

    if (isSelectElement) {
        event.preventDefault();
        return false;
    }

    draggedElement = event.currentTarget;
    draggedElement.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/html', draggedElement.innerHTML);
}

function dragOver(event) {
    event.preventDefault(); // ドロップを許可するために必須
    event.dataTransfer.dropEffect = 'move';

    const targetContainer = event.target.closest('.select-container');
    if (targetContainer && targetContainer !== draggedElement) {
        // 前のdrag-overクラスを削除
        document.querySelectorAll('.drag-over').forEach(el => {
            if (el !== targetContainer) {
                el.classList.remove('drag-over');
            }
        });
        targetContainer.classList.add('drag-over');
    }

    return false;
}

function drop(event) {
    event.preventDefault();
    event.stopPropagation();

    const targetContainer = event.target.closest('.select-container');

    if (draggedElement && targetContainer && draggedElement !== targetContainer) {
        const draggedSelect = draggedElement.querySelector('.vehicle-select');
        const targetSelect = targetContainer.querySelector('.vehicle-select');

        if (draggedSelect && targetSelect) {
            // selectの値を入れ替え
            const tempValue = draggedSelect.value;
            draggedSelect.value = targetSelect.value;
            targetSelect.value = tempValue;

            // 色を更新
            updateSelectColor(draggedSelect);
            updateSelectColor(targetSelect);

            // 生産台数を再計算
            calculateProduction(parseInt(draggedSelect.dataset.dateIndex), draggedSelect.dataset.shift);
            calculateProduction(parseInt(targetSelect.dataset.dateIndex), targetSelect.dataset.shift);

            // 品番変更をチェック
            checkItemChanges();
        }
    }

    cleanupDragClasses();
    draggedElement = null;

    return false;
}

function cleanupDragClasses() {
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

// ドラッグイベントリスナー
document.addEventListener('dragend', cleanupDragClasses);
document.addEventListener('dragleave', function (event) {
    const targetContainer = event.target.closest('.select-container');
    if (targetContainer) {
        targetContainer.classList.remove('drag-over');
    }
});

// ========================================
// 生産計画セレクト色管理
// ========================================
function updateSelectColor(select) {
    const value = select.value || (typeof $ !== 'undefined' && $(select).val());
    select.setAttribute('data-vehicle', value);
}

function initializeSelectColors() {
    // デバウンスされた品番変更チェック関数（200ms遅延）
    const debouncedCheckItemChanges = debounce(checkItemChanges, 200);

    document.querySelectorAll('.vehicle-select').forEach(select => {
        updateSelectColor(select);

        select.addEventListener('change', function () {
            updateSelectColor(this);
            const dateIndex = parseInt(this.dataset.dateIndex);
            const shift = this.dataset.shift;
            calculateProduction(dateIndex, shift);
            debouncedCheckItemChanges();  // デバウンスされた品番変更チェック
        });
    });
}

// ========================================
// 品番変更チェック
// ========================================
function checkItemChanges() {
    // 全てのselect-containerから品番変更クラスを削除
    document.querySelectorAll('.select-container').forEach(container => {
        container.classList.remove('item-changed');
    });

    // 全ての金型交換を一旦0にリセット
    document.querySelectorAll('.mold-change-input').forEach(input => {
        if (input.style.display !== 'none') {
            input.value = 0;
        }
    });

    // 全ての生産計画selectを走査
    document.querySelectorAll('.vehicle-select').forEach(select => {
        const currentItem = select.value;
        const dateIndex = parseInt(select.dataset.dateIndex);
        const shift = select.dataset.shift;
        const machineIndex = parseInt(select.dataset.machineIndex);

        // 現在の直で品番が選択されていない場合はスキップ
        if (!currentItem) {
            return;
        }

        let shouldHighlight = false;

        // 次の直の品番を取得
        let nextSelect = null;
        if (shift === 'day') {
            // 日勤の場合、同じ日の夜勤を取得
            nextSelect = document.querySelector(
                `.vehicle-select[data-shift="night"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
            );
        } else {
            // 夜勤の場合、翌日の日勤を取得
            nextSelect = document.querySelector(
                `.vehicle-select[data-shift="day"][data-date-index="${dateIndex + 1}"][data-machine-index="${machineIndex}"]`
            );
        }

        // 次の直が存在し、品番が異なる場合は黄色にする
        if (nextSelect && nextSelect.value && currentItem !== nextSelect.value) {
            shouldHighlight = true;
        }

        // 6直連続チェック
        if (is6ConsecutiveShifts(dateIndex, shift, machineIndex, currentItem)) {
            shouldHighlight = true;
        }

        if (shouldHighlight) {
            const container = select.closest('.select-container');
            if (container) {
                container.classList.add('item-changed');
            }

            // 金型交換時間を75分に設定（黄色くハイライトされている現在の直）
            const moldChangeInput = getInputElement(
                `.mold-change-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
            );

            if (moldChangeInput && moldChangeInput.style.display !== 'none') {
                moldChangeInput.value = 75;
            }
        }
    });

    // 全ての日付・シフトの生産数を再計算（金型交換時間が変更されたため）
    const dateCount = document.querySelectorAll('thead tr:nth-child(2) th').length;
    for (let i = 0; i < dateCount; i++) {
        calculateProduction(i, 'day');
        calculateProduction(i, 'night');
    }
}

// 6直連続チェック関数（6の倍数直目でハイライト）
function is6ConsecutiveShifts(dateIndex, shift, machineIndex, currentItem) {
    if (!currentItem) return false;

    // 前の直から連続して同じ品番を作っている直数をカウント
    const consecutiveCount = getConsecutiveShiftCount(dateIndex, shift, machineIndex, currentItem);

    // 6の倍数直目（6, 12, 18, 24...）でハイライト
    // 品番が変更されるとカウントは自動的にリセットされる
    return consecutiveCount > 0 && consecutiveCount % 6 === 0;
}

// 前の直から連続して同じ品番を作っている直数をカウント（自身を含む）
// 土日など生産していない直はスキップして連続性をチェック
function getConsecutiveShiftCount(dateIndex, shift, machineIndex, currentItem) {
    if (!currentItem) return 0;

    let count = 1; // 自身をカウント
    let currentDateIndex = dateIndex;
    let currentShift = shift;

    // デバッグフラグ
    const debug = dateIndex === 21 && shift === 'day' && machineIndex === 0;

    // 機械名を取得（前月データ参照用）
    const machineNameElement = document.querySelector(
        `tr[data-machine-index="${machineIndex}"] .facility-number`
    );
    const machineName = machineNameElement ? machineNameElement.textContent.trim() : null;

    if (debug) console.log(`[COUNT DEBUG] Starting count for dateIndex=${dateIndex}, shift=${shift}, item=${currentItem}`);

    // 前の直を順番に確認
    // 最大で50直分の生産直を遡る（空の直はカウントしない）
    let maxProductionShifts = 50;
    let productionShiftsChecked = 0;
    let totalIterations = 0;
    let maxTotalIterations = 100; // 無限ループ防止

    while (productionShiftsChecked < maxProductionShifts && totalIterations < maxTotalIterations) {
        totalIterations++;

        // 前の直に移動
        if (currentShift === 'day') {
            // 日勤 -> 前日の夜勤
            currentDateIndex--;
            currentShift = 'night';
        } else {
            // 夜勤 -> 同じ日の日勤
            currentShift = 'day';
        }

        let prevItem = null;

        // 範囲外（前月）の場合
        if (currentDateIndex < 0) {
            // 前月データから取得
            if (!previousMonthProductionPlans || !machineName) break;

            // 前月データのインデックスを計算
            const prevMonthShiftIndex = previousMonthProductionPlans.length - 1 - (productionShiftsChecked);

            if (prevMonthShiftIndex >= 0 && prevMonthShiftIndex < previousMonthProductionPlans.length) {
                const prevMonthShift = previousMonthProductionPlans[prevMonthShiftIndex];
                prevItem = prevMonthShift.plans[machineName];
            } else {
                break;
            }
        } else {
            // 今月のデータから取得
            const prevSelect = document.querySelector(
                `.vehicle-select[data-shift="${currentShift}"][data-date-index="${currentDateIndex}"][data-machine-index="${machineIndex}"]`
            );

            if (prevSelect) {
                prevItem = prevSelect.value || null;
            }
        }

        // 品番が見つかった場合
        if (prevItem) {
            productionShiftsChecked++; // 生産直としてカウント

            if (debug) console.log(`  [prod:${productionShiftsChecked}, total:${totalIterations}] dateIndex=${currentDateIndex}, shift=${currentShift}, item=${prevItem}, match=${prevItem === currentItem}`);

            // 品番が一致する場合はカウントアップ
            if (prevItem === currentItem) {
                count++;
            } else {
                // 品番が異なる場合は中断
                if (debug) console.log(`  Different item found. Breaking. Final count=${count}`);
                break;
            }
        } else {
            // 空の直はスキップ（生産直としてカウントしない）
            if (debug) console.log(`  [total:${totalIterations}] dateIndex=${currentDateIndex}, shift=${currentShift}, item=EMPTY (skipping, not counted)`);
        }
    }

    if (debug) console.log(`[COUNT DEBUG] Final count=${count}`);
    return count;
}

// 前の5直分の品番を取得
function getPrevious5Shifts(dateIndex, shift, machineIndex) {
    const shifts = [];
    let currentDateIndex = dateIndex;
    let currentShift = shift;

    // 機械名を取得（前月データ参照用）
    const machineNameElement = document.querySelector(
        `tr[data-machine-index="${machineIndex}"] .facility-number`
    );
    const machineName = machineNameElement ? machineNameElement.textContent.trim() : null;

    for (let i = 0; i < 5; i++) {
        // 前の直に移動
        if (currentShift === 'day') {
            // 日勤 -> 前日の夜勤
            currentDateIndex--;
            currentShift = 'night';
        } else {
            // 夜勤 -> 同じ日の日勤
            currentShift = 'day';
        }

        // 範囲外（前月）の場合
        if (currentDateIndex < 0) {
            // 前月データから取得
            if (!previousMonthProductionPlans || !machineName) break;

            // 前の直のインデックス（0が一番古い、4が最新）
            // shift='day'の場合: i=0->4, i=1->3, i=2->2, i=3->1, i=4->0
            // shift='night'の場合: i=1->4, i=2->3, i=3->2, i=4->1 (i=0は当月データ)
            const prevMonthShiftIndex = (shift === 'night') ? (5 - i) : (4 - i);
            if (prevMonthShiftIndex >= 0 && prevMonthShiftIndex < previousMonthProductionPlans.length) {
                const prevMonthShift = previousMonthProductionPlans[prevMonthShiftIndex];
                const item = prevMonthShift.plans[machineName];
                if (item) {
                    shifts.push(item);
                } else {
                    break; // データがない場合は中断
                }
            } else {
                break;
            }
        } else {
            // 今月のデータから取得
            const prevSelect = document.querySelector(
                `.vehicle-select[data-shift="${currentShift}"][data-date-index="${currentDateIndex}"][data-machine-index="${machineIndex}"]`
            );

            if (prevSelect && prevSelect.value) {
                shifts.push(prevSelect.value);
            } else {
                break; // selectが存在しないか値がない場合は中断
            }
        }
    }

    return shifts;
}

// ========================================
// 在庫計算
// ========================================
// 高速化のため要素をキャッシュ
let inventoryElementCache = null;

function buildInventoryElementCache() {
    const cache = {
        inventory: {},
        delivery: {},
        production: {}
    };

    // 在庫入力要素をキャッシュ
    document.querySelectorAll('.inventory-input').forEach(input => {
        const shift = input.dataset.shift;
        const item = input.dataset.item;
        const dateIndex = input.dataset.dateIndex;
        const key = `${shift}-${item}-${dateIndex}`;
        cache.inventory[key] = input;
    });

    // 出庫入力要素をキャッシュ
    document.querySelectorAll('.delivery-input').forEach(input => {
        const shift = input.dataset.shift;
        const item = input.dataset.item;
        const dateIndex = input.dataset.dateIndex;
        const key = `${shift}-${item}-${dateIndex}`;
        cache.delivery[key] = input;
    });

    // 生産入力要素をキャッシュ（セルではなくinputに変更）
    document.querySelectorAll('.production-input').forEach(input => {
        const shift = input.dataset.shift;
        const item = input.dataset.item;
        const dateIndex = input.dataset.dateIndex;
        const key = `${shift}-${item}-${dateIndex}`;
        cache.production[key] = input;
    });

    return cache;
}

function calculateInventory(dateIndex, shift, itemName) {
    // キャッシュが未作成の場合は作成
    if (!inventoryElementCache) {
        inventoryElementCache = buildInventoryElementCache();
    }

    // 在庫数inputを取得
    const inventoryKey = `${shift}-${itemName}-${dateIndex}`;
    const inventoryInput = inventoryElementCache.inventory[inventoryKey];

    // 手動編集されている場合はスキップ（値を上書きしない）
    if (inventoryInput && inventoryInput.dataset.manualEdit === 'true') {
        return parseFloat(inventoryInput.value) || 0;
    }

    let previousInventory = 0;

    // 前の直の在庫を取得
    if (dateIndex === 0 && shift === 'day') {
        // 初日の日勤: 前月最終在庫
        previousInventory = previousMonthInventory[itemName] || 0;
    } else if (shift === 'day') {
        // 日勤: 前日の夜勤の在庫
        const prevKey = `night-${itemName}-${dateIndex - 1}`;
        const prevNightInventoryInput = inventoryElementCache.inventory[prevKey];
        previousInventory = parseFloat(prevNightInventoryInput?.value) || 0;
    } else {
        // 夜勤: その日の日勤の在庫
        const dayKey = `day-${itemName}-${dateIndex}`;
        const dayInventoryInput = inventoryElementCache.inventory[dayKey];
        previousInventory = parseFloat(dayInventoryInput?.value) || 0;
    }

    // 自身の直の出庫数を取得
    const deliveryKey = `${shift}-${itemName}-${dateIndex}`;
    const deliveryInput = inventoryElementCache.delivery[deliveryKey];
    const currentDelivery = parseFloat(deliveryInput?.value) || 0;

    // 自身の直の生産数を取得（inputに変更）
    const productionKey = `${shift}-${itemName}-${dateIndex}`;
    const currentProductionInput = inventoryElementCache.production[productionKey];
    const currentProduction = parseFloat(currentProductionInput?.value) || 0;

    // 在庫数 = 前の直の在庫 + 自身の直の生産数 - 自身の直の出庫数
    const inventory = previousInventory + currentProduction - currentDelivery;

    // 在庫数inputに値を設定
    if (inventoryInput) {
        const roundedInventory = Math.round(inventory);
        inventoryInput.value = roundedInventory;

        // 在庫が負の場合は赤色にする
        if (roundedInventory < 0) {
            inventoryInput.classList.add('negative-inventory');
        } else {
            inventoryInput.classList.remove('negative-inventory');
        }
    }

    return inventory;
}

function recalculateAllInventory() {
    // 初期化中は在庫再計算をスキップ
    if (isInitializing) {
        return;
    }

    // キャッシュが未作成の場合は作成
    if (!inventoryElementCache) {
        inventoryElementCache = buildInventoryElementCache();
    }

    // 全日付数を取得（ヘッダー行の列数）
    const dateCount = document.querySelectorAll('thead tr:nth-child(2) th').length;
    // itemDataとpreviousMonthInventoryの品番を統合
    const allItemNames = new Set([...Object.keys(itemData), ...Object.keys(previousMonthInventory)]);

    // 日勤→夜勤の順で計算（前の直の在庫に依存するため）
    for (let i = 0; i < dateCount; i++) {
        allItemNames.forEach(itemName => {
            calculateInventory(i, 'day', itemName);
            calculateInventory(i, 'night', itemName);
        });
    }

    // 在庫計算後に月末在庫カードをリアルタイムで更新
    updateInventoryComparisonCard();
}

// ========================================
// 生産台数計算
// ========================================
function calculateProduction(dateIndex, shift) {
    // 週末で休出がチェックされていない場合は計算しない
    const checkCells = document.querySelectorAll('.check-cell');
    const checkCell = checkCells[dateIndex];
    if (checkCell) {
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const checkText = checkCell.textContent.trim();
        if (isWeekend && checkText !== '休出') {
            // 生産台数inputをクリア（キャッシュを使用）
            if (inventoryElementCache) {
                Object.keys(inventoryElementCache.production).forEach(key => {
                    const [cellShift, , cellDateIndex] = key.split('-');
                    if (cellShift === shift && cellDateIndex === String(dateIndex)) {
                        inventoryElementCache.production[key].value = '';
                    }
                });
            }
            return;
        }
    }

    // 稼働率を取得（統一された関数を使用）
    const operationRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
    const operationRate = operationRateInput ? (parseFloat(operationRateInput.value) || 0) / 100 : 0;

    if (operationRate === 0) return;

    // 基本稼働時間（分）- 定数を使用
    const baseTime = shift === 'day' ? REGULAR_TIME_DAY : REGULAR_TIME_NIGHT;

    // その日のシフトの生産計画selectを取得
    const productionPlanSelects = document.querySelectorAll(
        `.vehicle-select[data-shift="${shift}"][data-date-index="${dateIndex}"]`
    );

    // 品番ごとに集計（機械数、計画停止時間、残業時間の合計）
    const itemStats = {};

    productionPlanSelects.forEach(select => {
        // 非表示のselectはスキップ（週末で休出がない場合など）
        const container = select.closest('.select-container');
        if (container && container.style.display === 'none') return;

        const selectedItem = select.value;
        if (!selectedItem) return;

        const machineIndex = parseInt(select.dataset.machineIndex);

        if (!itemStats[selectedItem]) {
            itemStats[selectedItem] = {
                machineCount: 0,
                totalStopTime: 0,
                totalOvertime: 0,
                totalMoldChange: 0
            };
        }

        itemStats[selectedItem].machineCount++;

        // この設備の計画停止時間を取得（統一された関数を使用）
        const stopTimeInput = getInputElement(
            `.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );
        if (stopTimeInput) {
            itemStats[selectedItem].totalStopTime += getInputValue(stopTimeInput);
        }

        // この設備の残業時間を取得（統一された関数を使用）
        const overtimeInput = getInputElement(
            `.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );
        if (overtimeInput) {
            itemStats[selectedItem].totalOvertime += getInputValue(overtimeInput);
        }

        // この設備の金型交換時間を取得（統一された関数を使用）
        const moldChangeInput = getInputElement(
            `.mold-change-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );
        if (moldChangeInput) {
            itemStats[selectedItem].totalMoldChange += getInputValue(moldChangeInput);
        }
    });

    // 各品番の生産台数を計算して表示
    Object.keys(itemStats).forEach(itemName => {
        const data = itemData[itemName];
        if (!data || data.tact === 0) return;

        const stats = itemStats[itemName];
        const avgStopTime = stats.totalStopTime / stats.machineCount;
        const avgOvertime = stats.totalOvertime / stats.machineCount;
        const avgMoldChange = stats.totalMoldChange / stats.machineCount;

        // 実際の稼働時間 = 基本稼働時間 - 平均計画停止時間 - 平均金型交換時間 + 平均残業時間
        const workingTime = baseTime - avgStopTime - avgMoldChange + avgOvertime;

        // 生産台数 = (稼働時間 / タクト) × 稼働率 × 良品率 × 設備数
        const production = Math.floor(
            (workingTime / data.tact) * operationRate * data.yield_rate * stats.machineCount
        );

        // 生産台数inputに値を設定（キャッシュを使用）
        const productionKey = `${shift}-${itemName}-${dateIndex}`;
        const productionInput = inventoryElementCache?.production[productionKey];
        if (productionInput) {
            productionInput.value = production;
        }
    });

    // 選択されていない品番のinputは空にする（キャッシュを使用）
    if (inventoryElementCache) {
        Object.keys(inventoryElementCache.production).forEach(key => {
            const [cellShift, cellItem, cellDateIndex] = key.split('-');
            if (cellShift === shift && cellDateIndex === String(dateIndex)) {
                if (!itemStats[cellItem]) {
                    inventoryElementCache.production[key].value = '';
                }
            }
        });
    }

    // 初期化中でない場合のみ在庫数を再計算
    if (!isInitializing) {
        recalculateAllInventory();
    }
}

// ========================================
// イベントリスナー設定
// ========================================
function setupEventListeners() {
    // デバウンスされた再計算関数を作成
    const debouncedRecalculateInventory = debounce(recalculateAllInventory, 300);
    const debouncedCalculateProduction = debounce(function (dateIndex, shift) {
        calculateProduction(dateIndex, shift);
    }, 200);

    // 稼働率入力の変更を監視
    document.querySelectorAll('.operation-rate-input').forEach(input => {
        input.addEventListener('input', function () {
            const dateIndex = parseInt(this.dataset.dateIndex);
            calculateProduction(dateIndex, 'day');
            calculateProduction(dateIndex, 'night');
        });
    });

    // 計画停止入力の変更を監視（デバウンス適用）
    document.querySelectorAll('.stop-time-input').forEach(input => {
        input.addEventListener('input', function () {
            const dateIndex = parseInt(this.dataset.dateIndex);
            const shift = this.dataset.shift;
            debouncedCalculateProduction(dateIndex, shift);
        });
    });

    // 残業入力の変更を監視（デバウンス適用）
    document.querySelectorAll('.overtime-input').forEach(input => {
        input.addEventListener('input', function () {
            const dateIndex = parseInt(this.dataset.dateIndex);
            const shift = this.dataset.shift;
            debouncedCalculateProduction(dateIndex, shift);
        });
    });

    // 金型交換入力の変更を監視（デバウンス適用）
    document.querySelectorAll('.mold-change-input').forEach(input => {
        input.addEventListener('input', function () {
            const dateIndex = parseInt(this.dataset.dateIndex);
            const shift = this.dataset.shift;
            debouncedCalculateProduction(dateIndex, shift);
        });
    });

    // 生産数入力の変更を監視（デバウンス適用）
    document.querySelectorAll('.production-input').forEach(input => {
        input.addEventListener('input', debouncedRecalculateInventory);
    });

    // 出庫数入力の変更を監視（デバウンス適用）
    document.querySelectorAll('.delivery-input').forEach(input => {
        input.addEventListener('input', debouncedRecalculateInventory);
    });

    // 在庫数入力の手動変更を監視（フラグ設定のみ）
    document.querySelectorAll('.inventory-input').forEach(input => {
        input.addEventListener('input', function () {
            // 手動修正フラグを設定（自動計算での上書きを防ぐ）
            this.dataset.manualEdit = 'true';
        });
    });

    // 生産計画selectの変更監視はinitializeSelectColors()で設定済み

    // ドラッグ&ドロップのイベントリスナーを設定
    document.querySelectorAll('.select-container').forEach(container => {
        container.addEventListener('dragstart', dragStart);
        container.addEventListener('dragover', dragOver);
        container.addEventListener('drop', drop);
    });
}

// ========================================
// 初期計算実行
// ========================================
function performInitialCalculations() {
    // 在庫計算用のキャッシュを事前構築（高速化）
    inventoryElementCache = buildInventoryElementCache();

    const dateCount = document.querySelectorAll('thead tr:nth-child(2) th').length;

    // 生産台数を計算
    for (let i = 0; i < dateCount; i++) {
        calculateProduction(i, 'day');
        calculateProduction(i, 'night');
    }

    // 在庫数はデータベースから読み込んだ値をそのまま使用
    // 生産数などが変更された時のみ再計算される

    // 品番変更をチェック
    checkItemChanges();

    // 初期化完了フラグを設定
    isInitializing = false;
}

// ========================================
// 保存機能
// ========================================
function saveProductionPlan() {
    const saveBtn = document.getElementById('save-btn');
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

        planData.push({
            date_index: dateIndex,
            shift: shift,
            machine_index: machineIndex,
            item_name: itemName,
            type: 'production_plan'
        });
    });

    // 在庫数データを収集（0でもすべて保存）
    const inventoryInputs = document.querySelectorAll('.inventory-input');
    inventoryInputs.forEach(input => {
        const dateIndex = parseInt(input.dataset.dateIndex);
        const shift = input.dataset.shift;
        const itemName = input.dataset.item;
        const stock = parseInt(input.value) || 0;

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
    const deliveryInputs = document.querySelectorAll('.delivery-input');
    deliveryInputs.forEach(input => {
        const dateIndex = parseInt(input.dataset.dateIndex);
        const shift = input.dataset.shift;
        const itemName = input.dataset.item;
        const delivery = parseInt(input.value) || 0;

        // 出庫数はすべて保存（週末で休出がなくても出庫がある場合がある）
        planData.push({
            date_index: dateIndex,
            shift: shift,
            item_name: itemName,
            delivery: delivery,
            type: 'delivery'
        });
    });

    // 生産台数データを収集（inputから取得）
    const productionInputs = document.querySelectorAll('.production-input');
    productionInputs.forEach(input => {
        const dateIndex = parseInt(input.dataset.dateIndex);
        const shift = input.dataset.shift;
        const itemName = input.dataset.item;
        const productionCount = parseInt(input.value) || 0;

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

    // CSRFトークンを取得
    const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]')?.value || getCookie('csrftoken');

    if (!csrfToken) {
        alert('CSRFトークンが取得できませんでした。ページをリロードしてください。');
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
            weekends_to_delete: weekendsToDelete
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                alert('保存しました');
            } else {
                alert('保存に失敗しました: ' + (data.message || ''));
            }
        })
        .catch(error => {
            alert('保存に失敗しました: ' + error.message);
        })
        .finally(() => {
            saveBtn.disabled = false;
            saveBtn.textContent = '保存';
        });
}

// ========================================
// 自動生産計画
// ========================================
function autoProductionPlan() {
    const autoBtn = document.getElementById('auto-btn');
    autoBtn.disabled = true;
    autoBtn.textContent = '計算中...';

    // 対象年月を取得
    const targetMonthInput = document.getElementById('target-month');
    const selectedMonth = targetMonthInput.value;

    if (!selectedMonth) {
        alert('対象月を選択してください');
        autoBtn.disabled = false;
        autoBtn.textContent = '自動';
        return;
    }

    const [year, month] = selectedMonth.split('-');
    const lineSelect = document.getElementById('line-select');
    const lineId = (typeof $ !== 'undefined' && $(lineSelect).data('select2'))
        ? $(lineSelect).val()
        : lineSelect.value;

    // CSRFトークンを取得
    const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]')?.value || getCookie('csrftoken');

    if (!csrfToken) {
        alert('CSRFトークンが取得できませんでした。ページをリロードしてください。');
        autoBtn.disabled = false;
        autoBtn.textContent = '自動';
        return;
    }

    // 自動生産計画APIを呼び出し
    fetch(`/management_room/production-plan/casting-production-plan/auto/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken
        },
        body: JSON.stringify({
            year: parseInt(year),
            month: parseInt(month),
            line_id: lineId,
            target_inventory: {}  // 月末目標在庫（今後追加可能）
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                // 生産計画を画面に反映
                applyAutoProductionPlan(data.data);
                alert('自動生産計画を適用しました。保存ボタンを押してください。');
            } else {
                alert('自動生産計画の生成に失敗しました: ' + (data.message || ''));
                if (data.traceback) {
                    console.error(data.traceback);
                }
            }
        })
        .catch(error => {
            alert('自動生産計画の生成に失敗しました: ' + error.message);
        })
        .finally(() => {
            autoBtn.disabled = false;
            autoBtn.textContent = '自動';
        });
}

function applyAutoProductionPlan(planData) {
    console.log('=== applyAutoProductionPlan ===');
    console.log('Total plans:', planData.length);

    // 日付ヘッダー行（2行目）から全日付とインデックスのマッピングを作成
    const dateHeaderRow = document.querySelector('thead tr:nth-child(2)');
    const dateHeaders = dateHeaderRow.querySelectorAll('th');
    const dateToIndexMap = {};

    dateHeaders.forEach((th, index) => {
        const text = th.textContent.trim();
        // "10/1(水)" のような形式から日付部分を抽出
        const match = text.match(/\d+\/(\d+)/);
        if (match) {
            const day = parseInt(match[1]);
            dateToIndexMap[day] = index;
        }
    });

    console.log('Date to index map:', dateToIndexMap);

    // 鋳造機名とインデックスのマッピングを作成
    const machineIndexMap = {};
    const machineRows = document.querySelectorAll('.facility-number');
    machineRows.forEach((row, index) => {
        const machineName = row.textContent.trim();
        // 残業計画の行は日勤4つ、夜勤4つあるので、最初の4つだけを使う
        if (index < 4) {
            machineIndexMap[machineName] = index;
        }
    });

    console.log('Machine index map:', machineIndexMap);

    let updatedCount = 0;
    let notFoundCount = 0;

    // 各プランを適用
    planData.forEach(plan => {
        const dateObj = new Date(plan.date + 'T00:00:00');
        const day = dateObj.getDate();

        // 日付のインデックスを取得
        const dateIndex = dateToIndexMap[day];

        if (dateIndex === undefined) {
            console.log(`Date index not found for day ${day}`);
            notFoundCount++;
            return;
        }

        const machineIndex = machineIndexMap[plan.machine_name];
        if (machineIndex === undefined) {
            console.log(`Machine index not found for ${plan.machine_name}`);
            notFoundCount++;
            return;
        }

        // 生産計画のselectを更新
        const planSelect = document.querySelector(
            `.vehicle-select[data-shift="${plan.shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );

        if (planSelect) {
            planSelect.value = plan.item_name;
            updateSelectColor(planSelect);
            updatedCount++;
        } else {
            console.log(`Select not found: shift=${plan.shift}, dateIndex=${dateIndex}, machineIndex=${machineIndex}`);
            notFoundCount++;
        }

        // 残業時間を更新
        const overtimeInput = document.querySelector(
            `.overtime-input[data-shift="${plan.shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );

        if (overtimeInput) {
            overtimeInput.value = plan.overtime;
        }
    });

    console.log(`Updated: ${updatedCount}, Not found: ${notFoundCount}`);

    // 生産台数を再計算（全日付のインデックスで）
    const allDateIndices = Object.values(dateToIndexMap);
    allDateIndices.forEach(dateIndex => {
        calculateProduction(dateIndex, 'day');
        calculateProduction(dateIndex, 'night');
    });

    // 在庫を再計算
    recalculateAllInventory();

    // 品番変更をチェック
    checkItemChanges();
}

// ========================================
// 初期化
// ========================================
function initialize() {
    const targetMonthInput = document.getElementById('target-month');
    const lineSelect = document.getElementById('line-select');
    const saveBtn = document.getElementById('save-btn');
    const autoBtn = document.getElementById('auto-btn');

    // select2を初期化
    if (typeof $ !== 'undefined' && typeof $.fn.select2 !== 'undefined') {
        $(lineSelect).select2({
            theme: 'bootstrap-5',
            width: 'auto',
            placeholder: '選択してください',
            allowClear: false
        });
    }

    // 初期表示時の処理
    initializeSelectColors();           // セレクトボックスの色を初期化
    setupEventListeners();              // イベントリスナーを設定
    initializeWeekendWorkingStatus();   // 休出状態を初期化
    updateWorkingDayStatus();           // 稼働日状態を初期化
    setupColumnHover();                 // 列のホバー処理を設定
    updateOvertimeInputVisibility();    // 残業inputの表示/非表示を初期化

    // キャッシュを事前構築（高速化）
    inventoryCardCache = buildInventoryCardCache();

    performInitialCalculations();       // 初期計算を実行（キャッシュ構築を含む、月末在庫カードも自動更新）

    // ボタンのイベントリスナー
    if (saveBtn) {
        saveBtn.addEventListener('click', saveProductionPlan);
    }
    if (autoBtn) {
        autoBtn.addEventListener('click', autoProductionPlan);
    }

    // 月・ライン変更時のハンドラー
    const handleChange = function () {
        const selectedLine = (typeof $ !== 'undefined' && $(lineSelect).data('select2'))
            ? $(lineSelect).val()
            : lineSelect.value;
        const selectedMonth = targetMonthInput.value;

        if (!selectedLine || !selectedMonth) {
            alert('ラインと対象月を選択してください');
            return;
        }

        const [year, month] = selectedMonth.split('-');
        window.location.href = `?line=${selectedLine}&year=${year}&month=${month}`;
    };

    // 月の変更時にデータを再取得
    if (targetMonthInput) {
        targetMonthInput.addEventListener('change', handleChange);
    }

    // ラインの変更時にデータを再取得
    if (typeof $ !== 'undefined' && typeof $.fn.select2 !== 'undefined') {
        $(lineSelect).on('change', handleChange);
    } else {
        lineSelect.addEventListener('change', handleChange);
    }
}

// ========================================
// セクションドラッグ&ドロップ機能は削除されました
// ========================================

// ========================================
// 月末在庫カード更新機能
// ========================================
// 月末在庫カード要素のキャッシュ
let inventoryCardCache = null;

function buildInventoryCardCache() {
    const cache = {};
    document.querySelectorAll('.monthly-plan-item').forEach(card => {
        const itemName = card.dataset.itemName;
        if (itemName) {
            cache[itemName] = {
                card: card,
                inventorySpan: card.querySelector('.end-of-month-inventory'),
                diffSpan: card.querySelector('.monthly-plan-diff'),
                optimalInventory: parseInt(card.dataset.optimalInventory) || 0
            };
        }
    });
    return cache;
}

function updateInventoryComparisonCard() {
    // キャッシュが未作成の場合は作成
    if (!inventoryCardCache) {
        inventoryCardCache = buildInventoryCardCache();
    }
    if (!inventoryElementCache) {
        inventoryElementCache = buildInventoryElementCache();
    }

    // 全日付数を取得
    const dateCount = document.querySelectorAll('thead tr:nth-child(2) th').length;

    // itemDataとpreviousMonthInventoryの品番を統合
    const allItemNames = new Set([...Object.keys(itemData), ...Object.keys(previousMonthInventory)]);

    allItemNames.forEach(itemName => {
        // 最後の日付の夜勤在庫を取得（月末在庫）
        let endOfMonthInventory = 0;

        // 最後の日付から逆順に検索して、最初に見つかった在庫値を使用
        for (let dateIndex = dateCount - 1; dateIndex >= 0; dateIndex--) {
            // まず夜勤をチェック
            const nightKey = `night-${itemName}-${dateIndex}`;
            const nightInventoryInput = inventoryElementCache.inventory[nightKey];
            if (nightInventoryInput && nightInventoryInput.style.display !== 'none') {
                endOfMonthInventory = parseInt(nightInventoryInput.value) || 0;
                break;
            }

            // 夜勤がなければ日勤をチェック
            const dayKey = `day-${itemName}-${dateIndex}`;
            const dayInventoryInput = inventoryElementCache.inventory[dayKey];
            if (dayInventoryInput && dayInventoryInput.style.display !== 'none') {
                endOfMonthInventory = parseInt(dayInventoryInput.value) || 0;
                break;
            }
        }

        // キャッシュから対応するカード要素を取得
        const cardData = inventoryCardCache[itemName];
        if (cardData && cardData.inventorySpan) {
            // マイナスの場合は"-"付きで表示
            if (endOfMonthInventory < 0) {
                cardData.inventorySpan.textContent = '-' + Math.abs(endOfMonthInventory);
            } else {
                cardData.inventorySpan.textContent = endOfMonthInventory;
            }

            // 差分を計算
            const difference = endOfMonthInventory - cardData.optimalInventory;

            // カードの背景色を変更
            cardData.card.classList.remove('shortage', 'excess');
            if (difference < 0) {
                cardData.card.classList.add('shortage');
            } else if (difference > 0) {
                cardData.card.classList.add('excess');
            }

            // 差分を更新（マイナスの場合は明示的に"-"を表示）
            if (cardData.diffSpan) {
                const sign = difference > 0 ? '+' : (difference < 0 ? '-' : '');
                const absDifference = Math.abs(difference);
                cardData.diffSpan.textContent = '(' + sign + absDifference + ')';
            }
        }
    });
}

// ========================================
// 列のホバー処理（日付セルのみ黄色）
// ========================================
function setupColumnHover() {
    const tbody = document.querySelector('tbody');
    if (!tbody) return;

    let currentHoverDateIndex = -1;

    tbody.addEventListener('mouseover', function(e) {
        const cell = e.target.closest('td, th');
        if (!cell) return;

        // tdセルのみを対象とする（thは固定列なので除外）
        if (cell.tagName !== 'TD') return;

        // data-date-indexを使って日付インデックスを取得
        const dateIndex = cell.getAttribute('data-date-index');
        if (dateIndex === null) return;

        const dateIndexNum = parseInt(dateIndex);

        // 同じ日付を再度ホバーした場合は何もしない
        if (dateIndexNum === currentHoverDateIndex) return;

        // 前の日付のハイライトを削除
        if (currentHoverDateIndex >= 0) {
            removeDateHighlight(currentHoverDateIndex);
        }

        // 新しい日付セルをハイライト
        currentHoverDateIndex = dateIndexNum;
        addDateHighlight(dateIndexNum);
    });

    tbody.addEventListener('mouseout', function(e) {
        // tbodyから完全に出た場合のみハイライトを削除
        if (!e.relatedTarget || !tbody.contains(e.relatedTarget)) {
            if (currentHoverDateIndex >= 0) {
                removeDateHighlight(currentHoverDateIndex);
                currentHoverDateIndex = -1;
            }
        }
    });
}

function addDateHighlight(dateIndex) {
    // dateIndexは data-date-index の値（0始まりの日付インデックス）

    // 最上部のヘッダー日付（thead内の2行目）
    // thead 2行目: インデックス0から日付列が始まる（rowspanで固定列は1行目に結合済み）
    const headerDateRow = document.querySelector('thead tr:nth-child(2)');
    if (headerDateRow && headerDateRow.children[dateIndex]) {
        headerDateRow.children[dateIndex].classList.add('date-hover');
    }

    // セクション日付ヘッダー（.section-date-header）
    // セクションヘッダー: インデックス0はcolspan=3、インデックス1以降が日付列
    const sectionDateHeaders = document.querySelectorAll('.section-date-header');
    sectionDateHeaders.forEach(row => {
        // セクションヘッダーの日付列は インデックス1から始まる（0はcolspan=3）
        const sectionDateIndex = dateIndex + 1;
        if (row.children[sectionDateIndex]) {
            row.children[sectionDateIndex].classList.add('date-hover');
        }
    });
}

function removeDateHighlight(dateIndex) {
    // dateIndexは data-date-index の値（0始まりの日付インデックス）

    // 最上部のヘッダー日付（thead内の2行目）
    // thead 2行目: インデックス0から日付列が始まる（rowspanで固定列は1行目に結合済み）
    const headerDateRow = document.querySelector('thead tr:nth-child(2)');
    if (headerDateRow && headerDateRow.children[dateIndex]) {
        headerDateRow.children[dateIndex].classList.remove('date-hover');
    }

    // セクション日付ヘッダー（.section-date-header）
    // セクションヘッダー: インデックス0はcolspan=3、インデックス1以降が日付列
    const sectionDateHeaders = document.querySelectorAll('.section-date-header');
    sectionDateHeaders.forEach(row => {
        // セクションヘッダーの日付列は インデックス1から始まる（0はcolspan=3）
        const sectionDateIndex = dateIndex + 1;
        if (row.children[sectionDateIndex]) {
            row.children[sectionDateIndex].classList.remove('date-hover');
        }
    });
}

// ========================================
// 残業inputの表示/非表示制御
// ========================================
function updateOvertimeInputVisibility() {
    const checkCells = document.querySelectorAll('.check-cell');

    checkCells.forEach((checkCell, dateIndex) => {
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const checkText = checkCell.textContent.trim();
        const isHolidayWork = checkText === '休出';
        const isRegularTime = checkText === '定時';

        // 残業inputを取得
        const dayOvertimeInputs = document.querySelectorAll(
            `.overtime-input[data-shift="day"][data-date-index="${dateIndex}"]`
        );
        const nightOvertimeInputs = document.querySelectorAll(
            `.overtime-input[data-shift="night"][data-date-index="${dateIndex}"]`
        );

        if (isWeekend && !isHolidayWork) {
            // 土日（休出なし）の場合：日勤・夜勤両方とも非表示
            dayOvertimeInputs.forEach(input => {
                input.style.display = 'none';
                input.value = 0;
            });
            nightOvertimeInputs.forEach(input => {
                input.style.display = 'none';
                input.value = 0;
            });
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
        } else if (isRegularTime) {
            // 定時の場合：日勤のみ非表示、夜勤は表示
            dayOvertimeInputs.forEach(input => {
                input.style.display = 'none';
                input.value = 0;
            });
            nightOvertimeInputs.forEach(input => {
                input.style.display = '';
            });
        } else {
            // それ以外は両方表示
            dayOvertimeInputs.forEach(input => {
                input.style.display = '';
            });
            nightOvertimeInputs.forEach(input => {
                input.style.display = '';
            });
        }
    });
}

// DOMContentLoadedイベントで初期化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
