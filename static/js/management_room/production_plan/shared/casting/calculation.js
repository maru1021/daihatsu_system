// ========================================
// 計算モジュール
// ========================================
// 溶湯・ポット数・中子の計算、行合計の計算

import { getElementValue } from './utils.js';
import { buildMoltenMetalElementCache } from './cache.js';

/**
 * 要素の合計を計算（input、span等あらゆる要素に対応）
 * @param {NodeList} elements - 要素のリスト
 * @returns {number} 合計値
 */
export function sumValues(elements) {
    let sum = 0;
    elements.forEach(element => {
        sum += getElementValue(element);
    });
    return sum;
}

/**
 * 品番ごとの直別合計を計算（出庫、生産）
 * @param {string} className - 合計セルのクラス名
 * @param {string} elementClass - 要素のクラス名（input、span等）
 * @param {string} dataKey - data属性のキー名
 */
export function calculateShiftTotalByItem(className, elementClass, dataKey) {
    document.querySelectorAll(`.${className}`).forEach(cell => {
        const shift = cell.dataset.shift;
        const itemValue = cell.dataset[dataKey];
        const elements = document.querySelectorAll(`.${elementClass}[data-shift="${shift}"][data-${dataKey}="${itemValue}"]`);
        cell.textContent = sumValues(elements);
    });
}

/**
 * 設備ごとの直別合計を計算（金型交換、残業、計画停止）
 * @param {string} className - 合計セルのクラス名
 * @param {string} elementClass - 要素のクラス名（input、span等）
 */
export function calculateShiftTotalByMachine(className, elementClass) {
    document.querySelectorAll(`.${className}`).forEach(cell => {
        const shift = cell.dataset.shift;
        const machineIndex = cell.dataset.machineIndex;
        const elements = document.querySelectorAll(`.${elementClass}[data-shift="${shift}"][data-machine-index="${machineIndex}"]`);
        cell.textContent = sumValues(elements);
    });
}

/**
 * 品番ごとの日勤+夜勤合計を計算
 * @param {string} className - 合計セルのクラス名
 * @param {string} elementClass - 要素のクラス名（input、span等）
 * @param {string} dataKey - data属性のキー名
 */
export function calculateCombinedTotalByItem(className, elementClass, dataKey) {
    document.querySelectorAll(`.${className}`).forEach(cell => {
        const itemValue = cell.dataset[dataKey];
        const elements = document.querySelectorAll(`.${elementClass}[data-${dataKey}="${itemValue}"]`);
        cell.textContent = sumValues(elements);
    });
}

/**
 * 設備ごとの日勤+夜勤合計を計算
 * @param {string} className - 合計セルのクラス名
 * @param {string} elementClass - 要素のクラス名（input、span等）
 */
export function calculateCombinedTotalByMachine(className, elementClass) {
    document.querySelectorAll(`.${className}`).forEach(cell => {
        const machineIndex = cell.dataset.machineIndex;
        const elements = document.querySelectorAll(`.${elementClass}[data-machine-index="${machineIndex}"]`);
        cell.textContent = sumValues(elements);
    });
}

/**
 * 溶湯、ポット数、中子を計算
 * @param {Object} caches - キャッシュオブジェクト
 * @param {Object} itemData - 品番データ
 */
