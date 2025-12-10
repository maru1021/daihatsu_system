// ========================================
// CVT生産計画JavaScript
// ========================================
// 共通モジュール: ./shared/casting/ に定義（鋳造・CVT共通）
// - utils.js: ユーティリティ関数（debounce, getMachineName, getInputElement等）
// - cache.js: キャッシュ構築（buildDOMCache, buildInventoryElementCache等）
// - inventory.js: 在庫計算（recalculateAllInventory, calculateInventory等）
// - calculation.js: 集計計算（calculateRowTotals, calculateMoltenMetalPotAndCore等）
// - control.js: UI制御（updateSelectColor, toggleCheck, updateWorkingDayStatus等）
// - initialization.js: 初期化（buildAllCaches, initializeSelectColors, performInitialCalculations）
//
// CVTライン固有の特徴:
// - 定時時間: 日勤 455分、夜勤 450分
// - 金型管理: 金型カウント管理なし（金型交換時間の手動入力のみ）
// - シンプルな生産計算: calculateProduction（金型管理不要）
//
// ========================================
// パフォーマンス最適化の要点
// ========================================
// 1. キャッシュ戦略:
//    - DOM要素をキャッシュして繰り返しquerySelectorを回避
//    - 計算結果をキャッシュして重複計算を削減
// 2. 非同期処理:
//    - 重い計算（溶湯、ポット数、中子）をrequestIdleCallbackで遅延実行
//    - 初期表示を高速化（在庫計算 → 月末在庫カード → 行合計/溶湯は非同期）
// 3. チラつき防止:
//    - サーバーサイドでインラインスタイルを設定
//    - HTMLヘッダーにCSSルールを追加（!important）
//    - JavaScript初期化で最終確認
// 4. ループ最適化:
//    - forEach()よりもforループを使用（関数呼び出しのオーバーヘッド削減）
//    - 不要なDOM操作を削減（現在の状態をチェックしてから変更）

// ========================================
// モジュールインポート
// ========================================
import {
    debounce,
    buildDOMCache,
    buildInventoryElementCache,
    buildInventoryCardCache,
    buildOvertimeInputCache,
    buildMoltenMetalElementCache,
    recalculateAllInventory,
    calculateRowTotals,
    calculateMoltenMetalPotAndCore,
    updateSelectColor,
    updateWorkingDayStatus,
    updateOvertimeInputVisibility,
    initializeWeekendWorkingStatus,
    getMachineName,
    getInputElement,
    getInputValue,
    getCookie,
    toggleCheck,
    buildAllCaches as buildAllCachesShared,
    initializeSelectColors as initializeSelectColorsShared,
    performInitialCalculations as performInitialCalculationsShared
} from './shared/casting/index.js';

// ========================================
// 定数
// ========================================
// CVTラインの定時時間（分）
const REGULAR_TIME_DAY = 455;     // 日勤定時時間（分）
const REGULAR_TIME_NIGHT = 450;   // 夜勤定時時間（分）


// ========================================
// グローバル変数（HTMLから渡される）
// ========================================
/* global itemData, previousMonthInventory, colorMap, setupColumnHover */

// 初期化フラグ（ページ読み込み時はtrue、その後はfalse）
let isInitializing = true;

// ========================================
// グローバルスコープに公開（HTMLから直接呼び出されるため）
// ========================================
window.toggleCheck = function(element) {
    toggleCheck(element, () => updateWorkingDayStatusWrapper());
};

// ========================================
// グローバルキャッシュ（パフォーマンス最適化用）
// ========================================
let vehicleSelectCache = null;
let selectContainerCache = null;
let inventoryElementCache = null;
let inventoryCardCache = null;
let overtimeInputCache = null;
let moltenMetalElementCache = null;

// 頻繁にアクセスされる定数値のキャッシュ
let domConstantCache = {
    dateCount: 0,        // 日付数
    totalMachines: 0,    // 設備数
    checkCells: null,    // チェックセル
    facilityNumbers: null // 設備番号要素
};

// selectの二次元配列キャッシュ（O(1)アクセス）
// selectElementCache[shift][dateIndex][machineIndex] で直接アクセス可能
let selectElementCache = {
    day: [],
    night: []
};

