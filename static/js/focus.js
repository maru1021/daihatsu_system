// 現在フォーカスされている要素からフォーカスを外す
function removeAllFocus() {
    const activeElement = document.activeElement;
    if (activeElement) {
        $(activeElement).blur();
    }
}

// 検索フォームのinputにフォーカスを移動する関数
function focusSearchInput() {
    const searchInput = $('input[data-search-url]');
    if (searchInput.length) {
        searchInput.focus();
    }
}

// モーダル内の最初のinputにフォーカスを当てる関数
function focusFirstInput(modalElement) {
    if (!modalElement) return;

    const firstInput = modalElement.find('input:not([type="hidden"]):not([disabled]):first-of-type')[0];
    if (firstInput) {
        firstInput.focus();
        // 末尾にカーソルを移動
        firstInput.setSelectionRange(firstInput.value.length, firstInput.value.length);
    }
}
