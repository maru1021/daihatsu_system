// ページ初期化関数（重複実行を防ぐ）
function initializeTableMasterPage() {
    // 既に初期化済みの場合はスキップ
    const pageId = window.location.pathname + '_tableMaster';
    if (window.initializationFlags[pageId]) {
        return;
    }
    window.initializationFlags[pageId] = true;

    const registerForm = $('#RegisterForm');

    // 新規追加フォームの送信処理
    registerForm.off('submit.tableMaster').on('submit.tableMaster', function (e) {
        e.preventDefault();

        // URLを動的に取得
        const createUrl = registerForm.attr('action');

        submitForm(registerForm, createUrl, (data) => {
            hideModal('RegisterModal');
            showToast('success', data.message);

            if (data.html) {
                $('#TableContainer').html(data.html);
                initializePaginationEvents();
            }
        })
            .catch(error => {
                handleFormError(error, registerForm);
            });
    });

    // 検索フォームのイベント初期化
    initializeSearchEvents();

    // ページネーションのイベント初期化
    initializePaginationEvents();

    // 編集・削除ボタンのクリックイベント
    initializeTableEvents();
    // 集計ページでの日付設定
    search_date();
}

function initializeSearchEvents() {
    const searchInput = $('input[name="search"]');

    // 名前空間付きでイベントを削除・追加
    searchInput.off('input.tableSearch').on('input.tableSearch', debounce(function (event) {
        const searchUrl = searchInput.attr('data-search-url');
        const searchQuery = event.target.value || ''; // event.targetを使用

        if (!searchUrl) {
            return; // data-search-url が無い場合はスキップ
        }

        searchTableData(searchUrl, searchQuery)
            .then(() => {
                initializePaginationEvents();
            })
            .catch(error => {
                console.error('Error:', error);
                showToast('error', error.message || '検索に失敗しました。');
            });
    }, 100));
}


function search_date() {
    const $input = $('input[name="search_date"]');

    $input.on('change', function () {
        const date_val = this.value;
        if (!date_val) return;

        let base = (window.base_url || '') + (window.search_date_url || '');
        base = base.replace(/\/?$/, '/');

        const url = base + encodeURIComponent(date_val) + '/';

        if (window.htmx) {
            htmx.ajax('GET', url, {
                target: '.main-content',
                pushUrl: true,
                swap: 'innerHTML'
            });
        } else {
            // htmx が無い環境では通常の遷移にフォールバック
            window.location.href = url;
        }
    });
}

// ページネーションの処理
function initializePaginationEvents() {
    // 既存のイベントリスナーを削除
    $('.pagination a').off('click.pagination').on('click.pagination', function (e) {
        e.preventDefault();
        const url = this.href;

        // 重複クリック防止
        if ($(this).data('loading')) return;
        $(this).data('loading', true);

        window.history.pushState({}, '', url);

        fetch(url, {
            headers: { 'HX-Request': 'true' }
        })
            .then(response => response.text())
            .then(html => {
                $('#TableContainer').html(html);
                initializePaginationEvents();
            })
            .catch(error => {
                console.error('Error:', error);
                showToast('error', 'ページの読み込みに失敗しました。');
            })
            .finally(() => {
                $(this).removeData('loading');
            });
    });
}

// 編集・削除の初期化（delegated eventsを使用）
function initializeTableEvents() {
    // グローバルに一度だけ設定されたかをチェック
    if (window.tableEventsInitialized) {
        return;
    }
    window.tableEventsInitialized = true;

    // delegated eventsで登録（動的に追加される要素にも対応）
    $(document).on('click.tableEvents', '.edit-item', function (e) {
        handleEditItem(e, $(this));
    });

    $(document).on('click.tableEvents', '.delete-item', function (e) {
        handleDeleteItem(e, $(this));
    });
}

// 編集処理
function handleEditItem(e, editBtn) {
    e.preventDefault();
    e.stopPropagation();

    const editUrl = editBtn.attr('data-edit-url');

    // サーバーからアイテムの情報を取得
    fetch(editUrl)
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                // グローバル変数に編集データを設定
                window.currentEditData = data.data;

                const editModal = $('#EditModal');
                const form = editModal.find('form');
                if (form) {
                    form.action = editUrl;

                    // フォームの初期化が表示されてから実行
                    editModal.off('shown.bs.modal.editForm').on('shown.bs.modal.editForm', function () {
                        initializeEditForm(data);
                    });
                }

                showModal('EditModal');

                // 編集フォームの送信処理
                if (form) {
                    // 新しいイベントリスナーを追加
                    form.off('submit.editForm').on('submit.editForm', function (e) {
                        handleEditFormSubmit(e, form);
                    });
                }
            } else {
                showToast('error', 'アイテムの情報を取得できませんでした。');
            }
        })
        .catch(error => {
            showToast('error', 'アイテムの情報を取得できませんでした。');
        });
}

// 編集フォーム送信処理
function handleEditFormSubmit(e, editForm) {
    e.preventDefault();

    // 既存のエラーメッセージをクリア
    const invalidFeedbacks = editForm.find('.invalid-feedback');
    invalidFeedbacks.remove();
    const invalidInputs = editForm.find('.is-invalid');
    invalidInputs.removeClass('is-invalid');

    submitForm(editForm, editForm.attr('action'), (data) => {
        hideModal('EditModal');
        showToast('success', data.message);

        if (data.html) {
            $('#TableContainer').html(data.html);
            initializePaginationEvents();
        }
    })
        .catch(error => {
            handleFormError(error, editForm);
        });
}

// 削除処理
function handleDeleteItem(e, deleteBtn) {
    e.preventDefault();
    e.stopPropagation();

    // 改善スケジュール内の削除ボタンの場合は処理しない
    if (deleteBtn.closest('.improvement-schedule-container').length > 0) {
        return;
    }

    const itemName = deleteBtn.attr('data-item-name');
    const deleteUrl = deleteBtn.attr('data-delete-url');

    showModal('DeleteModal');

    // モーダルのメッセージを更新
    updateModalMessage(`本当に「${itemName}」を削除してもよろしいですか？`);

    // 削除確認ボタンの処理
    const confirmBtn = $('#DeleteModal').find('#confirmDeleteBtn');
    if (confirmBtn.length) {
        confirmBtn.off('click.deleteConfirm').on('click.deleteConfirm', function () {
            performDelete(deleteUrl, (data) => {
                hideModal('DeleteModal');
                showToast('success', data.message);

                if (data.html) {
                    $('#TableContainer').html(data.html);
                    initializePaginationEvents();
                }
            })
                .catch(error => {
                    console.error('Error:', error);
                    showToast('error', error.message || '削除に失敗しました。');
                });
        });
    }
}

// テーブル削除処理をグローバルに公開
window.handleTableDeleteItem = handleDeleteItem;
