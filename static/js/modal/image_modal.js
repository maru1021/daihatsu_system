/**
 * 画像をモーダルで表示する関数
 */
function showImageModal(imageUrl) {
    const imageModal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');

    if (imageModal && modalImage) {
        modalImage.src = imageUrl;
        const modal = new bootstrap.Modal(imageModal);
        modal.show();
    }
}

/**
 * 画像モーダルを初期化
 */
document.addEventListener('DOMContentLoaded', function() {
    // モーダルが閉じられた時に画像をクリア
    const imageModal = document.getElementById('imageModal');
    if (imageModal) {
        imageModal.addEventListener('hidden.bs.modal', function() {
            const modalImage = document.getElementById('modalImage');
            if (modalImage) {
                modalImage.src = '';
            }
        });
    }
});
