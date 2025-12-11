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
    getNextWorkingShift,
    getPrevWorkingShift,
    getNextWorkingShiftSelect,
    getPrevWorkingShiftSelect,
    getInputElement,
    getInputValue,
    getElementValue,
    setElementValue,
    getCookie,
    toggleCheck,
    calculateMachineProduction,
    buildAllCaches as buildAllCachesShared,
    initializeSelectColors as initializeSelectColorsShared,
    performInitialCalculations as performInitialCalculationsShared,
    saveProductionPlan as saveProductionPlanShared,
    autoProductionPlan as autoProductionPlanShared,
    applyAutoProductionPlan as applyAutoProductionPlanShared,
    setupEventListeners as setupEventListenersShared
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
window.toggleCheck = function (element) {
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

    // CVTライン用の型替え時間自動設定
    // changeoverTimeが未定義の場合は警告
    if (typeof changeoverTime === 'undefined' || changeoverTime === null) {
        console.warn('changeoverTime is not defined. Changeover time will not be set.');
        // 型替え時間が設定できない場合でも生産計算は実行
        const dateCount = domConstantCache.dateCount;
        for (let i = 0; i < dateCount; i++) {
            calculateProduction(i, 'day');
            calculateProduction(i, 'night');
        }
        recalculateAllInventoryWrapper();
        return;
    }

    // 全てのselect-containerから品番変更クラスを削除
    selectContainerCache.forEach(container => {
        container.classList.remove('item-changed');
    });

    // 型替えが必要な直をトラッキング
    const shouldSetChangeover = new Set();

    // 全ての生産計画selectを走査（キャッシュから）
    vehicleSelectCache.forEach(select => {
        const item = select.value;
        const shift = select.dataset.shift;
        const dateIndex = parseInt(select.dataset.dateIndex);
        const machineIndex = parseInt(select.dataset.machineIndex);
        const key = `${shift}-${dateIndex}-${machineIndex}`;

        // 空の場合
        if (!item || item.trim() === '') {
            // 型替え時間をクリア
            const moldChangeInput = getInputElement(
                `.mold-change-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
            );
            if (moldChangeInput) {
                moldChangeInput.value = 0;
            }
            return;
        }

        // CVTラインは金型カウントなし - 次の直で品番が異なる場合のみ型替え
        // 土日や休日を跨いで次の稼働している直を取得（品番が入っているセルのみ）
        const nextSelect = getNextWorkingShiftSelect(dateIndex, shift, machineIndex, vehicleSelectCache);

        // 次の直で品番が異なる場合は型替え
        if (nextSelect && nextSelect.value !== item) {
            shouldSetChangeover.add(key);
        }
    });

    // 全てのセルに対して型替え時間を設定・クリア + ハイライトを適用
    vehicleSelectCache.forEach(select => {
        const shift = select.dataset.shift;
        const dateIndex = parseInt(select.dataset.dateIndex);
        const machineIndex = parseInt(select.dataset.machineIndex);
        const key = `${shift}-${dateIndex}-${machineIndex}`;

        const moldChangeInput = getInputElement(
            `.mold-change-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`
        );

        if (moldChangeInput) {
            if (shouldSetChangeover.has(key)) {
                // 型替え時間を設定
                moldChangeInput.value = changeoverTime;

                // ハイライト
                const container = select.closest('.select-container');
                if (container) {
                    container.classList.add('item-changed');
                }
            } else {
                // 型替え条件に該当しない場合は型替え時間をクリア
                moldChangeInput.value = 0;
            }
        }
    });

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
            // 生産台数をクリア（キャッシュを使用、shared/casting.jsの構造に対応）
            if (inventoryElementCache) {
                Object.keys(inventoryElementCache.production).forEach(itemName => {
                    const productionElement = inventoryElementCache.production[itemName]?.[shift]?.[dateIndex];
                    if (productionElement) {
                        setElementValue(productionElement, '');
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

        // 生産数を計算（共通関数を使用）
        const { totalProduction: production, goodProduction } = calculateMachineProduction(
            workingTime,
            data.tact,
            operationRate,
            data.yield_rate || 1.0
        );

        // 品番ごとに合計
        itemStats[selectedItem].totalProduction += production;
        itemStats[selectedItem].totalGoodProduction += goodProduction;
    });

    // 各品番の生産台数を設定
    Object.keys(itemStats).forEach(itemName => {
        const stats = itemStats[itemName];
        const totalProduction = stats.totalProduction || 0;
        const totalGoodProduction = stats.totalGoodProduction || 0;

        const productionElement = inventoryElementCache?.production[itemName]?.[shift]?.[dateIndex];
        if (productionElement) {
            // 表示：総生産数、data属性：良品生産数（在庫計算用）
            setElementValue(productionElement, totalProduction);
            productionElement.dataset.goodProduction = totalGoodProduction;
        }
    });

    // 選択されていない品番は空にする（キャッシュを使用、shared/casting.jsの構造に対応）
    if (inventoryElementCache) {
        Object.keys(inventoryElementCache.production).forEach(itemName => {
            if (!itemStats[itemName]) {
                const productionElement = inventoryElementCache.production[itemName]?.[shift]?.[dateIndex];
                if (productionElement) {
                    setElementValue(productionElement, '');
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
// イベントリスナー設定（共通モジュール使用）
// ========================================
function setupEventListeners() {
    setupEventListenersShared({
        calculateProduction,
        recalculateAllInventory: recalculateAllInventoryWrapper,
        rebuildInventoryCache: () => {
            inventoryElementCache = buildInventoryElementCache();
        },
        addMoldCountListeners: false  // CVTは金型カウント管理なし
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
// 保存機能（共通モジュール使用）
// ========================================
function saveProductionPlan() {
    saveProductionPlanShared({
        includeMoldCount: false,  // CVTは金型カウント管理なし
        getMoldCountData: null,   // CVT用の金型データ取得は不要
        getAdditionalData: null,  // CVT用の追加データなし
        domConstantCache,
        getCookie,
        showToast: window.showToast
    });
}

// ========================================
// 自動生産計画（共通モジュール使用）
// ========================================
function autoProductionPlan() {
    autoProductionPlanShared({
        domConstantCache,
        apiUrl: '/management_room/production-plan/cvt-production-plan/auto/',
        getCookie,
        showToast: window.showToast,
        showLoading: window.showLoading || (() => {}),
        hideLoading: window.hideLoading || (() => {}),
        onSuccess: async (data) => {
            // CVTラインは金型管理なし（自動生成で未使用金型は空配列）
            window.autoGeneratedUnusedMolds = [];
        },
        applyPlan: applyAutoProductionPlan
    });
}

async function applyAutoProductionPlan(planData) {
    await applyAutoProductionPlanShared(planData, {
        domConstantCache,
        updateSelectColor: updateSelectColorWrapper,
        calculateProduction,
        recalculateAllInventory: recalculateAllInventoryWrapper,
        applyItemChangeHighlights,
        onPlanApplied: null  // CVTは金型管理なし
    });
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
