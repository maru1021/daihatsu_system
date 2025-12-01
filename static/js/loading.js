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

    // 定数：Loading...の波打つHTMLテキスト（キャッシュして再利用）
    const LOADING_TEXT_HTML = (function() {
        const text = 'Loading...';
        return text.split('').map((char, index) =>
            `<span style="animation-delay: ${index * 0.1}s">${char === ' ' ? '&nbsp;' : char}</span>`
        ).join('');
    })();

    // ローディングオーバーレイのHTML（初期状態でvisibleクラス付き）
    const loadingHTML = `
        <div id="loadingOverlay" class="loading-overlay visible">
            <div class="loading-container">
                <div class="loading-spinner"></div>
                <div class="loading-text" id="loadingText">
                    ${LOADING_TEXT_HTML}
                </div>
            </div>
        </div>
    `;

    // 共通：loadingTextにHTMLを挿入するヘルパー関数
    function setLoadingText(element) {
        if (element) {
            element.innerHTML = LOADING_TEXT_HTML;
        }
    }

    // スクリプト読み込み時に即座にローディングを初期化
    (function initializeLoading() {
        // 既存のローディングテキスト要素を検索してテキストを挿入
        const loadingText = document.getElementById('loadingText');
        if (loadingText) {
            setLoadingText(loadingText);
        }
    })();

    // DOMContentLoadedで再度チェック（HTMLに書かれていない場合の保険）
    document.addEventListener('DOMContentLoaded', function() {
        // オーバーレイが存在しない場合のみ作成
        if (!document.getElementById('loadingOverlay')) {
            document.body.insertAdjacentHTML('afterbegin', loadingHTML);
        } else {
            // 存在するがテキストが空の場合は挿入
            const loadingText = document.getElementById('loadingText');
            if (loadingText && !loadingText.innerHTML.trim()) {
                setLoadingText(loadingText);
            }
        }
    });

    /**
     * ローディング表示を開始
     * @param {string} message - 廃止：常に"Loading..."を表示
     */
    window.showLoading = function(message) {
        let overlay = document.getElementById('loadingOverlay');

        // オーバーレイが存在しない場合は作成（通常は既に存在する）
        if (!overlay) {
            document.body.insertAdjacentHTML('afterbegin', loadingHTML);
            overlay = document.getElementById('loadingOverlay');
        } else {
            // 既に存在する場合は単にvisibleクラスを追加
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
     * @param {string} message - 廃止：常に"Loading..."を表示
     */
    window.showTableLoading = function(tableContainer, message) {
        if (!tableContainer) return;

        // 元のコンテンツを保存
        if (!tableContainer.hasAttribute('data-original-table')) {
            tableContainer.setAttribute('data-original-table', tableContainer.innerHTML);
        }

        // ローディングプレースホルダーを表示（常に"Loading..."）
        tableContainer.innerHTML = `
            <div class="table-loading-placeholder">
                <div class="loading-spinner"></div>
                <div class="loading-text">
                    ${LOADING_TEXT_HTML}
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
