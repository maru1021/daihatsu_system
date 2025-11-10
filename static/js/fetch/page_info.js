// 基本的なページ情報を取得する関数
function getBasePageInfo() {
    let currentPage = '1';
    let currentSearch = '';

    // URLパラメータから取得
    const urlParams = new URLSearchParams(window.location.search);
    const urlPage = urlParams.get('page');
    const urlSearch = urlParams.get('search');

    if (urlPage) {
        currentPage = urlPage;
    }

    if (urlSearch !== null) {
        currentSearch = urlSearch;
    }

    // アクティブなページネーション要素から取得（URLが無い場合）
    if (!urlPage) {
        const activePageElement = document.querySelector('.pagination .page-item.active .page-link');
        if (activePageElement) {
            const pageFromDOM = activePageElement.textContent.trim();
            if (pageFromDOM && !isNaN(pageFromDOM)) {
                currentPage = pageFromDOM;
            }
        }
    }

    return {
        page: currentPage,
        search: currentSearch
    };
}

// フォーム送信用のページ情報を取得する関数
function getFormPageInfo() {
    const baseInfo = getBasePageInfo();

    // 検索入力フィールドから取得
    const searchInput = document.querySelector('input[name="search"]');
    if (searchInput && baseInfo.search === '') {
        baseInfo.search = searchInput.value || '';
    }

    return baseInfo;
}

// 削除用のページ情報を取得する関数
function getDeletePageInfo() {
    return getBasePageInfo();
}
