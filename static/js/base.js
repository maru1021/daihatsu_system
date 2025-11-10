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
$(document).off(`show.bs.modal.${BASE_JS_NAMESPACE}`, 'RegisterModal').on(`show.bs.modal.${BASE_JS_NAMESPACE}`, 'RegisterModal', function(evt) {
    $('#RegisterModal .select2').val('').trigger('change');
});

// モーダル表示後の処理
$(document).off(`shown.bs.modal.${BASE_JS_NAMESPACE}`).on(`shown.bs.modal.${BASE_JS_NAMESPACE}`, function(evt) {
    const modalElement = $(evt.target);
    if (modalElement) {
        focusFirstInput(modalElement);
        if (modalElement.attr('id') === 'RegisterModal') {
            initializeRegisterModalSelect2();
        } else if (modalElement.attr('id') === 'EditModal') {
            initializeSelect2();
        }
    }
});

// モーダル非表示前の処理
$(document).off(`hide.bs.modal.${BASE_JS_NAMESPACE}`).on(`hide.bs.modal.${BASE_JS_NAMESPACE}`, function(evt) {
    removeAllFocus();
});

// モーダル非表示後の処理
$(document).off(`hidden.bs.modal.${BASE_JS_NAMESPACE}`).on(`hidden.bs.modal.${BASE_JS_NAMESPACE}`, function(evt) {
    focusSearchInput();
    cleanupModalSelect2();
    cleanupModals();
    const modalElement = $(evt.target);
    clearFormErrors(modalElement);
});
