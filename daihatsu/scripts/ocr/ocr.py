import csv
import pdfplumber

def extract_pdf_tables_to_csv(pdf_path):
    """PDFから表を抽出して直接CSVに保存"""
    table_count = 0

    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages):
                tables = page.extract_tables()

                for table in tables:
                    filtered_table = []
                    for row in table:
                        # すべてがNoneまたは空文字列でない行のみ保持
                        if any(cell and str(cell).strip() for cell in row if cell is not None):
                            filtered_table.append(row)

                    if filtered_table:
                        table_count += 1
                        csv_filename = f"table{table_count}.csv"

                        # CSVに書き込み
                        with open(csv_filename, 'w', newline='', encoding='utf-8-sig') as csvfile:
                            writer = csv.writer(csvfile)
                            writer.writerows(filtered_table)

    except Exception as e:
        print(f"❌ エラー: {e}")
        return 0

if __name__ == "__main__":
    pdf_file = "sample.pdf"
    extract_pdf_tables_to_csv(pdf_file)
