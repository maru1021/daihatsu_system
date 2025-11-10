// 検索を実行する
function searchTableData(searchUrl, searchQuery, is_table=true) {
    // searchQueryがundefinedの場合は空文字に変換
    const cleanSearchQuery = searchQuery || '';

    const url = new URL(searchUrl, window.location.origin);
    url.searchParams.set('search', cleanSearchQuery);
    url.searchParams.set('page', '1'); // 検索時は1ページ目に移動

    // URLを更新してからHTMXリクエストを送信
    window.history.pushState({}, '', url.pathname + url.search);

    return fetch(url, {
        headers: { 'HX-Request': 'true' }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('検索に失敗しました。');
        }
        return response.text();
    })
    .then(data => {
        if (is_table) {
            const tableContainer = document.getElementById('TableContainer');
            if (tableContainer) {
                tableContainer.innerHTML = data;
            }
        }
        return data;
    });
}
