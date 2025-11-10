function initializeVariableForm(title, select_data) {
    let modalListener, clickListener, removeListener;

    // モーダルが開かれたときにフォームをリセット
    modalListener = function(e) {
        if (e.target.id === 'RegisterModal') {
            // モーダルが完全に表示された後にリセット
            const container = document.getElementById(`${title}-container`)
            container.innerHTML = '';

            // 1つの行を追加
            const newRow = document.createElement('div');
            newRow.className = `${title}-row mb-2`;
            newRow.innerHTML = `
            <div class="input-group">
                <select class="form-control select2" name="${title}[]">
                    <option value="">選択してください</option>
                    ${select_data.map(item => `<option value="${item.id}">${item.name}</option>`).join('')}
                </select>
                <button type="button" class="btn btn-outline-success add-${title}">
                    <i class="fas fa-plus"></i>
                </button>
            </div>`;

            container.appendChild(newRow);
        } else if (e.target.id === 'EditModal') {
            const container = document.getElementById(`id_${title}-container`)
            container.innerHTML = '';

            // 行を追加
            let selected_value = currentEditData[`${title}[]`]
            if(selected_value.length > 0){
                selected_value.forEach((item, index) => {
                    const newRow = document.createElement('div');
                    newRow.className = `${title}-row mb-2`;
                    if(index === 0){
                        newRow.innerHTML = `
                        <div class="input-group">
                            <select class="form-control select2" name="${title}[]" id="${title}0">
                                <option value="">選択してください</option>
                                ${select_data.map(item => `<option value="${item.id}">${item.name}</option>`).join('')}
                            </select>
                            <button type="button" class="btn btn-outline-success add-${title}">
                                <i class="fas fa-plus"></i>
                            </button>
                        </div>`;
                    } else {
                        newRow.innerHTML = `
                            <div class="input-group">
                                <select class="form-control select2" name="${title}[]" id="${title}${index}">
                                    <option value="">選択してください</option>
                                    ${select_data.map(item => `<option value="${item.id}">${item.name}</option>`).join('')}
                                </select>
                                <button type="button" class="btn btn-outline-danger remove-${title}">
                                    <i class="fas fa-minus"></i>
                                </button>
                            </div>
                        `;
                    }
                    container.appendChild(newRow);
                    $(newRow).find('.select2').val(selected_value).trigger('change');
                })
            } else {
                const newRow = document.createElement('div');
                newRow.className = `${title}-row mb-2`;
                newRow.innerHTML = `
                <div class="input-group">
                    <select class="form-control select2" name="${title}[]">
                        <option value="">選択してください</option>
                        ${select_data.map(item => `<option value="${item.id}">${item.name}</option>`).join('')}
                    </select>
                    <button type="button" class="btn btn-outline-success add-${title}">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
                `;
                container.appendChild(newRow);
                $(newRow).find('.select2').val('').trigger('change');
            }
        }
    };

    document.addEventListener('show.bs.modal', modalListener);

    // フォームの追加
    clickListener = function(e) {
        const addSelector = `.add-${title}`;

        if (e.target.closest(addSelector)) {
            const activeModal = document.querySelector('.modal.show');
            let container = null;

            if (activeModal.id === 'RegisterModal') {
                container = document.getElementById(`${title}-container`);
            } else if (activeModal.id === 'EditModal') {
                container = document.getElementById(`id_${title}-container`);
            }

            const newRow = document.createElement('div');
            newRow.className = `${title}-row mb-2`;
            newRow.innerHTML = `
                <div class="input-group">
                    <select class="form-control select2" name="${title}[]">
                        <option value="">選択してください</option>
                        ${select_data.map(item => `<option value="${item.id}">${item.name}</option>`).join('')}
                    </select>
                    <button type="button" class="btn btn-outline-danger remove-${title}">
                        <i class="fas fa-minus"></i>
                    </button>
                </div>
            `;

            container.appendChild(newRow);
            if ($(newRow).find('.select2').data('select2')) {
                $(newRow).find('.select2').select2('destroy');
            }
            const $modal = $(newRow).closest('.modal');
            $(newRow).find('.select2').select2({
                theme: 'bootstrap-5',
                width: '100%',
                placeholder: '選択してください',
                allowClear: true,
                dropdownParent: $modal.length > 0 ? $modal : $('body')
            });
        }
    };

    document.addEventListener('click', clickListener);

    // フォームの削除
    removeListener = function(e) {
        const removeSelector = `.remove-${title}`;
        const rowSelector = `.${title}-row`;
        if (e.target.closest(removeSelector)) {
            e.target.closest(rowSelector).remove();
        }
    };

    document.addEventListener('click', removeListener);

    // HTMXで遷移時にイベントリスナーを削除
    document.addEventListener('htmx:beforeCleanupElement', function(evt) {
        document.removeEventListener('show.bs.modal', modalListener);
        document.removeEventListener('click', clickListener);
        document.removeEventListener('click', removeListener);
    });
}
