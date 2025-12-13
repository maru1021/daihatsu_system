import os
from django.views.generic import TemplateView
from django.conf import settings


class HomeView(TemplateView):
    """ホームページビュー - Three.jsで3D背景を表示"""

    template_name = 'home.html'

    # 定数
    IMAGE_EXTENSIONS = ('.jpeg', '.jpg', '.png')
    EXCLUDED_FILES = ('index.png',)  # ロゴ用のファイル
    IMAGE_DIR = os.path.join('image', 'toppage')

    def get_context_data(self, **kwargs):
        """コンテキストデータの取得"""
        context = super().get_context_data(**kwargs)
        context['toppage_images'] = self._get_toppage_images()
        return context

    def _get_toppage_images(self):
        """toppageディレクトリ内の画像ファイルパスを取得"""
        toppage_dir = os.path.join(settings.STATICFILES_DIRS[0], self.IMAGE_DIR)

        if not os.path.exists(toppage_dir):
            return []

        image_files = []
        for filename in os.listdir(toppage_dir):
            if self._is_valid_image(filename):
                image_files.append(f'{self.IMAGE_DIR}/{filename}')

        return image_files

    def _is_valid_image(self, filename):
        """ファイルが有効な画像かどうかを判定"""
        filename_lower = filename.lower()

        # 画像拡張子を持つか
        if not filename_lower.endswith(self.IMAGE_EXTENSIONS):
            return False

        # 除外ファイルでないか
        if filename_lower in self.EXCLUDED_FILES:
            return False

        return True