// ========================================
// ラッパー関数（モジュール関数をローカルキャッシュで呼び出す）
// ========================================
function getCaches() {
    return {
        domConstantCache,
        selectElementCache,
        inventoryElementCache,
        inventoryCardCache,
        overtimeInputCache,
        moltenMetalElementCache,
        vehicleSelectCache,
        selectContainerCache
    };
}

function buildDOMCacheWrapper(options = {}) {
    const caches = getCaches();
    const result = buildDOMCache(options, caches);
    // 結果をローカルキャッシュに反映
    vehicleSelectCache = result.vehicleSelectCache;
    selectContainerCache = result.selectContainerCache;
}

function recalculateAllInventoryWrapper() {
    const state = { isInitializing };
    const caches = getCaches();
    const result = recalculateAllInventory(state, caches, itemData, previousMonthInventory);

    // 行合計と溶湯計算を非同期で更新
    if (result && typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => {
            calculateRowTotalsWrapper();
            calculateMoltenMetalPotAndCoreWrapper();
        }, { timeout: 100 });
    } else if (result) {
        setTimeout(() => {
            calculateRowTotalsWrapper();
            calculateMoltenMetalPotAndCoreWrapper();
        }, 50);
    }
}

function calculateRowTotalsWrapper() {
    const caches = getCaches();
    calculateRowTotals(caches);
}

function calculateMoltenMetalPotAndCoreWrapper() {
    const caches = getCaches();
    calculateMoltenMetalPotAndCore(caches, itemData);
}

function updateSelectColorWrapper(select) {
    updateSelectColor(select, colorMap);
}

function updateWorkingDayStatusWrapper(recalculate = true) {
    const caches = getCaches();
    updateWorkingDayStatus(
        recalculate,
        caches,
        calculateProduction,
        recalculateAllInventoryWrapper,
        updateOvertimeInputVisibilityWrapper
    );
}

function updateOvertimeInputVisibilityWrapper() {
    const caches = getCaches();
    updateOvertimeInputVisibility(caches);
}

function getMachineNameWrapper(machineIndex) {
    return getMachineName(machineIndex, domConstantCache);
}

// ========================================
// 生産計画セレクト色管理（共通モジュール使用）
// ========================================
function initializeSelectColors() {
    initializeSelectColorsShared({
        updateSelectColorWrapper,
        applyItemChangeHighlights,
        onSelectChange: (select, dateIndex, shift, machineIndex) => {
            // CVTラインは金型カウント管理なし - 生産台数と在庫を直接計算
            calculateProduction(dateIndex, shift);
            recalculateAllInventoryWrapper();
        }
    });
}
// ========================================
// 品番変更ハイライト + 型替え時間自動設定（手動操作時・自動生成後）
// ========================================
function applyItemChangeHighlights() {
    // キャッシュが未構築の場合は構築
    if (!vehicleSelectCache || !selectContainerCache) {
        buildDOMCacheWrapper();
    }

    // CVTラインは金型交換・型替えハイライト処理をスキップ
    // 全日付の生産数を再計算
    const dateCount = domConstantCache.dateCount;
    for (let i = 0; i < dateCount; i++) {
        calculateProduction(i, 'day');
        calculateProduction(i, 'night');
    }
    // 在庫も再計算
    recalculateAllInventoryWrapper();
}

// recalculateAllInventory関数は shared/casting.js に移動しました

