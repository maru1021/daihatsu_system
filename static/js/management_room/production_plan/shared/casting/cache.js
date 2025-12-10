// ========================================
// キャッシュ構築モジュール
// ========================================
// DOM要素とデータをキャッシュしてパフォーマンスを最適化

import { getItemNames } from './utils.js';

/**
 * DOM要素をキャッシュして高速化
 * @param {Object} options - オプション
 * @param {boolean} options.includeMoldCount - 金型カウント表示をキャッシュするか（鋳造のみtrue、CVTはfalse）
 * @param {Object} caches - グローバルキャッシュオブジェクト
 * @returns {Object} 更新されたキャッシュ
 */
export function buildDOMCache(options = {}, caches) {
    const { includeMoldCount = false } = options;
    const { domConstantCache, selectElementCache, moldCountDisplayCache } = caches;

    // 定数値をキャッシュ（DOM検索を削減）
    domConstantCache.dateCount = document.querySelectorAll('thead tr:nth-child(2) th').length;
    domConstantCache.facilityNumbers = document.querySelectorAll('.facility-number');
    domConstantCache.totalMachines = domConstantCache.facilityNumbers.length / 4;
    domConstantCache.checkCells = document.querySelectorAll('.check-cell');

    // select要素を二次元配列でキャッシュ
    const dateCount = domConstantCache.dateCount;
    const totalMachines = domConstantCache.totalMachines;

    selectElementCache.day = [];
    selectElementCache.night = [];

    // 金型カウント表示のキャッシュ（鋳造のみ）
    if (includeMoldCount && moldCountDisplayCache) {
        moldCountDisplayCache.day = [];
        moldCountDisplayCache.night = [];
    }

    for (let d = 0; d < dateCount; d++) {
        selectElementCache.day[d] = [];
        selectElementCache.night[d] = [];

        if (includeMoldCount && moldCountDisplayCache) {
            moldCountDisplayCache.day[d] = [];
            moldCountDisplayCache.night[d] = [];
        }

        for (let m = 0; m < totalMachines; m++) {
            // select要素をキャッシュ
            selectElementCache.day[d][m] = document.querySelector(
                `.vehicle-select[data-shift="day"][data-date-index="${d}"][data-machine-index="${m}"]`
            );
            selectElementCache.night[d][m] = document.querySelector(
                `.vehicle-select[data-shift="night"][data-date-index="${d}"][data-machine-index="${m}"]`
            );

            // 金型カウント表示をキャッシュ（鋳造のみ）
            if (includeMoldCount && moldCountDisplayCache) {
                moldCountDisplayCache.day[d][m] = document.querySelector(
                    `.mold-count-display[data-shift="day"][data-date-index="${d}"][data-machine-index="${m}"]`
                );
                moldCountDisplayCache.night[d][m] = document.querySelector(
                    `.mold-count-display[data-shift="night"][data-date-index="${d}"][data-machine-index="${m}"]`
                );
            }
        }
    }

    // 旧形式のMapキャッシュも互換性のため維持（既存コードで使用されている可能性あり）
    const vehicleSelectCache = new Map();
    document.querySelectorAll('.vehicle-select').forEach(select => {
        const key = `${select.dataset.shift}-${select.dataset.dateIndex}-${select.dataset.machineIndex}`;
        vehicleSelectCache.set(key, select);
    });

    // 金型交換のinputをキャッシュ
    const moldChangeInputCache = new Map();
    document.querySelectorAll('.mold-change-input').forEach(input => {
        const key = `${input.dataset.shift}-${input.dataset.dateIndex}-${input.dataset.machineIndex}`;
        moldChangeInputCache.set(key, input);
    });

    // select-containerをキャッシュ
    // 型替えの色の制御に使用
    const selectContainerCache = Array.from(document.querySelectorAll('.select-container'));

    return {
        vehicleSelectCache,
        moldChangeInputCache,
        selectContainerCache
    };
}

/**
 * 在庫計算に必要な全入力要素をキャッシュ
 * @returns {Object} キャッシュオブジェクト
 */
export function buildInventoryElementCache() {
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
 * 月末在庫カード要素をキャッシュ
 * @returns {Object} キャッシュオブジェクト
 */
export function buildInventoryCardCache() {
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

/**
 * 残業inputのキャッシュを構築
 * @returns {Object} キャッシュオブジェクト
 */
export function buildOvertimeInputCache() {
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
 * 溶湯計算用の要素をキャッシュ（拡張版）
 * @returns {Object} キャッシュオブジェクト
 */
export function buildMoltenMetalElementCache() {
    const cache = {
        moltenMetal: {},
        potCount: {},
        core: {}
    };

    // 溶湯セルをキャッシュ
    document.querySelectorAll('tr[data-section="molten_metal"] td[data-date-index]').forEach(cell => {
        const shift = cell.closest('tr').dataset.shift;
        const dateIndex = cell.dataset.dateIndex;
        const key = `${shift}-${dateIndex}`;
        cache.moltenMetal[key] = cell;
    });

    // ポット数セルをキャッシュ
    document.querySelectorAll('tr[data-section="pot_count"] td[data-date-index]').forEach(cell => {
        const shift = cell.closest('tr').dataset.shift;
        const dateIndex = cell.dataset.dateIndex;
        const key = `${shift}-${dateIndex}`;
        cache.potCount[key] = cell;
    });

    // 中子セルをキャッシュ
    document.querySelectorAll('tr[data-section="core"] td[data-date-index]').forEach(cell => {
        const itemName = cell.closest('tr').dataset.item;
        const dateIndex = cell.dataset.dateIndex;
        const key = `${itemName}-${dateIndex}`;
        cache.core[key] = cell;
    });

    return cache;
}
