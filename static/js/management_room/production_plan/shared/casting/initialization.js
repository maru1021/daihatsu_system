// ========================================
// 初期化モジュール
// ========================================
// 鋳造・CVT共通の初期化処理を提供

import { buildInventoryElementCache, buildInventoryCardCache, buildOvertimeInputCache, buildMoltenMetalElementCache } from './cache.js';
import { debounce } from './utils.js';

/**
 * キャッシュ一括構築
 * @param {Object} refs - グローバル変数への参照
 * @param {Function} refs.setInventoryElementCache - inventoryElementCacheを設定する関数
 * @param {Function} refs.setInventoryCardCache - inventoryCardCacheを設定する関数
 * @param {Function} refs.setOvertimeInputCache - overtimeInputCacheを設定する関数
 * @param {Function} refs.setMoltenMetalElementCache - moltenMetalElementCacheを設定する関数
 */
export function buildAllCaches(refs) {
    // 同期キャッシュ（即座に必要）
    const inventoryElementCache = buildInventoryElementCache();
    const inventoryCardCache = buildInventoryCardCache();
    const overtimeInputCache = buildOvertimeInputCache();

    refs.setInventoryElementCache(inventoryElementCache);
    refs.setInventoryCardCache(inventoryCardCache);
    refs.setOvertimeInputCache(overtimeInputCache);

    // 非同期キャッシュ（遅延可能）
    setTimeout(() => {
        const moltenMetalElementCache = buildMoltenMetalElementCache();
        refs.setMoltenMetalElementCache(moltenMetalElementCache);
    }, 100);
}

/**
 * セレクトボックスの色初期化とイベント設定
 * @param {Object} options - オプション
 * @param {Function} options.updateSelectColorWrapper - select色更新のラッパー関数
 * @param {Function} options.applyItemChangeHighlights - ハイライト適用関数
 * @param {Function} options.onSelectChange - select変更時のコールバック
 */
export function initializeSelectColors(options) {
    const {
        updateSelectColorWrapper,
        applyItemChangeHighlights,
        onSelectChange
    } = options;

    // デバウンスされた品番変更チェック関数（200ms遅延）
    const debouncedApplyHighlights = debounce(applyItemChangeHighlights, 200);

    document.querySelectorAll('.vehicle-select').forEach(select => {
        updateSelectColorWrapper(select);

        select.addEventListener('change', function () {
            const dateIndex = parseInt(this.dataset.dateIndex);
            const shift = this.dataset.shift;
            const machineIndex = parseInt(this.dataset.machineIndex);

            updateSelectColorWrapper(this);  // ここで data-vehicle が新しい値に更新される

            // ライン固有の処理を実行
            if (onSelectChange) {
                onSelectChange(this, dateIndex, shift, machineIndex);
            }

            debouncedApplyHighlights();  // ハイライトのみ更新
        });
    });
}

/**
 * 初期計算実行
 * @param {Object} options - オプション
 * @param {Object} options.domConstantCache - DOM定数キャッシュ
 * @param {Function} options.setInitializing - isInitializingフラグを設定する関数
 * @param {Function} options.calculateProduction - 生産台数計算関数
 * @param {Function} options.recalculateAllInventoryWrapper - 在庫再計算のラッパー関数
 * @param {Function} options.beforeCalculation - 計算前の処理（オプション、鋳造の前月金型処理など）
 * @returns {Promise} 初期計算完了のPromise
 */
export function performInitialCalculations(options) {
    const {
        domConstantCache,
        setInitializing,
        calculateProduction,
        recalculateAllInventoryWrapper,
        beforeCalculation
    } = options;

    return new Promise((resolve) => {
        const dateCount = domConstantCache.dateCount;

        // 計算前の処理（鋳造の前月金型処理など）
        if (beforeCalculation) {
            beforeCalculation();
        }

        // 初期化完了フラグを先に設定（在庫計算が動作するように）
        setInitializing(false);

        // 段階的に計算を実行（ページの応答性を向上）
        requestAnimationFrame(() => {
            // ステップ2: 生産台数を計算
            requestAnimationFrame(() => {
                for (let i = 0; i < dateCount; i++) {
                    calculateProduction(i, 'day');
                    calculateProduction(i, 'night');
                }

                // ステップ3: 在庫を再計算（月末在庫カードも自動更新される）
                // 行合計と溶湯計算はrecalculateAllInventory内で非同期実行される
                requestAnimationFrame(() => {
                    recalculateAllInventoryWrapper();
                    resolve();
                });
            });
        });
    });
}
