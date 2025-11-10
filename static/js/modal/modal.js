// モーダルを表示する
function showModal(modalId) {
    const modal = new bootstrap.Modal($(`#${modalId}`));
    modal.show();
}

// モーダルを非表示にする
function hideModal(modalId) {
    const modal = bootstrap.Modal.getInstance($(`#${modalId}`));
    modal.hide();
}

// モーダルのクリーンアップを行う
function cleanupModals() {
    // 残ったモーダルオーバーレイをクリーンアップ
    $('.modal-backdrop').remove();

    // bodyのスタイルをリセット
    $('body').removeClass('modal-open');
    $('body').css('overflow', '');
    $('body').css('padding-right', '');
}

// 削除モーダルのメッセージを更新する
function updateModalMessage(message) {
    $('.delete-modal-message').text(message);
}

function showRegisterModal() {
    const registerButton = $('#register-button');
    registerButton.off('click').on('click', function(evt) {
        resetRegisterForm($('#RegisterForm'));
        showModal('RegisterModal');
    });
}
