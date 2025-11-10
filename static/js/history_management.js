// 履歴管理の名前空間
const HISTORY_MANAGEMENT_NAMESPACE = 'historyManagement';
let isHistoryRestoringState = false;
let isLoggedOut = false;

// ログアウト状態をローカルストレージから復元
function initializeLogoutState() {
    const logoutState = localStorage.getItem('isLoggedOut');
    if (logoutState === 'true') {
        isLoggedOut = true;
    }
}

// ログアウト状態をローカルストレージに保存
function saveLogoutState() {
    localStorage.setItem('isLoggedOut', 'true');
}

// ログアウト状態をクリア（ログイン成功時に呼び出し）
function clearLogoutState() {
    localStorage.removeItem('isLoggedOut');
    isLoggedOut = false;
}

// 履歴管理の初期化処理を共通化
function performHistoryInitialization() {
    // 既存のイベントリスナーをクリーンアップ
    if (typeof cleanupModalSelect2 === 'function') {
        cleanupModalSelect2();
    }

    // イベントの重複登録を防ぐためクリーンアップ
    $(document).off('.tableEvents .tableMaster .tableSearch .pagination .editForm .deleteConfirm .modalEvents');

    // 初期化フラグをクリア
    if (typeof clearInitializationFlags === 'function') {
        clearInitializationFlags();
    }

    // メイン初期化処理を実行
    if (typeof performInitialization === 'function') {
        performInitialization();
    }
}

// ログアウト時の履歴制御
function setupLogoutHistory() {
    try {
        isLoggedOut = true;
        saveLogoutState();
        sessionStorage.clear();

        // 戻るボタンをブロックするためのログアウト履歴エントリを作成
        history.replaceState({logout: true}, '', window.location.href);
        for (let i = 0; i < 5; i++) {
            history.pushState({logout: true}, '', window.location.href);
        }
    } catch (error) {
        console.warn('ログアウト履歴設定に失敗:', error);
    }
}

// ページの完全な状態を履歴に保存
function saveCompleteState() {
    if (!isHistoryRestoringState && !isLoggedOut) {
        const state = {
            content: document.getElementById('main-content')?.innerHTML || '',
            sidebarState: document.querySelector('.sidebar')?.classList.contains('active') || false,
            url: window.location.pathname,
            timestamp: Date.now()
        };

        try {
            history.replaceState(state, '', window.location.href);
        } catch (error) {
            console.warn('履歴状態の保存に失敗:', error);
        }
    }
}

// 状態を復元
function restoreCompleteState(state) {
    if (!state || !state.content) {
        console.warn('復元する状態が無効です');
        return;
    }

    isHistoryRestoringState = true;

    try {
        // コンテンツを復元
        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.innerHTML = state.content;
        }

        // サイドバー状態を復元
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            if (state.sidebarState) {
                sidebar.classList.add('active');
            } else {
                sidebar.classList.remove('active');
            }
        }

        // 初期化処理を遅延実行
        setTimeout(() => {
            performHistoryInitialization();
            isHistoryRestoringState = false;
        }, 100);

    } catch (error) {
        console.error('状態復元エラー:', error);
        isHistoryRestoringState = false;
        // エラー時はページをリロード
        window.location.reload();
    }
}

// HTMX完了後の状態保存
function handleHtmxAfterSettle() {
    if (!isHistoryRestoringState) {
        setTimeout(() => {
            saveCompleteState();
        }, 50);
    }
}

// ブラウザの戻る/進むボタン対応
function handlePopState(event) {
    initializeLogoutState();

    // ログアウト状態の場合はログインページにリダイレクト
    if ((event.state && event.state.logout) || isLoggedOut) {
        window.location.replace('/auth/login');
        return false;
    }

    // 通常の履歴復元処理
    if (event.state && event.state.content) {
        restoreCompleteState(event.state);
    } else {
        window.location.reload();
    }
}

// ログアウト監視タイマー
function startLogoutMonitoring() {
    setInterval(() => {
        if (isLoggedOut && window.location.pathname !== '/auth/login') {
            window.location.replace('/auth/login');
        }
    }, 200);
}

// ログアウトボタンのイベントハンドラー
function handleLogoutClick() {
    setupLogoutHistory();
    startLogoutMonitoring();

    // ページ内容をクリア（セキュリティ向上）
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
        mainContent.innerHTML = '<div class="text-center mt-5"><h3>ログアウト中...</h3></div>';
    }

    return true; // フォーム送信を継続
}

// 履歴管理の初期化
function initializeHistoryManagement() {
    // イベントリスナーの登録
    $(document).off(`htmx:afterSettle.${HISTORY_MANAGEMENT_NAMESPACE}`)
               .on(`htmx:afterSettle.${HISTORY_MANAGEMENT_NAMESPACE}`, handleHtmxAfterSettle);

    $(document).off(`click.${HISTORY_MANAGEMENT_NAMESPACE}`, '.logout-button')
               .on(`click.${HISTORY_MANAGEMENT_NAMESPACE}`, '.logout-button', handleLogoutClick);

    window.removeEventListener('popstate', handlePopState);
    window.addEventListener('popstate', handlePopState);

    // 初回状態保存
    setTimeout(saveCompleteState, 100);
}

// DOMContentLoaded時の処理
$(document).ready(function() {
    // ログインページではログアウト状態をクリアして終了
    if (window.location.pathname === '/auth/login') {
        clearLogoutState();
        return;
    }

    // ログアウト状態をチェック
    initializeLogoutState();

    // サイドバーが存在する場合（ログイン済み）はログアウト状態をクリア
    if (document.querySelector('.sidebar')) {
        clearLogoutState();
    }

    // ログアウト状態の場合はログインページにリダイレクト
    if (isLoggedOut) {
        window.location.href = '/auth/login';
        return;
    }

    // 履歴管理を開始
    initializeHistoryManagement();
});

// ページ離脱前のクリーンアップ
$(window).on('beforeunload', function() {
    $(document).off(`.${HISTORY_MANAGEMENT_NAMESPACE}`);
    window.removeEventListener('popstate', handlePopState, true);
});
