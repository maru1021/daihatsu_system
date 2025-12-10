// ========================================
// 鋳造系生産計画モジュール - エントリーポイント
// ========================================
// このファイルから全ての機能をインポートして使用します
//
// 使用例:
// <script type="module">
//   import { CastingPlan } from './shared/casting/index.js';
//   const plan = new CastingPlan(itemData, previousMonthInventory, colorMap);
//   plan.initialize();
// </script>

// 各モジュールからインポート
import * as Utils from './utils.js';
import * as Cache from './cache.js';
import * as Inventory from './inventory.js';
import * as Calculation from './calculation.js';
import * as Control from './control.js';
import * as Initialization from './initialization.js';

/**
 * 鋳造系生産計画クラス
 * 全ての機能を統合して管理
 */
export class CastingPlan {
    constructor(itemData, previousMonthInventory, colorMap = {}) {
        // データ
        this.itemData = itemData;
        this.previousMonthInventory = previousMonthInventory;
        this.colorMap = colorMap;

        // 状態
        this.state = {
            isInitializing: true
        };

        // キャッシュ
        this.caches = {
            domConstantCache: {
                dateCount: 0,
                totalMachines: 0,
                checkCells: null,
                facilityNumbers: null
            },
            selectElementCache: {
                day: [],
                night: []
            },
            moldCountDisplayCache: {
                day: [],
                night: []
            },
            inventoryElementCache: null,
            inventoryCardCache: null,
            overtimeInputCache: null,
            moltenMetalElementCache: null,
            vehicleSelectCache: null,
            moldChangeInputCache: null,
            selectContainerCache: null
        };
    }

    // ========================================
    // ユーティリティ関数
    // ========================================
    debounce = Utils.debounce;
    moveToNextShift = Utils.moveToNextShift;
    moveToPrevShift = Utils.moveToPrevShift;
    getItemNames = Utils.getItemNames;
    getInputElement = Utils.getInputElement;
    getInputValue = Utils.getInputValue;
    getCookie = Utils.getCookie;

    getMachineName(machineIndex) {
        return Utils.getMachineName(machineIndex, this.caches.domConstantCache);
    }

    getNextWorkingShift(dateIndex, shift, machineIndex) {
        return Utils.getNextWorkingShift(dateIndex, shift, machineIndex, this.caches);
    }

    getPrevWorkingShift(dateIndex, shift, machineIndex) {
        return Utils.getPrevWorkingShift(dateIndex, shift, machineIndex, this.caches);
    }

    // ========================================
    // キャッシュ構築
    // ========================================
    buildDOMCache(options = {}) {
        const result = Cache.buildDOMCache(options, this.caches);
        // 結果をキャッシュに統合
        Object.assign(this.caches, result);
        return result;
    }

    buildInventoryElementCache() {
        this.caches.inventoryElementCache = Cache.buildInventoryElementCache();
        return this.caches.inventoryElementCache;
    }

    buildInventoryCardCache() {
        this.caches.inventoryCardCache = Cache.buildInventoryCardCache();
        return this.caches.inventoryCardCache;
    }

    buildOvertimeInputCache() {
        this.caches.overtimeInputCache = Cache.buildOvertimeInputCache();
        return this.caches.overtimeInputCache;
    }

    buildMoltenMetalElementCache() {
        this.caches.moltenMetalElementCache = Cache.buildMoltenMetalElementCache();
        return this.caches.moltenMetalElementCache;
    }

    // ========================================
    // 在庫計算
    // ========================================
    calculateInventory(dateIndex, shift, itemName) {
        Inventory.calculateInventory(
            dateIndex,
            shift,
            itemName,
            this.caches.inventoryElementCache,
            this.previousMonthInventory
        );
    }

    recalculateAllInventory() {
        const result = Inventory.recalculateAllInventory(
            this.state,
            this.caches,
            this.itemData,
            this.previousMonthInventory
        );

        // 行合計と溶湯計算を非同期で更新
        if (result && typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(() => {
                this.calculateRowTotals();
                this.calculateMoltenMetalPotAndCore();
            }, { timeout: 100 });
        } else if (result) {
            setTimeout(() => {
                this.calculateRowTotals();
                this.calculateMoltenMetalPotAndCore();
            }, 50);
        }
    }

    updateInventoryComparisonCard(allItemNamesArray = null, dateCount = null) {
        Inventory.updateInventoryComparisonCard(
            allItemNamesArray,
            dateCount,
            this.caches,
            this.itemData,
            this.previousMonthInventory
        );
    }

