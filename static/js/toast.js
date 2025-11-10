function showToast(type, message, duration = 3000) {
    const toastElement = document.getElementById(type === 'success' ? 'successToast' : 'errorToast');
    if (!toastElement) return;

    const toast = new bootstrap.Toast(toastElement, {
        autohide: true,
        delay: duration
    });

    const messageElement = document.getElementById(type === 'success' ? 'toastMessage' : 'errorMessage');
    if (messageElement) {
        messageElement.innerHTML = message;
    }

    toastElement.classList.add('toast-slide-in');

    toast.show();

    // トーストが非表示になった後の処理
    toastElement.addEventListener('hidden.bs.toast', function() {
        toastElement.classList.remove('toast-slide-in');
    });
}

// クリックでトーストを閉じる
document.addEventListener('click', function(event) {
    const toasts = document.querySelectorAll('.toast');
    toasts.forEach(toast => {
        if (!toast.contains(event.target)) {
            const bsToast = bootstrap.Toast.getInstance(toast);
            if (bsToast) {
                bsToast.hide();
            }
        }
    });
});

window.showToast = showToast;
