// ========================================
// イベントリスナー設定モジュール（鋳造・CVT共通）
// ========================================
// 生産計画画面のイベントリスナーを共通化
//
// 使用例:
// import { setupEventListeners } from './shared/casting/events.js';
// setupEventListeners({
//     calculateProduction: (dateIndex, shift) => {...},
//     recalculateAllInventory: () => {...},
//     rebuildInventoryCache: () => {...},
//     addMoldCountListeners: false
// });

import { debounce } from './utils.js';

/**
 * イベントリスナーを設定
 * @param {Object} options - オプション設定
 * @param {Function} options.calculateProduction - 生産台数を計算する関数
 * @param {Function} options.recalculateAllInventory - 在庫を再計算する関数
 * @param {Function} options.rebuildInventoryCache - 在庫キャッシュを再構築する関数（オプション）
 * @param {boolean} options.addMoldCountListeners - 金型カウントリスナーを追加するか（デフォルト: false）
 * @param {Function} options.onMoldCountDoubleClick - 金型カウントダブルクリック時のコールバック（Casting用）
 * @param {Function} options.onMoldCountRightClick - 金型カウント右クリック時のコールバック（Casting用）
 */
export function setupEventListeners(options = {}) {
    const {
        calculateProduction = () => {},
        recalculateAllInventory = () => {},
        rebuildInventoryCache = null,
        addMoldCountListeners = false,
        onMoldCountDoubleClick = null,
        onMoldCountRightClick = null
    } = options;

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

    // 生産数・出庫数・在庫数は表示専用（span）に変更されたため、以下のイベントリスナーは不要
    // これらのクラスは存在しないため、querySelectorAllは空配列を返す
    // （後方互換性のためコードは残す）
    document.querySelectorAll('.production-input').forEach(input => {
        input.addEventListener('input', function () {
            debouncedRecalculateInventory();
        });
    });

    document.querySelectorAll('.delivery-input').forEach(input => {
        input.addEventListener('input', function () {
            debouncedRecalculateInventory();
        });
    });

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
            if (rebuildInventoryCache) {
                rebuildInventoryCache();
            }
            // 全品番・全直の在庫を再計算
            debouncedRecalculateInventory();
        });
    });

    // 金型カウントリスナー（Casting専用）
    if (addMoldCountListeners) {
        document.querySelectorAll('.mold-count-display').forEach(display => {
            // ダブルクリックで手動ブロック（赤）
            if (onMoldCountDoubleClick) {
                display.addEventListener('dblclick', function () {
                    onMoldCountDoubleClick(this);
                });
            }

            // 右クリックで編集モーダル
            if (onMoldCountRightClick) {
                display.addEventListener('contextmenu', function (event) {
                    event.preventDefault();
                    onMoldCountRightClick(this);
                });
            }
        });
    }
}
