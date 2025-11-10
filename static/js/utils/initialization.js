// 初期化状態管理用ユーティリティ
window.initializationFlags = window.initializationFlags || {};

// 初期化フラグをクリアする関数
function clearInitializationFlags() {
    window.initializationFlags = {};
    // delegated eventsのフラグもクリア（ページ遷移時のみ）
    window.tableEventsInitialized = false;
}

// デバウンス関数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// エラーハンドリング関数の共通化
function handleFormError(error, form) {
    if (error.response && error.response.status === 400) {
        // バリデーションエラーの表示
        if (error.data.errors) {
            Object.entries(error.data.errors).forEach(([field, message]) => {
                const input = form.find(`[name="${field}"]`);
                if (input.length) {
                    input.addClass('is-invalid');
                    const feedback = $('<div>').addClass('invalid-feedback d-block').text(message);
                    input.parent().append(feedback);
                }
            });
        }
    } else {
        console.error('Error:', error);
        showToast('error', error.message || 'エラーが発生しました。');
    }
}