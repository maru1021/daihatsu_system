function relationSelectChange(url, id, childSelect, childId) {
    return fetch(`${base_url}${url}/${id}/`)
        .then(response => response.json())
        .then(data => {
            let html = '';
            for(const item of data.data) {
                html += `<option value="${item.id}">${item.name}</option>`;
            }

            // Select2の状態を確認
            const isSelect2 = childSelect.hasClass('select2-hidden-accessible');
            if (isSelect2) {
                // Select2の場合：オプションを更新してtrigger('change')
                childSelect.empty().append(html);
                childSelect.trigger('change');
            } else {
                // 通常のselectの場合：htmlで更新
                childSelect.html(html);
            }
        })
        .then(() => {
            $(`#id_${childId}`).val(currentEditData[childId]);
            $(`#id_${childId}`).trigger('change');
        })
        .catch(error => {
            console.error('Error in relationSelectChange:', error);
        });
}


// 選択肢をクリアする
function clearChildSelect(childSelect) {
    const isSelect2 = childSelect.hasClass('select2-hidden-accessible');

    if (isSelect2) {
        // Select2の場合：空のオプションを設定してtrigger
        childSelect.empty().append('<option value="">選択してください</option>');
        childSelect.val('').trigger('change');
    } else {
        // 通常のselectの場合
        childSelect.html('<option value="">選択してください</option>');
    }
}

function initializeRelationSelect(url, parentSelect, childSelect, parentId, childId) {
    if(!parentSelect || !childSelect) {
        return;
    }

    // ページ全体の要素に対するイベントリスナー
    parentSelect.off('change.page').on('change.page', function(evt) {
        const selectedValue = $(this).val();

        if(selectedValue) {
            relationSelectChange(url, selectedValue, childSelect, childId);
        } else {
            clearChildSelect(childSelect);
        }
    });


    // 登録モーダル用の処理
    function handleRegisterModal() {
        const registerParentSelect = $('#RegisterModal').find(`#${parentId}`);
        const registerChildSelect = $('#RegisterModal').find(`#${childId}`);

        if (registerParentSelect.length && registerChildSelect.length) {
            // Select2初期化
            [registerParentSelect, registerChildSelect].forEach(select => {
                if (!select.hasClass('select2-hidden-accessible')) {
                    select.select2({
                        width: '100%',
                        placeholder: '選択してください',
                        allowClear: true,
                        dropdownParent: select.parent()
                    });
                }
            });
        }
    }

    // 編集モーダル用の処理
    function handleEditModal() {
        const editParentSelect = $('#EditModal').find(`#id_${parentId}`);
        const editChildSelect = $('#EditModal').find(`#id_${childId}`);

        if (editParentSelect.length && editChildSelect.length) {
            // Select2初期化
            [editParentSelect, editChildSelect].forEach(select => {
                if (!select.hasClass('select2-hidden-accessible')) {
                    select.select2({
                        width: '100%',
                        placeholder: '選択してください',
                        allowClear: true,
                        dropdownParent: select.parent()
                    });
                }
            });
        }
    }

    $(document).on('shown.bs.modal', '#RegisterModal', handleRegisterModal);
    $(document).on('shown.bs.modal', '#EditModal', handleEditModal);
}
