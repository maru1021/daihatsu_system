// ========================================
// 在庫計算モジュール
// ========================================
// 在庫の計算と月末在庫カードの更新

import { moveToPrevShift, getInputValue, getElementValue, setElementValue } from './utils.js';
import { buildInventoryElementCache, buildInventoryCardCache } from './cache.js';

/**
 * 指定した日付・直・品番の在庫を計算
 * @param {number} dateIndex - 日付インデックス
 * @param {string} shift - 直（'day' or 'night'）
 * @param {string} itemName - 品番名
 * @param {Object} inventoryCache - 在庫要素キャッシュ
 * @param {Object} previousMonthInventory - 前月在庫データ
 */
export function calculateInventory(dateIndex, shift, itemName, inventoryCache, previousMonthInventory) {
    let previousInventory = 0;

    if (dateIndex === 0 && shift === 'day') {
        previousInventory = previousMonthInventory[itemName] || 0;
    } else {
        const prev = moveToPrevShift(dateIndex, shift);
        const prevElement = inventoryCache.inventory[itemName]?.[prev.shift]?.[prev.dateIndex];
        previousInventory = getElementValue(prevElement);
    }

    const deliveryElement = inventoryCache.delivery[itemName]?.[shift]?.[dateIndex];
    const delivery = getElementValue(deliveryElement);

    const productionElement = inventoryCache.production[itemName]?.[shift]?.[dateIndex];
    // 在庫計算では良品生産数を使用（data-good-production属性から取得）
    const production = productionElement?.dataset?.goodProduction
        ? parseFloat(productionElement.dataset.goodProduction) || 0
        : getElementValue(productionElement);  // 後方互換性

    const stockAdjustmentInput = inventoryCache.stockAdjustment[itemName]?.[shift]?.[dateIndex];
    const stockAdjustment = getInputValue(stockAdjustmentInput);

    const inventory = previousInventory - delivery + production + stockAdjustment;

    const inventoryElement = inventoryCache.inventory[itemName]?.[shift]?.[dateIndex];
    if (inventoryElement) {
        setElementValue(inventoryElement, inventory);

        // 在庫数に応じて背景色を設定
        if (inventory < 0) {
            // 在庫が負の場合は赤い背景色
            inventoryElement.style.backgroundColor = '#ffcccc';
        } else if (inventory > 1000) {
            // 在庫が1000を超える場合は薄い青い背景色
            inventoryElement.style.backgroundColor = '#cce5ff';
        } else {
            // それ以外は背景色をクリア
            inventoryElement.style.backgroundColor = '';
        }
    }
}

/**
 * 全在庫を再計算
 * @param {Object} state - アプリケーション状態
 * @param {Object} caches - キャッシュオブジェクト
 * @param {Object} itemData - 品番データ
 * @param {Object} previousMonthInventory - 前月在庫データ
 */
export function recalculateAllInventory(state, caches, itemData, previousMonthInventory) {
    // 初期化中は在庫再計算をスキップ
    if (state.isInitializing) {
        return;
    }

    const { inventoryElementCache, domConstantCache } = caches;

    // キャッシュが未作成の場合は作成
    if (!inventoryElementCache) {
        caches.inventoryElementCache = buildInventoryElementCache();
    }

    // 全日付数を取得（ヘッダー行の列数）
    const dateCount = domConstantCache.dateCount;

    // itemDataとpreviousMonthInventoryの品番を統合（高速化：配列で管理）
    const itemDataKeys = Object.keys(itemData);
    const prevKeys = Object.keys(previousMonthInventory);
    const allItemNamesArray = [...new Set([...itemDataKeys, ...prevKeys])];

    // 日勤→夜勤の順で計算（前の直の在庫に依存するため）
    for (let i = 0; i < dateCount; i++) {
        for (let j = 0; j < allItemNamesArray.length; j++) {
            const itemName = allItemNamesArray[j];
            calculateInventory(i, 'day', itemName, caches.inventoryElementCache, previousMonthInventory);
            calculateInventory(i, 'night', itemName, caches.inventoryElementCache, previousMonthInventory);
        }
    }

    // 在庫計算後に月末在庫カードをリアルタイムで更新（品番リストを渡して重複計算を削減）
    updateInventoryComparisonCard(allItemNamesArray, dateCount, caches, itemData, previousMonthInventory);

    // 行合計と溶湯計算を非同期で更新（パフォーマンス改善）
    // calculation.jsから関数をインポートする必要があるため、呼び出し元で実行
    return { allItemNamesArray, dateCount };
}

