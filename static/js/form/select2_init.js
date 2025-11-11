// すべてのselect2を初期化する関数
function initializeSelect2() {
    try {
        // 既存のselect2を安全に初期化
        $('.select2').each(function() {
            const $element = $(this);

            // 既にselect2が初期化されている場合はスキップ
            if ($element.data('select2')) {
                return;
            }

            const $modal = $element.closest('.modal');
            $element.select2({
                theme: 'bootstrap-5',
                width: '100%',
                placeholder: '選択してください',
                allowClear: true,
                dropdownParent: $modal.length > 0 ? $modal : $('body')
            });
        });
    } catch (error) {
        console.error('Error initializing select2:', error);
    }
}

// モーダル内のselect2を完全にクリーンアップする関数
function cleanupModalSelect2() {
    try {
        // モーダル内の既存のselect2を破棄
        $('.modal .select2').each(function() {
            const $element = $(this);
            if ($element.data('select2')) {
                // イベントも削除
                $element.off('select2:opening select2:open select2:closing select2:close select2:selecting select2:select select2:unselecting select2:unselect');
                $element.select2('destroy');
            }
        });

        // select2のDOM要素も削除（モーダル内）
        $('.modal .select2-container').remove();

        // body直下に残っているselect2のドロップダウンも削除
        $('.select2-container--open').remove();
        $('.select2-dropdown').remove();
        $('.select2-hidden-accessible').each(function() {
            if (!$(this).closest('.modal').length) {
                // モーダル外のselect2-hidden-accessibleは削除しない
            }
        });
    } catch (error) {
        console.error('Error cleaning up modal select2:', error);
    }
}

function initializeRegisterModalSelect2() {
    try {
        const $modal = $('#RegisterModal');

        // body直下の不要なselect2要素を削除
        $('.select2-container--open').remove();
        $('.select2-dropdown').remove();

        // RegisterModal内のselect2を処理
        $modal.find('.select2').each(function() {
            const $element = $(this);

            // 既存のインスタンスがある場合のみ破棄
            if ($element.data('select2')) {
                // イベントリスナーを削除
                $element.off('select2:opening select2:open select2:closing select2:close select2:selecting select2:select select2:unselecting select2:unselect');
                $element.select2('destroy');
                // 既存のDOM要素を削除
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

        // 値をクリア
        $modal.find('.select2').val(null).trigger('change');
    } catch (error) {
        console.error('Error initializing RegisterModal select2:', error);
    }
}
