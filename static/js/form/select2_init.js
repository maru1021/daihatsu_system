// すべてのselect2を初期化する関数
function initializeSelect2() {
    try {
        // 既存のselect2を安全に初期化
        $('.select2').each(function() {
            const $element = $(this);
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
                $element.select2('destroy');
            }
        });

        // select2のDOM要素も削除
        $('.modal .select2-container').remove();
    } catch (error) {
        console.error('Error cleaning up modal select2:', error);
    }
}

function initializeRegisterModalSelect2() {

    $('#RegisterModal .select2').each(function() {
        const $element = $(this);
        if ($element.data('select2')) {
            $element.select2('destroy');
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
    $('#RegisterModal .select2').val('').trigger('change');

}
