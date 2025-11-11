function clearFormErrors(form) {
    // DOM要素の場合はjQueryオブジェクトに変換
    const $form = $(form);

    // form内の全てのinput要素のis-invalidクラスをクリア
    const inputs = $form.find('input, select, textarea');
    inputs.each(function() {
        $(this).removeClass('is-invalid');
    });

    // form内の全てのエラーメッセージをクリア
    const invalidFeedbacks = $form.find('.invalid-feedback');
    invalidFeedbacks.each(function() {
        $(this).remove();
    });
}

// 登録フォームのリセット
function resetRegisterForm(form) {
    // DOM要素の場合はjQueryオブジェクトに変換
    const $form = $(form);
    const inputs = $form.find('input, select, textarea');

    inputs.each(function() {
        if ($(this).prop('type') === 'number') {
            $(this).val('0');
        } else if ($(this).prop('type') === 'text' || $(this).prop('type') === 'textarea') {
            $(this).val('');
        } else if ($(this).prop('tagName') === 'SELECT') {
            // select2の場合は専用のクリア方法を使用
            if ($(this).hasClass('select2')) {
                $(this).val('').trigger('change');
            } else {
                // 通常のセレクトボックスは最初のオプションを選択
                if ($(this).find('option').length > 0) {
                    $(this).prop('selectedIndex', 0);
                }
            }
        }
    });
}

// モーダル関連の処理
const modalHandlers = {
    // フォームのエラー表示をクリア
    clearFormErrors: function(form) {
        if (!form) return;

        // DOM要素の場合はjQueryオブジェクトに変換
        const $form = $(form);

        // エラーメッセージをクリア
        const invalidFeedbacks = $form.find('.invalid-feedback');
        invalidFeedbacks.each(function() {
            $(this).remove();
        });

        // is-invalidクラスをクリア
        const invalidInputs = $form.find('.is-invalid');
        invalidInputs.each(function() {
            $(this).removeClass('is-invalid');
        });

        $form.trigger('reset');
    },

    // 編集フォームのリセット
    resetEditForm: function(form) {
        if (!form) return;

        // DOM要素の場合はjQueryオブジェクトに変換
        const $form = $(form);

        // エラー表示をクリア
        this.clearFormErrors(form);

        // フォーム内のすべての入力要素を取得
        const inputs = $form.find('input, select, textarea');

        // 各入力要素をリセット
        inputs.each(function() {
            if ($(this).prop('type') === 'checkbox' || $(this).prop('type') === 'radio') {
                $(this).prop('checked', false);
            } else {
                $(this).val('');
            }
        });

        // フォームのリセットイベントを発火
        $form.trigger('reset');
    }
};
