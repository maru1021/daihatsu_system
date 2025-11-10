from io import BytesIO
from django.views import View
from django.http import HttpResponse, JsonResponse
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from daihatsu.except_output import except_output


class PDFGenerator(View):
    """PDF生成基底クラス"""
    title = None
    headers = None
    data = None
    file_name = None
    font_name = 'ArialUnicode'
    font_path = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
    # font_name = 'MeiryoUI'
    # font_paths = ['C:/Windows/Fonts/meiryob.ttc']

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        pdfmetrics.registerFont(TTFont(self.font_name, self.font_path))

    def _format_data(self, data):
        """データのフォーマット"""
        pass

    def _create_table_style(self):
        """テーブルスタイルの作成"""
        return TableStyle([
            # ヘッダー行の背景色
            ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            # 全体の枠線
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            # フォント設定
            ('FONTNAME', (0, 0), (-1, -1), self.font_name),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            # セルの配置
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            # 行の交互背景色
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.lightgrey]),
        ])

    def _has_data(self):
        """データ存在チェック"""
        if hasattr(self.data, 'exists'):
            return self.data.exists()
        return bool(self.data)

    def _create_title_elements(self):
        """タイトル要素作成"""
        styles = getSampleStyleSheet()
        title_style = styles['Title']
        title_style.fontName = self.font_name

        elements = []
        if self.title:
            title = Paragraph(self.title, title_style)
            elements.append(title)
            elements.append(Paragraph("<br/>", styles['Normal']))

        return elements

    def _create_no_data_element(self):
        """データなし要素作成"""
        styles = getSampleStyleSheet()
        normal_style = styles['Normal']
        normal_style.fontName = self.font_name
        no_data = Paragraph("データがありません", normal_style)
        return no_data

    def _create_table_element(self):
        """テーブル要素作成"""
        # ヘッダー行
        table_data = [self.headers] if self.headers else []

        # データ行
        for row in self.data:
            formatted_row = self._format_data(row)
            table_data.append(formatted_row)

        table = Table(table_data)
        table.setStyle(self._create_table_style())
        return table

    def generate_pdf_data(self):
        """PDFデータ生成"""
        buffer = BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4)
        elements = []

        # タイトル追加
        elements.extend(self._create_title_elements())

        # データ処理
        if not self._has_data():
            elements.append(self._create_no_data_element())
        else:
            elements.append(self._create_table_element())

        doc.build(elements)
        return buffer.getvalue()

    def get(self, request, *args, **kwargs):
        """GETリクエスト処理（PDFダウンロード）"""
        try:
            # PDFをメモリ上で生成
            buffer = BytesIO()
            pdf_data = self.generate_pdf_data()
            buffer.write(pdf_data)
            buffer.seek(0)

            # HTTPレスポンス作成
            response = HttpResponse(buffer.getvalue(), content_type='application/pdf')
            response['Content-Disposition'] = f'attachment; filename="{self.file_name}"'

            return response

        except Exception as e:
            except_output('PDF生成エラー', e)
            return JsonResponse({"status": "error", "message": "PDF生成に失敗しました"}, status=500)
