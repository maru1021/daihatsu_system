/*
 * Loading UI - 汎用ローディング表示コンポーネント
 *
 * グローバル関数:
 * - showLoading(message) - フルスクリーンローディング表示を開始
 * - hideLoading() - フルスクリーンローディング表示を終了
 * - showInlineLoading(element, message) - インラインローディングを表示
 * - hideInlineLoading(element) - インラインローディングを非表示
 * - showTableLoading(tableContainer, message) - テーブルをローディングプレースホルダーに置き換え
 * - hideTableLoading(tableContainer, callback) - ローディングを非表示にし元のテーブルを表示
 */

(function() {
    'use strict';

    // ローディングオーバーレイのHTML（波打つドットアニメーション付き）
    const loadingHTML = `
        <div id="loadingOverlay" class="loading-overlay">
            <div class="loading-container">
                <div class="loading-spinner"></div>
                <div class="loading-text">
                    <span id="loadingText">読み込み中</span>
                    <div class="loading-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </div>
            </div>
        </div>
    `;

    // DOMContentLoadedでローディングUIを初期化
    document.addEventListener('DOMContentLoaded', function() {
        // ローディングオーバーレイをbodyに追加
        if (!document.getElementById('loadingOverlay')) {
            document.body.insertAdjacentHTML('beforeend', loadingHTML);
        }
    });

    /**
     * ローディング表示を開始
     * @param {string} message - 表示するメッセージ（デフォルト: "読み込み中..."）
     */
    window.showLoading = function(message = '読み込み中...') {
        const overlay = document.getElementById('loadingOverlay');
        const text = document.getElementById('loadingText');

        if (overlay) {
            if (text) {
                text.textContent = message;
            }
            // 少し遅延させてからvisibleクラスを追加（CSSトランジションのため）
            setTimeout(() => {
                overlay.classList.add('visible');
            }, 10);
        }
    };

    /**
     * ローディング表示を終了
     */
    window.hideLoading = function() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.remove('visible');
        }
    };

    /**
     * インラインローディングを表示（テーブルセル内などで使用）
     * @param {HTMLElement} element - ローディングを表示する要素
     * @param {string} message - 表示するメッセージ（デフォルト: "処理中..."）
     */
    window.showInlineLoading = function(element, message = '処理中...') {
        if (!element) return;

        // 既存のコンテンツを保存
        if (!element.hasAttribute('data-original-content')) {
            element.setAttribute('data-original-content', element.innerHTML);
        }

        // インラインローディングを表示
        element.innerHTML = `
            <span class="inline-loading">
                <span class="inline-loading-spinner"></span>
                <span>${message}</span>
            </span>
        `;
    };

    /**
     * インラインローディングを非表示にし、元のコンテンツを復元
     * @param {HTMLElement} element - ローディングを非表示にする要素
     */
    window.hideInlineLoading = function(element) {
        if (!element) return;

        const originalContent = element.getAttribute('data-original-content');
        if (originalContent !== null) {
            element.innerHTML = originalContent;
            element.removeAttribute('data-original-content');
        }
    };

    /**
     * テーブルをローディングプレースホルダーに置き換える
     * @param {HTMLElement} tableContainer - テーブルコンテナ要素
     * @param {string} message - 表示するメッセージ（デフォルト: "データを読み込んでいます"）
     */
    window.showTableLoading = function(tableContainer, message = 'データを読み込んでいます') {
        if (!tableContainer) return;

        // 元のコンテンツを保存
        if (!tableContainer.hasAttribute('data-original-table')) {
            tableContainer.setAttribute('data-original-table', tableContainer.innerHTML);
        }

        // ローディングプレースホルダーを表示
        tableContainer.innerHTML = `
            <div class="table-loading-placeholder">
                <div class="loading-spinner"></div>
                <div class="loading-text">
                    <span>${message}</span>
                    <div class="loading-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </div>
            </div>
        `;
        tableContainer.style.opacity = '1';
    };

    /**
     * テーブルローディングを非表示にし、元のテーブルを表示
     * @param {HTMLElement} tableContainer - テーブルコンテナ要素
     * @param {Function} callback - テーブル表示後に実行するコールバック
     */
    window.hideTableLoading = function(tableContainer, callback) {
        if (!tableContainer) return;

        const originalTable = tableContainer.getAttribute('data-original-table');
        if (originalTable !== null) {
            // フェードアウト
            tableContainer.style.opacity = '0';

            setTimeout(() => {
                // 元のテーブルを復元
                tableContainer.innerHTML = originalTable;
                tableContainer.removeAttribute('data-original-table');

                // フェードイン
                setTimeout(() => {
                    tableContainer.style.opacity = '1';
                    if (callback && typeof callback === 'function') {
                        callback();
                    }
                }, 50);
            }, 300);
        }
    };

})();
