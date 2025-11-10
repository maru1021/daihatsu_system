
let isInitialized = false;

function initializeImageUpload() {
  // 既に初期化済みの場合は何もしない
  if (isInitialized) return;

  document.addEventListener('shown.bs.modal', function(event) {
    const modal = event.target;
    if (!modal.id || (!modal.id.includes('RegisterModal') && !modal.id.includes('EditModal'))) {
      return;
    }

    // classから要素を取得
    const imageUploadArea = modal.querySelector('.image-upload-area');
    const fileInput = modal.querySelector('.image-input');
    const imagePreview = modal.querySelector('.image-preview');
    const previewImage = modal.querySelector('.previewImage');
    const removeImageBtn = modal.querySelector('.removeImage');
    const changeImageBtn = modal.querySelector('.changeImage');

    if (!imageUploadArea || !fileInput) return;

    // 既存のイベントリスナーを削除（重複防止）
    const newImageUploadArea = imageUploadArea.cloneNode(true);
    imageUploadArea.parentNode.replaceChild(newImageUploadArea, imageUploadArea);

    const newFileInput = fileInput.cloneNode(true);
    fileInput.parentNode.replaceChild(newFileInput, fileInput);

    const newPreviewImage = previewImage.cloneNode(true);
    previewImage.parentNode.replaceChild(newPreviewImage, previewImage);

    const newRemoveImageBtn = removeImageBtn.cloneNode(true);
    removeImageBtn.parentNode.replaceChild(newRemoveImageBtn, removeImageBtn);

    const newChangeImageBtn = changeImageBtn.cloneNode(true);
    changeImageBtn.parentNode.replaceChild(newChangeImageBtn, changeImageBtn);

    // 新しい要素を取得
    const updatedImageUploadArea = modal.querySelector('.image-upload-area');
    const updatedFileInput = modal.querySelector('.image-input');
    const updatedPreviewImage = modal.querySelector('.previewImage');
    const updatedRemoveImageBtn = modal.querySelector('.removeImage');
    const updatedChangeImageBtn = modal.querySelector('.changeImage');

    // クリックでファイル選択
    updatedImageUploadArea.addEventListener('click', function(e) {
      if (e.target !== updatedFileInput) {
        updatedFileInput.click();
      }
    });

    // ファイル選択時の処理
    updatedFileInput.addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (file && file.type.startsWith('image/')) {
        displayImagePreview(file);
      }
    });

    // ドラッグ&ドロップ機能
    updatedImageUploadArea.addEventListener('dragover', function(e) {
      e.preventDefault();
      updatedImageUploadArea.classList.add('dragover');
    });

    updatedImageUploadArea.addEventListener('dragleave', function(e) {
      e.preventDefault();
      updatedImageUploadArea.classList.remove('dragover');
    });

    updatedImageUploadArea.addEventListener('drop', function(e) {
      e.preventDefault();
      updatedImageUploadArea.classList.remove('dragover');

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.type.startsWith('image/')) {
          updatedFileInput.files = files;
          displayImagePreview(file);
        } else {
          showToast('error', '画像ファイルを選択してください');
        }
      }
    });

    // 画像プレビュー表示
    function displayImagePreview(file) {
      const reader = new FileReader();
      reader.onload = function(e) {
        updatedPreviewImage.src = e.target.result;
        imagePreview.style.display = 'block';
        updatedImageUploadArea.style.display = 'none';
      };
      reader.readAsDataURL(file);
    }

    // 画像変更
    updatedChangeImageBtn.addEventListener('click', function() {
      updatedFileInput.click();
    });

    // 画像クリックで拡大表示
    updatedPreviewImage.addEventListener('click', function() {
      if (updatedPreviewImage.src) {
        const imageModal = document.getElementById('imageModal');
        const modalImage = document.getElementById('modalImage');
        if (imageModal && modalImage) {
          modalImage.src = updatedPreviewImage.src;
          const modal = new bootstrap.Modal(imageModal);
          modal.show();
        }
      }
    });

    // 画像削除
    updatedRemoveImageBtn.addEventListener('click', function() {
      updatedFileInput.value = '';
      imagePreview.style.display = 'none';
      updatedImageUploadArea.style.display = 'block';
      updatedPreviewImage.src = '';
    });
  });

  // 初期化済みフラグを設定
  isInitialized = true;
}