export function calculateMoltenMetalPotAndCore(caches, itemData) {
    const { moltenMetalElementCache, inventoryElementCache, domConstantCache } = caches;

    // キャッシュが未作成の場合は作成
    if (!moltenMetalElementCache) {
        caches.moltenMetalElementCache = buildMoltenMetalElementCache();
    }

    const dateCount = domConstantCache.dateCount;
    const itemNames = Object.keys(itemData);

    // molten_metal_usageを事前にキャッシュ（繰り返しアクセスを削減）
    // 品番と設備の組み合わせで保存されているため、最初の設備から取得
    const moltenMetalUsageCache = {};
    itemNames.forEach(itemName => {
        const machineData = itemData[itemName];
        if (machineData) {
            // 最初の設備のmolten_metal_usageを取得（全設備で同じ値）
            const firstMachine = Object.keys(machineData)[0];
            moltenMetalUsageCache[itemName] = machineData[firstMachine]?.molten_metal_usage || 0;
        } else {
            moltenMetalUsageCache[itemName] = 0;
        }
    });

    // 各直の計算（dayとnightを配列で管理）
    const shifts = ['day', 'night'];

    // 各日付・各直の計算
    for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
        for (let s = 0; s < 2; s++) {
            const shift = shifts[s];
            let moltenMetalTotal = 0;

            // 品番ごとの計算を1ループで実施
            for (let i = 0; i < itemNames.length; i++) {
                const itemName = itemNames[i];
                const productionElement = inventoryElementCache?.production[itemName]?.[shift]?.[dateIndex];

                if (productionElement) {
                    const productionValue = getElementValue(productionElement);

                    if (productionValue > 0) {
                        // 溶湯: 生産数 × 溶湯使用量
                        moltenMetalTotal += productionValue * moltenMetalUsageCache[itemName];

                        // 中子: 24の倍数に丸める（直接DOM更新）
                        const coreCount = Math.round(productionValue / 24) * 24;
                        const coreKey = `${itemName}-${dateIndex}`;
                        const coreCell = caches.moltenMetalElementCache.core[coreKey];
                        if (coreCell) {
                            coreCell.textContent = coreCount;
                        }
                    } else {
                        // 生産数が0の場合は中子をクリア
                        const coreKey = `${itemName}-${dateIndex}`;
                        const coreCell = caches.moltenMetalElementCache.core[coreKey];
                        if (coreCell) {
                            coreCell.textContent = '';
                        }
                    }
                }
            }

            // 溶湯を表示（キャッシュから取得）
            const moltenMetalKey = `${shift}-${dateIndex}`;
            const moltenMetalCell = caches.moltenMetalElementCache.moltenMetal[moltenMetalKey];
            if (moltenMetalCell) {
                moltenMetalCell.textContent = moltenMetalTotal > 0 ? Math.round(moltenMetalTotal) : '';
            }

            // ポット数を表示: 溶湯 / 1200 を小数点第1位で切り上げ（キャッシュから取得）
            const potCountCell = caches.moltenMetalElementCache.potCount[moltenMetalKey];
            if (potCountCell) {
                if (moltenMetalTotal > 0) {
                    const potCount = Math.ceil(moltenMetalTotal / 1200 * 10) / 10;
                    potCountCell.textContent = potCount.toFixed(1);
                } else {
                    potCountCell.textContent = '';
                }
            }
        }
    }
}

/**
 * 行合計を計算
 * @param {Object} caches - キャッシュオブジェクト
 */
export function calculateRowTotals(caches) {
    const { inventoryElementCache, domConstantCache } = caches;

    // 出庫数の合計（日勤・夜勤別）
    calculateShiftTotalByItem('delivery-total', 'delivery-display', 'item');

    // 出庫数の合計（日勤+夜勤）
    calculateCombinedTotalByItem('delivery-combined-total', 'delivery-display', 'item');

    // 生産台数の合計（日勤・夜勤別）
    calculateShiftTotalByItem('production-total', 'production-display', 'item');

    // 生産台数の合計（日勤+夜勤）
    calculateCombinedTotalByItem('production-combined-total', 'production-display', 'item');

    // 在庫の増減（生産台数合計 - 出庫数合計）
    // inventoryElementCacheを使用して高速化
    document.querySelectorAll('.inventory-difference-total').forEach(totalCell => {
        const itemName = totalCell.dataset.item;
        let productionTotal = 0;
        let deliveryTotal = 0;

        // キャッシュから直接値を取得
        if (inventoryElementCache) {
            const dateCount = domConstantCache.dateCount;
            for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
                // 日勤
                const productionDayElement = inventoryElementCache.production[itemName]?.day?.[dateIndex];
                const deliveryDayElement = inventoryElementCache.delivery[itemName]?.day?.[dateIndex];

                if (productionDayElement) productionTotal += getElementValue(productionDayElement);
                if (deliveryDayElement) deliveryTotal += getElementValue(deliveryDayElement);

                // 夜勤
                const productionNightElement = inventoryElementCache.production[itemName]?.night?.[dateIndex];
                const deliveryNightElement = inventoryElementCache.delivery[itemName]?.night?.[dateIndex];

                if (productionNightElement) productionTotal += getElementValue(productionNightElement);
                if (deliveryNightElement) deliveryTotal += getElementValue(deliveryNightElement);
            }
        }

        const difference = productionTotal - deliveryTotal;
        totalCell.textContent = difference >= 0 ? `+${difference}` : difference;
    });

    // 金型交換の合計（日勤・夜勤別）
    calculateShiftTotalByMachine('mold-change-total', 'mold-change-input');

    // 金型交換の合計（日勤+夜勤）
    calculateCombinedTotalByMachine('mold-change-combined-total', 'mold-change-input');

    // 残業計画の合計（日勤・夜勤別）
    calculateShiftTotalByMachine('overtime-total', 'overtime-input');

    // 残業計画の合計（日勤+夜勤）
    calculateCombinedTotalByMachine('overtime-combined-total', 'overtime-input');

    // 計画停止の合計（日勤・夜勤別）
    calculateShiftTotalByMachine('stop-time-total', 'stop-time-input');

    // 計画停止の合計（日勤+夜勤）
    calculateCombinedTotalByMachine('stop-time-combined-total', 'stop-time-input');
}