/**
 * 月末在庫カードを更新
 * @param {Array<string>} allItemNamesArray - 全品番名の配列（省略可）
 * @param {number} dateCount - 日付数（省略可）
 * @param {Object} caches - キャッシュオブジェクト
 * @param {Object} itemData - 品番データ
 * @param {Object} previousMonthInventory - 前月在庫データ
 */
export function updateInventoryComparisonCard(allItemNamesArray = null, dateCount = null, caches, itemData, previousMonthInventory) {
    const { inventoryCardCache, inventoryElementCache, domConstantCache } = caches;

    // キャッシュが未作成の場合は作成
    if (!inventoryCardCache) {
        caches.inventoryCardCache = buildInventoryCardCache();
    }
    if (!inventoryElementCache) {
        caches.inventoryElementCache = buildInventoryElementCache();
    }

    // パラメータが渡されていない場合は自分で計算
    if (!dateCount) {
        dateCount = domConstantCache.dateCount;
    }
    if (!allItemNamesArray) {
        const itemDataKeys = Object.keys(itemData);
        const prevKeys = Object.keys(previousMonthInventory);
        allItemNamesArray = [...new Set([...itemDataKeys, ...prevKeys])];
    }

    // 最終日付のインデックス（高速化：ループの外で計算）
    const lastDateIndex = dateCount - 1;

    for (let i = 0; i < allItemNamesArray.length; i++) {
        const itemName = allItemNamesArray[i];
        let endOfMonthInventory = 0;

        // 最後の日付から逆順に検索して、最初に見つかった在庫値を使用
        // 高速化：最も一般的なケース（最終日の夜勤）を最初にチェック
        for (let dateIndex = lastDateIndex; dateIndex >= 0; dateIndex--) {
            const nightInventoryElement = caches.inventoryElementCache.inventory[itemName]?.night?.[dateIndex];

            if (nightInventoryElement && nightInventoryElement.style.display !== 'none') {
                endOfMonthInventory = getElementValue(nightInventoryElement);
                break;
            }

            const dayInventoryElement = caches.inventoryElementCache.inventory[itemName]?.day?.[dateIndex];

            if (dayInventoryElement && dayInventoryElement.style.display !== 'none') {
                endOfMonthInventory = getElementValue(dayInventoryElement);
                break;
            }
        }

        // キャッシュから対応するカード要素を取得
        const cardData = caches.inventoryCardCache[itemName];
        if (!cardData || !cardData.inventorySpan) continue;

        // マイナスの場合は"-"付きで表示
        cardData.inventorySpan.textContent = endOfMonthInventory < 0
            ? '-' + Math.abs(endOfMonthInventory)
            : endOfMonthInventory;

        // 差分を計算
        const difference = endOfMonthInventory - cardData.optimalInventory;

        // カードの背景色を変更（高速化：必要な場合のみDOM操作）
        const currentHasShortage = cardData.card.classList.contains('shortage');
        const currentHasExcess = cardData.card.classList.contains('excess');

        if (difference < 0) {
            if (!currentHasShortage) {
                cardData.card.classList.remove('excess');
                cardData.card.classList.add('shortage');
            }
        } else if (difference > 0) {
            if (!currentHasExcess) {
                cardData.card.classList.remove('shortage');
                cardData.card.classList.add('excess');
            }
        } else {
            if (currentHasShortage || currentHasExcess) {
                cardData.card.classList.remove('shortage', 'excess');
            }
        }

        // 差分を更新
        if (cardData.diffSpan) {
            const sign = difference > 0 ? '+' : (difference < 0 ? '-' : '');
            const absDifference = Math.abs(difference);
            cardData.diffSpan.textContent = '(' + sign + absDifference + ')';
        }
    }
}