    // ========================================
    // 計算
    // ========================================
    calculateMoltenMetalPotAndCore() {
        Calculation.calculateMoltenMetalPotAndCore(this.caches, this.itemData);
    }

    calculateRowTotals() {
        Calculation.calculateRowTotals(this.caches);
    }

    // ========================================
    // 制御
    // ========================================
    toggleCheck(element) {
        Control.toggleCheck(element, () => this.updateWorkingDayStatus());
    }

    initializeWeekendWorkingStatus() {
        Control.initializeWeekendWorkingStatus();
    }

    updateWorkingDayStatus(recalculate = true) {
        Control.updateWorkingDayStatus(
            recalculate,
            this.caches,
            (dateIndex, shift) => this.calculateProduction(dateIndex, shift),
            () => this.recalculateAllInventory(),
            () => this.updateOvertimeInputVisibility()
        );
    }

    updateSelectColor(select) {
        Control.updateSelectColor(select, this.colorMap);
    }

    updateOvertimeInputVisibility() {
        Control.updateOvertimeInputVisibility(this.caches);
    }

    // ========================================
    // 初期化フラグ制御
    // ========================================
    setInitializing(value) {
        this.state.isInitializing = value;
    }

    isInitializing() {
        return this.state.isInitializing;
    }

    // ========================================
    // キャッシュアクセス（後方互換性のため）
    // ========================================
    getCaches() {
        return this.caches;
    }

    getCache(cacheName) {
        return this.caches[cacheName];
    }
}

// 個別の関数もエクスポート（既存コードとの互換性のため）
// Utils
export const debounce = Utils.debounce;
export const moveToNextShift = Utils.moveToNextShift;
export const moveToPrevShift = Utils.moveToPrevShift;
export const getMachineName = Utils.getMachineName;
export const getNextWorkingShift = Utils.getNextWorkingShift;
export const getPrevWorkingShift = Utils.getPrevWorkingShift;
export const getNextWorkingShiftSelect = Utils.getNextWorkingShiftSelect;
export const getPrevWorkingShiftSelect = Utils.getPrevWorkingShiftSelect;
export const getItemNames = Utils.getItemNames;
export const getInputElement = Utils.getInputElement;
export const getInputValue = Utils.getInputValue;
export const getElementValue = Utils.getElementValue;
export const setElementValue = Utils.setElementValue;
export const getCookie = Utils.getCookie;

// Cache
export const buildDOMCache = Cache.buildDOMCache;
export const buildInventoryElementCache = Cache.buildInventoryElementCache;
export const buildInventoryCardCache = Cache.buildInventoryCardCache;
export const buildOvertimeInputCache = Cache.buildOvertimeInputCache;
export const buildMoltenMetalElementCache = Cache.buildMoltenMetalElementCache;

// Inventory
export const calculateInventory = Inventory.calculateInventory;
export const recalculateAllInventory = Inventory.recalculateAllInventory;
export const updateInventoryComparisonCard = Inventory.updateInventoryComparisonCard;

// Calculation
export const sumInputValues = Calculation.sumInputValues;
export const calculateShiftTotalByItem = Calculation.calculateShiftTotalByItem;
export const calculateCombinedTotalByItem = Calculation.calculateCombinedTotalByItem;
export const calculateShiftTotalByMachine = Calculation.calculateShiftTotalByMachine;
export const calculateCombinedTotalByMachine = Calculation.calculateCombinedTotalByMachine;
export const calculateMoltenMetalPotAndCore = Calculation.calculateMoltenMetalPotAndCore;
export const calculateRowTotals = Calculation.calculateRowTotals;

// Control
export const toggleCheck = Control.toggleCheck;
export const initializeWeekendWorkingStatus = Control.initializeWeekendWorkingStatus;
export const updateWorkingDayStatus = Control.updateWorkingDayStatus;
export const updateSelectColor = Control.updateSelectColor;
export const updateOvertimeInputVisibility = Control.updateOvertimeInputVisibility;

// Initialization
export const buildAllCaches = Initialization.buildAllCaches;
export const initializeSelectColors = Initialization.initializeSelectColors;
export const performInitialCalculations = Initialization.performInitialCalculations;

// Save
import * as Save from './save.js';
export const saveProductionPlan = Save.saveProductionPlan;

// Auto
import * as Auto from './auto.js';
export const autoProductionPlan = Auto.autoProductionPlan;
export const applyAutoProductionPlan = Auto.applyAutoProductionPlan;

// Events
import * as Events from './events.js';
export const setupEventListeners = Events.setupEventListeners;
