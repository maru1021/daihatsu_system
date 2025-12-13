// ========================================
// 生産計画共通JavaScript - モジュール
// ========================================
// 鋳造・加工・組付・CVT生産計画で共有される関数群

export const OVERTIME_MAX_DAY = 120;     // 日勤の残業上限（分）
export const OVERTIME_MAX_NIGHT = 60;    // 夜勤の残業上限（分）

// ========================================
// 行ホバー処理
// ========================================

/**
 * 行のホバー処理を設定（同じ品番の行をハイライト）
 */
export function setupRowHover() {
    const tbody = document.querySelector('tbody');
    if (!tbody) return;

    let currentHoverKey = null;

    tbody.addEventListener('mouseover', function (e) {
        const row = e.target.closest('tr');
        if (!row) return;

        // data-shift と data-item 属性から値を取得
        const shift = row.getAttribute('data-shift');
        const item = row.getAttribute('data-item');

        if (!shift || !item) return;

        // 同じ行を再度ホバーした場合は何もしない
        const hoverKey = `${shift}|${item}`;
        if (hoverKey === currentHoverKey) return;

        // 前の行のハイライトを削除
        removeAllRowHighlights();

        // 新しい行をハイライト
        currentHoverKey = hoverKey;
        highlightMatchingRows(shift, item);
    });

    tbody.addEventListener('mouseout', function (e) {
        // マウスがtbody全体から出た場合のみハイライトを削除
        if (!e.relatedTarget || !tbody.contains(e.relatedTarget)) {
            removeAllRowHighlights();
            currentHoverKey = null;
        }
    });
}

/**
 * 同じシフトと品番を持つ行をハイライト
 * @param {string} shift - シフト（day/night）
 * @param {string} item - 品番
 */
function highlightMatchingRows(shift, item) {
    const tbody = document.querySelector('tbody');
    if (!tbody) return;

    const rows = tbody.querySelectorAll(`tr[data-shift="${shift}"][data-item="${item}"]`);
    rows.forEach(row => {
        row.classList.add('row-hover');
    });
}

/**
 * すべての行のハイライトを削除
 */
function removeAllRowHighlights() {
    const rows = document.querySelectorAll('tr.row-hover');
    rows.forEach(row => {
        row.classList.remove('row-hover');
    });
}

// ========================================
// カラムホバー処理
// ========================================

/**
 * 列のホバー処理を設定
 */
export function setupColumnHover() {
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
export function addDateHighlight(dateIndex) {
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
export function removeDateHighlight(dateIndex) {
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
