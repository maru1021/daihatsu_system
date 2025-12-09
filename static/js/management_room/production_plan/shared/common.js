// ========================================
// 生産計画共通JavaScript
// ========================================
// 鋳造・加工・組付・CVT生産計画で共有される関数群

const OVERTIME_MAX_DAY = 120;     // 日勤の残業上限（分）
const OVERTIME_MAX_NIGHT = 60;    // 夜勤の残業上限（分）

// ========================================
// カラムホバー処理
// ========================================

/**
 * 列のホバー処理を設定
 */
function setupColumnHover() {
    const tbody = document.querySelector('tbody');
    if (!tbody) return;

    let currentHoverDateIndex = -1;

    tbody.addEventListener('mouseover', function (e) {
        const cell = e.target.closest('td, th');
        if (!cell) return;

        // tdセルのみを対象とする（thは固定列なので除外）
        if (cell.tagName !== 'TD') return;

        // data-date-indexを使って日付インデックスを取得
        const dateIndex = cell.getAttribute('data-date-index');
        if (dateIndex === null) return;

        const dateIndexNum = parseInt(dateIndex);

        // 同じ日付を再度ホバーした場合は何もしない
        if (dateIndexNum === currentHoverDateIndex) return;

        // 前の日付のハイライトを削除
        if (currentHoverDateIndex >= 0) {
            removeDateHighlight(currentHoverDateIndex);
        }

        // 新しい日付セルをハイライト
        currentHoverDateIndex = dateIndexNum;
        addDateHighlight(dateIndexNum);
    });

    tbody.addEventListener('mouseout', function (e) {
        // マウスがtbody全体から出た場合のみハイライトを削除
        if (!e.relatedTarget || !tbody.contains(e.relatedTarget)) {
            if (currentHoverDateIndex >= 0) {
                removeDateHighlight(currentHoverDateIndex);
                currentHoverDateIndex = -1;
            }
        }
    });
}

/**
 * 指定した日付列にハイライトを追加
 * @param {number} dateIndex - 日付インデックス
 */
function addDateHighlight(dateIndex) {
    // dateIndexは data-date-index の値（0始まりの日付インデックス）

    // 最上部のヘッダー日付（thead内の2行目）
    // thead 2行目: インデックス0から日付列が始まる（rowspanで固定列は1行目に結合済み）
    const headerDateRow = document.querySelector('thead tr:nth-child(2)');
    if (headerDateRow && headerDateRow.children[dateIndex]) {
        headerDateRow.children[dateIndex].classList.add('date-hover');
    }

    // セクション日付ヘッダー（.section-date-header）
    // セクションヘッダー: インデックス0はcolspan=3、インデックス1以降が日付列
    const sectionDateHeaders = document.querySelectorAll('.section-date-header');
    sectionDateHeaders.forEach(row => {
        // セクションヘッダーの日付列は インデックス1から始まる（0はcolspan=3）
        const sectionDateIndex = dateIndex + 1;
        if (row.children[sectionDateIndex]) {
            row.children[sectionDateIndex].classList.add('date-hover');
        }
    });

    // data-date-index属性を持つヘッダーセル（加工・組付用）
    const dateHeaderCell = document.querySelector(`thead th[data-date-index="${dateIndex}"]`);
    if (dateHeaderCell) {
        dateHeaderCell.classList.add('date-hover');
    }
}

/**
 * 指定した日付列のハイライトを削除
 * @param {number} dateIndex - 日付インデックス
 */
function removeDateHighlight(dateIndex) {
    // dateIndexは data-date-index の値（0始まりの日付インデックス）

    // 最上部のヘッダー日付（thead内の2行目）
    // thead 2行目: インデックス0から日付列が始まる（rowspanで固定列は1行目に結合済み）
    const headerDateRow = document.querySelector('thead tr:nth-child(2)');
    if (headerDateRow && headerDateRow.children[dateIndex]) {
        headerDateRow.children[dateIndex].classList.remove('date-hover');
    }

    // セクション日付ヘッダー（.section-date-header）
    // セクションヘッダー: インデックス0はcolspan=3、インデックス1以降が日付列
    const sectionDateHeaders = document.querySelectorAll('.section-date-header');
    sectionDateHeaders.forEach(row => {
        // セクションヘッダーの日付列は インデックス1から始まる（0はcolspan=3）
        const sectionDateIndex = dateIndex + 1;
        if (row.children[sectionDateIndex]) {
            row.children[sectionDateIndex].classList.remove('date-hover');
        }
    });

    // data-date-index属性を持つヘッダーセル（加工・組付用）
    const dateHeaderCell = document.querySelector(`thead th[data-date-index="${dateIndex}"]`);
    if (dateHeaderCell) {
        dateHeaderCell.classList.remove('date-hover');
    }
}
