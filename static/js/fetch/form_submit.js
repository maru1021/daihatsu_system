// 複数要素のフォームデータを準備する
function prepareFormData(form) {
    // DOM要素の場合はjQueryオブジェクトに変換
    const $form = $(form);

    // jQueryオブジェクトの場合はDOM要素に変換
    const formData = new FormData($form[0]);

    // 複数要素の処理（name属性が[]で終わる要素）
    const multipleElements = $form.find('select[name$="[]"], input[name$="[]"]');
    multipleElements.each(function() {
        const name = $(this).attr('name');
        const values = [];

        // 同じname属性を持つ要素をすべて取得
        const sameNameElements = $form.find(`[name="${name}"]`);
        sameNameElements.each(function() {
            if ($(this).val() && $(this).val().trim() !== '') {
                values.push($(this).val());
            }
        });

        // 既存の値を削除して新しい値を追加
        formData.delete(name);
        values.forEach(function(value) {
            formData.append(name, value);
        });
    });

    // 画像フィールドの明示的な処理
    const imageInput = $form.find('input[type="file"]')[0];
    if (imageInput && imageInput.files && imageInput.files.length > 0) {
        formData.delete(imageInput.name);
        formData.append(imageInput.name, imageInput.files[0]);
    }
    return formData;
}

// フォームを送信する
function submitForm(form, url, successCallback, tableInfo=true) {
    const pageInfo = getFormPageInfo();
    const formData = prepareFormData(form);

    // 現在のページ情報を追加
    if (tableInfo) {
        formData.append('current_page', pageInfo.page);
        formData.append('search_query', pageInfo.search);
    }

    return fetch(url, {
        method: 'POST',
        body: formData,
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]').value
        }
    })
    .then(async response => {
        const data = await response.json();
        if (!response.ok) {
            throw { response, data };
        }
        return data;
    })
    .then(data => {
        if (data.status === 'success') {
            if (successCallback) {
                successCallback(data, pageInfo);
            }
            return data;
        } else {
            throw new Error(data.message || 'エラーが発生しました。');
        }
    });
}