// ========================================
// 生産台数計算
// ========================================
function calculateProduction(dateIndex, shift) {
    // 週末で休出がチェックされていない場合は計算しない
    const checkCells = domConstantCache.checkCells;
    const checkCell = checkCells[dateIndex];
    if (checkCell) {
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const checkText = checkCell.textContent.trim();
        if (isWeekend && checkText !== '休出') {
            // 生産台数inputをクリア（キャッシュを使用、shared/casting.jsの構造に対応）
            if (inventoryElementCache) {
                Object.keys(inventoryElementCache.production).forEach(itemName => {
                    const productionInput = inventoryElementCache.production[itemName]?.[shift]?.[dateIndex];
                    if (productionInput) {
                        productionInput.value = '';
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
                totalMoldChange: 0,
                totalProduction: 0,
                totalGoodProduction: 0
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

        // この設備の金型交換時間を取得（統一された関数を使用）
        const moldChangeInput = getInputElement(
            `.mold-change-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );
        const moldChangeTime = moldChangeInput ? getInputValue(moldChangeInput) : 0;
        if (moldChangeInput) {
            itemStats[selectedItem].totalMoldChange += moldChangeTime;
        }

        // この設備の残業時間を取得（統一された関数を使用）
        // CVTラインは金型交換が不要なので残業時間を常に含む
        const overtimeInput = getInputElement(
            `.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );
        if (overtimeInput) {
            itemStats[selectedItem].totalOvertime += getInputValue(overtimeInput);
        }
    });

    // 各品番の生産台数を計算して表示
    // 各設備ごとに計算してから合計する（バックエンドと同じ方法）
    productionPlanSelects.forEach(select => {
        // 非表示のselectはスキップ（週末で休出がない場合など）
        const container = select.closest('.select-container');
        if (container && container.style.display === 'none') return;

        const selectedItem = select.value;
        if (!selectedItem) return;

        const machineIndex = parseInt(select.dataset.machineIndex);
        const machineName = getMachineNameWrapper(machineIndex);
        if (!machineName) return;

        // 品番と設備の組み合わせでタクト・良品率を取得
        const data = itemData[selectedItem]?.[machineName];
        if (!data || data.tact === 0) return;

        // この設備の計画停止時間を取得
        const stopTimeInput = getInputElement(
            `.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );
        const stopTime = stopTimeInput ? getInputValue(stopTimeInput) : 0;

        // この設備の金型交換時間を取得
        const moldChangeInput = getInputElement(
            `.mold-change-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );
        const moldChangeTime = moldChangeInput ? getInputValue(moldChangeInput) : 0;

        // この設備の残業時間を取得
        // CVTラインは金型交換が不要なので残業時間を常に含む
        const overtimeInput = getInputElement(
            `.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );
        let overtime = 0;
        if (overtimeInput) {
            overtime = getInputValue(overtimeInput);
        }

        // この設備の稼働時間 = 基本稼働時間 - 計画停止時間 - 金型交換時間 + 残業時間
        const workingTime = Math.max(0, baseTime - stopTime - moldChangeTime + overtime);

        // この設備の生産台数 = (稼働時間 / タクト) × 稼働率（不良品も含む数量）
        const production = Math.floor((workingTime / data.tact) * operationRate);

        // この設備の良品生産数 = 生産台数 × 良品率
        const yieldRate = data.yield_rate || 1.0;
        const goodProduction = Math.floor(production * yieldRate);

        // 品番ごとに合計
        itemStats[selectedItem].totalProduction += production;
        itemStats[selectedItem].totalGoodProduction += goodProduction;
    });

    // 各品番の生産台数をinputに設定
    Object.keys(itemStats).forEach(itemName => {
        const stats = itemStats[itemName];
        const totalProduction = stats.totalProduction || 0;
        const totalGoodProduction = stats.totalGoodProduction || 0;

        // 生産台数inputに良品生産数を設定（キャッシュを使用、shared/casting.jsの構造に対応）
        // 在庫として扱われるのは良品のみのため
        const productionInput = inventoryElementCache?.production[itemName]?.[shift]?.[dateIndex];
        if (productionInput) {
            productionInput.value = totalGoodProduction;
        }
    });

    // 選択されていない品番のinputは空にする（キャッシュを使用、shared/casting.jsの構造に対応）
    if (inventoryElementCache) {
        Object.keys(inventoryElementCache.production).forEach(itemName => {
            if (!itemStats[itemName]) {
                const productionInput = inventoryElementCache.production[itemName]?.[shift]?.[dateIndex];
                if (productionInput) {
                    productionInput.value = '';
                }
            }
        });
    }

    // 初期化中でない場合のみ在庫数を再計算
    if (!isInitializing) {
        recalculateAllInventoryWrapper();
    }
}
// ========================================
// イベントリスナー設定
// ========================================
function setupEventListeners() {
    // デバウンスされた再計算関数を作成
    const debouncedRecalculateInventory = debounce(recalculateAllInventoryWrapper, 300);
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
        input.addEventListener('input', function () {
            debouncedRecalculateInventory();
        });
    });

    // 出庫数入力の変更を監視（デバウンス適用）
    document.querySelectorAll('.delivery-input').forEach(input => {
        input.addEventListener('input', function () {
            debouncedRecalculateInventory();
        });
    });

    // 在庫数入力の手動変更を監視（フラグ設定のみ）
    document.querySelectorAll('.inventory-input').forEach(input => {
        input.addEventListener('input', function () {
            // 手動修正フラグを設定（自動計算での上書きを防ぐ）
            this.dataset.manualEdit = 'true';
        });
    });

    // 在庫調整入力の変更を監視（デバウンス適用）
    // 在庫調整が変更されると、在庫数が自動的に再計算される
    document.querySelectorAll('.stock-adjustment-input').forEach(input => {
        input.addEventListener('input', function () {
            // キャッシュを再構築して最新の在庫調整値を反映
            inventoryElementCache = buildInventoryElementCache();
            // 全品番・全直の在庫を再計算
            debouncedRecalculateInventory();
        });
    });
}

// ========================================
// キャッシュ一括構築（共通モジュール使用）
// ========================================
function buildAllCaches() {
    buildAllCachesShared({
        setInventoryElementCache: (cache) => { inventoryElementCache = cache; },
        setInventoryCardCache: (cache) => { inventoryCardCache = cache; },
        setOvertimeInputCache: (cache) => { overtimeInputCache = cache; },
        setMoltenMetalElementCache: (cache) => { moltenMetalElementCache = cache; }
    });
}

// ========================================
// 初期計算実行（共通モジュール使用）
// ========================================
function performInitialCalculations() {
    return performInitialCalculationsShared({
        domConstantCache,
        setInitializing: (value) => { isInitializing = value; },
        calculateProduction,
        recalculateAllInventoryWrapper
        // beforeCalculation: CVTは前月金型処理なし
    });
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

        // CVTラインは金型カウント管理なし
        planData.push({
            date_index: dateIndex,
            shift: shift,
            machine_index: machineIndex,
            item_name: itemName,
            mold_count: 0,  // CVTでは使用しない
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

    // CVTラインは金型管理なし
    const usableMoldsData = [];

    // CSRFトークンを取得
    const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]')?.value || getCookie('csrftoken');

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
            usable_molds_data: usableMoldsData,
            occupancy_rate_data: occupancyRateData,
            regular_working_hours_data: regularWorkingHoursData
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
        showToast('error', '対象月を選択してください');
        autoBtn.disabled = false;
        autoBtn.textContent = '自動';
        return;
    }

    // ローディング表示を開始
    if (typeof showLoading === 'function') {
        showLoading();
    }

    const [year, month] = selectedMonth.split('-');
    const lineSelect = document.getElementById('line-select');
    const lineId = (typeof $ !== 'undefined' && $(lineSelect).data('select2'))
        ? $(lineSelect).val()
        : lineSelect.value;

    // 計画停止データを収集
    const stopTimeData = [];
    const stopTimeInputs = document.querySelectorAll('.stop-time-input');
    stopTimeInputs.forEach(input => {
        if (input.style.display !== 'none' && input.value) {
            const dateIndex = parseInt(input.dataset.dateIndex);
            const shift = input.dataset.shift;
            const machineIndex = parseInt(input.dataset.machineIndex);
            const stopTime = parseInt(input.value) || 0;

            // 日付を取得
            const dateHeaders = document.querySelectorAll('thead tr:nth-child(2) th');
            if (dateIndex < dateHeaders.length) {
                const dateText = dateHeaders[dateIndex].textContent.trim();
                const match = dateText.match(/(\d+)\/(\d+)/);
                if (match) {
                    const monthNum = parseInt(match[1]);
                    const day = parseInt(match[2]);
                    const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                    stopTimeData.push({
                        date: dateStr,
                        shift: shift,
                        machine_id: machineIndex,
                        stop_time: stopTime
                    });
                }
            }
        }
    });

    // 休出日を収集
    const weekendWorkDates = [];
    const checkCells = domConstantCache.checkCells;
    checkCells.forEach((cell, index) => {
        const isWeekend = cell.getAttribute('data-weekend') === 'true';
        const checkText = cell.textContent.trim();

        if (isWeekend && checkText === '休出') {
            const dateHeaders = document.querySelectorAll('thead tr:nth-child(2) th');
            if (index < dateHeaders.length) {
                const dateText = dateHeaders[index].textContent.trim();
                const match = dateText.match(/(\d+)\/(\d+)/);
                if (match) {
                    const monthNum = parseInt(match[1]);
                    const day = parseInt(match[2]);
                    const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    weekendWorkDates.push(dateStr);
                }
            }
        }
    });

    // CSRFトークンを取得
    const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]')?.value || getCookie('csrftoken');

    if (!csrfToken) {
        showToast('error', 'CSRFトークンが取得できませんでした。ページをリロードしてください。');
        autoBtn.disabled = false;
        autoBtn.textContent = '自動';
        if (typeof hideLoading === 'function') {
            hideLoading();
        }
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
            stop_time_data: stopTimeData,
            weekend_work_dates: weekendWorkDates
        })
    })
        .then(response => response.json())
        .then(async data => {
            if (data.status === 'success') {
                // CVTラインは金型管理なし
                window.autoGeneratedUnusedMolds = [];

                // ローディング表示を終了
                if (typeof hideLoading === 'function') {
                    hideLoading();
                }

                // トーストを表示
                showToast('success', '自動生産計画を適用しました。保存ボタンを押してください。');

                // ブラウザにレンダリング時間を与えてから重い処理を実行
                await new Promise(resolve => requestAnimationFrame(resolve));
                await new Promise(resolve => requestAnimationFrame(resolve));

                // 生産計画を画面に非同期で反映
                await applyAutoProductionPlan(data.data);
            } else {
                if (typeof hideLoading === 'function') {
                    hideLoading();
                }
                showToast('error', '自動生産計画の生成に失敗しました: ' + (data.message || ''));
            }
        })
        .catch(error => {
            if (typeof hideLoading === 'function') {
                hideLoading();
            }
            showToast('error', '自動生産計画の生成に失敗しました: ' + error.message);
        })
        .finally(() => {
            autoBtn.disabled = false;
            autoBtn.textContent = '自動';
        });
}

async function applyAutoProductionPlan(planData) {
    // テーブルを一時的に非表示にしてReflow/Repaintを抑制
    const table = document.querySelector('.production-plan-table');
    if (table) {
        table.style.display = 'none';
    }

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

    // 鋳造機名とインデックスのマッピングを作成
    const machineIndexMap = {};
    const machineRows = document.querySelectorAll('.facility-number');

    // 生産計画の行は日勤N台、夜勤N台、型替えN台×2、残業N台×2、停止N台×2の計8セクションあるので、
    // 全体の1/8が設備数
    const machineCount = machineRows.length / 8;

    machineRows.forEach((row, index) => {
        const machineName = row.textContent.trim();
        // 日勤の生産計画行のみをマッピング（最初のmachineCount個）
        if (index < machineCount) {
            machineIndexMap[machineName] = index;
        }
    });

    let updatedCount = 0;
    let notFoundCount = 0;

    // 各プランを適用
    planData.forEach(plan => {
        const dateObj = new Date(plan.date + 'T00:00:00');
        const day = dateObj.getDate();

        // 日付のインデックスを取得
        const dateIndex = dateToIndexMap[day];

        if (dateIndex === undefined) {
            notFoundCount++;
            return;
        }

        const machineIndex = machineIndexMap[plan.machine_name];
        if (machineIndex === undefined) {
            notFoundCount++;
            return;
        }

        // 生産計画のselectを更新
        const planSelect = document.querySelector(
            `.vehicle-select[data-shift="${plan.shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );

        if (planSelect) {
            planSelect.value = plan.item_name;
            updateSelectColorWrapper(planSelect);
            updatedCount++;
        } else {
            notFoundCount++;
        }

        // 残業時間を更新
        const overtimeInput = document.querySelector(
            `.overtime-input[data-shift="${plan.shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );

        if (overtimeInput) {
            overtimeInput.value = plan.overtime;
        }

        // 型替え時間を更新
        const moldChangeInput = document.querySelector(
            `.mold-change-input[data-shift="${plan.shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );

        if (moldChangeInput) {
            const changeoverTime = plan.changeover_time || 0;
            moldChangeInput.value = changeoverTime;
        }
    });

    // ブラウザにレンダリング時間を与える
    await new Promise(resolve => requestAnimationFrame(resolve));

    // 生産台数を再計算（全日付のインデックスで）
    const allDateIndices = Object.values(dateToIndexMap);
    allDateIndices.forEach(dateIndex => {
        calculateProduction(dateIndex, 'day');
        calculateProduction(dateIndex, 'night');
    });

    // 在庫を再計算
    recalculateAllInventoryWrapper();

    // 品番変更をチェック（バックエンドで型替え時間を設定済みなので、ハイライトのみ適用）
    applyItemChangeHighlights();

    // テーブルを再表示
    if (table) {
        table.style.display = '';
    }
}
// ========================================
// 初期化
// ========================================
async function initialize() {
    // ページ読み込み時は既にloading.jsでローディングが表示されている

    const targetMonthInput = document.getElementById('target-month');
    const lineSelect = document.getElementById('line-select');
    const saveBtn = document.getElementById('save-btn');
    const autoBtn = document.getElementById('auto-btn');
    const scheduleTable = document.getElementById('schedule-table');

    // ========================================
    // ステップ1: 基本UIの初期化
    // ========================================

    // select2を初期化
    if (typeof $ !== 'undefined' && typeof $.fn.select2 !== 'undefined') {
        $(lineSelect).select2({
            theme: 'bootstrap-5',
            width: 'auto',
            placeholder: '選択してください',
            allowClear: false
        });
    }

    // ========================================
    // ステップ2: DOMキャッシュとデータキャッシュの構築
    // ========================================
    buildDOMCacheWrapper({ includeMoldCount: false });  // DOM要素をキャッシュ（CVTは金型カウントなし）
    buildAllCaches();                                    // 計算用キャッシュを一括構築

    // ========================================
    // ステップ3: 即座に表示が必要な初期化処理
    // ========================================
    initializeSelectColors();                // セレクトボックスの色を初期化
    updateOvertimeInputVisibilityWrapper();  // 残業inputの表示/非表示を初期化（チラつき防止）
    initializeWeekendWorkingStatus();        // 休出・定時状態を初期化

    // ========================================
    // ステップ4: イベントリスナーとインタラクション
    // ========================================
    setupEventListeners();              // イベントリスナーを設定
    setupColumnHover();                 // 列のホバー処理を設定

    // ========================================
    // ステップ5: 初期計算（非同期で段階的に実行）
    // ========================================
    await performInitialCalculations();

    // ========================================
    // ステップ6: 重い処理を遅延実行（ページ応答性を向上）
    // ========================================
    await new Promise(resolve => {
        setTimeout(() => {
            updateWorkingDayStatusWrapper(false);   // 稼働日状態を初期化（再計算なし）
            applyItemChangeHighlights();            // 型替えハイライトと残業制御を適用

            // ========================================
            // ステップ7: ページ初期化完了
            // ========================================
            // すべての初期化が完了したら、テーブルを表示
            if (scheduleTable) {
                scheduleTable.classList.remove('table-initializing');
                scheduleTable.classList.add('table-ready');
            }

            resolve();
        }, 0);
    });

    // ローディング非表示
    if (typeof hideLoading === 'function') {
        hideLoading();
    }

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
            showToast('error', 'ラインと対象月を選択してください');
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
// buildInventoryCardCache, updateInventoryComparisonCard 関数は shared/casting.js に移動しました

// ========================================
// 行合計の計算と更新
// ========================================
// calculateRowTotals関数は shared/casting.js に移動しました

// ========================================
// 溶湯、ポット数、中子の計算
// ========================================
// buildMoltenMetalElementCache, calculateMoltenMetalPotAndCore 関数は shared/casting.js に移動しました

// DOMContentLoadedイベントで初期化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
