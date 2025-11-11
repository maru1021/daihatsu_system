// 名前空間付きでイベントハンドラーの重複を防ぐ
const BASE_JS_NAMESPACE = 'baseJs';
let isInitialLoad = true; // 初回ロードかどうかを判定

// 初期化処理を共通化
function performInitialization() {
    initializeSelect2();
    initializeDatepickers();
    initializeMachineSelect();
    initializeToolNoSelect();
    initializeTableMasterPage();
    initializeImageUpload();
    focusSearchInput();
    showRegisterModal();

    // 改善班予定ページの初期化
    if (typeof initializeImprovementSchedulePage === 'function') {
        initializeImprovementSchedulePage();
    }
}

// DOMContentLoaded時の処理
$(document).ready(function() {
    if (isInitialLoad) {
        clearInitializationFlags();
        performInitialization();
        isInitialLoad = false; // 初回ロード完了をマーク
    }
});

// HTMX遷移後の処理（初回ロード後のみ実行）
$(document).off(`htmx:afterSettle.${BASE_JS_NAMESPACE}`).on(`htmx:afterSettle.${BASE_JS_NAMESPACE}`, function(evt) {
    if (!isInitialLoad) { // 初回ロード後のHTMX遷移時のみ
        clearInitializationFlags();
        setTimeout(() => {
            performInitialization();
        }, 50);
    }
});

// HTMX遷移前の処理
$(document).off(`htmx:beforeSwap.${BASE_JS_NAMESPACE}`).on(`htmx:beforeSwap.${BASE_JS_NAMESPACE}`, function(evt) {
    cleanupModalSelect2();
    // 遷移前にイベントをクリーンアップ
    $(document).off('.tableEvents .tableMaster .tableSearch .pagination .editForm .deleteConfirm');
});

// モーダル表示前の処理
$(document).off(`show.bs.modal.${BASE_JS_NAMESPACE}`).on(`show.bs.modal.${BASE_JS_NAMESPACE}`, function(evt) {
    // body直下の不要なselect2要素を削除（残骸のクリーンアップ）
    $('.select2-container--open').remove();
    $('.select2-dropdown').remove();
});

// モーダル表示後の処理
$(document).off(`shown.bs.modal.${BASE_JS_NAMESPACE}`).on(`shown.bs.modal.${BASE_JS_NAMESPACE}`, function(evt) {
    const modalElement = $(evt.target);
    if (modalElement) {
        const modalId = modalElement.attr('id');

        // モーダル内のselect2を初期化
        if (modalId === 'RegisterModal') {
            initializeRegisterModalSelect2();
        } else if (modalId === 'EditModal') {
            // EditModalのselect2も同様に処理
            const $modal = $('#EditModal');

            $modal.find('.select2').each(function() {
                const $element = $(this);

                // 既存のインスタンスがある場合のみ破棄
                if ($element.data('select2')) {
                    $element.off('select2:opening select2:open select2:closing select2:close select2:selecting select2:select select2:unselecting select2:unselect');
                    $element.select2('destroy');
                    $element.next('.select2-container').remove();
                }

                // 新しいインスタンスを作成
                $element.select2({
                    theme: 'bootstrap-5',
                    width: '100%',
                    placeholder: '選択してください',
                    allowClear: true,
                    dropdownParent: $modal
                });
            });
        }

        focusFirstInput(modalElement);
    }
});

// モーダル非表示前の処理
$(document).off(`hide.bs.modal.${BASE_JS_NAMESPACE}`).on(`hide.bs.modal.${BASE_JS_NAMESPACE}`, function(evt) {
    removeAllFocus();
});

// モーダル非表示後の処理
$(document).off(`hidden.bs.modal.${BASE_JS_NAMESPACE}`).on(`hidden.bs.modal.${BASE_JS_NAMESPACE}`, function(evt) {
    const modalElement = $(evt.target);

    // body直下の不要なselect2要素を削除
    $('.select2-container--open').remove();
    $('.select2-dropdown').remove();

    // モーダル内のselect2をクリーンアップ
    cleanupModalSelect2();

    cleanupModals();
    clearFormErrors(modalElement);
    focusSearchInput();
});
