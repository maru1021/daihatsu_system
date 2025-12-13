// ========================================
// 鋳造・CVT系生産計画 行ホバー処理
// ========================================
// 品番単位の行と設備単位の行の両方に対応したホバー処理

// ========================================
// 定数
// ========================================

const IDENTIFIER_TYPE = {
    ITEM: 'item',
    MACHINE: 'machine'
};

const SECTION = {
    PRODUCTION_PLAN: 'production_plan',
    OVERTIME: 'overtime',
    STOP_TIME: 'stop_time',
    MOLD_CHANGE: 'mold_change'
};

const MACHINE_RELATED_SECTIONS = [
    SECTION.OVERTIME,
    SECTION.STOP_TIME,
    SECTION.MOLD_CHANGE
];

// ========================================
// ユーティリティ関数
// ========================================

/**
 * 識別情報を作成
 * @param {string} type - タイプ（'item' または 'machine'）
 * @param {string} shift - シフト（day/night）
 * @param {string} value - 値（品番または設備インデックス）
 * @returns {{type: string, shift: string, value: string}}
 */
function createIdentifier(type, shift, value) {
    return { type, shift, value };
}

/**
 * 識別情報からホバーキーを生成
 * @param {{type: string, shift: string, value: string}} identifier - 識別情報
 * @returns {string} ホバーキー
 */
function createHoverKey(identifier) {
    return `${identifier.type}|${identifier.shift}|${identifier.value}`;
}

/**
 * すべての行のハイライトを削除
 */
function removeAllRowHighlights() {
    const rows = document.querySelectorAll('tr.row-hover');
    rows.forEach(row => row.classList.remove('row-hover'));
}

/**
 * 一致する行をハイライト
 * @param {{type: string, shift: string, value: string}} identifier - 識別情報
 */
function highlightMatchingRows(identifier) {
    const tbody = document.querySelector('tbody');
    if (!tbody) return;

    const attribute = identifier.type === IDENTIFIER_TYPE.ITEM ? 'data-item' : 'data-machine-index';
    const selector = `tr[data-shift="${identifier.shift}"][${attribute}="${identifier.value}"]`;

    const rows = tbody.querySelectorAll(selector);
    rows.forEach(row => row.classList.add('row-hover'));
}

/**
 * 複数の識別情報に一致する行をハイライト
 * @param {Array<{type: string, shift: string, value: string}>} identifiers - 識別情報の配列
 */
function highlightMultipleRows(identifiers) {
    identifiers.forEach(identifier => {
        if (identifier) {
            highlightMatchingRows(identifier);
        }
    });
}

// ========================================
// 行の識別情報取得
// ========================================

/**
 * 行の識別情報を取得
 * @param {HTMLElement} row - 行要素
 * @returns {{type: string, shift: string, value: string} | null} 識別情報またはnull
 */
function getRowIdentifier(row) {
    const shift = row.getAttribute('data-shift');
    if (!shift) return null;

    const item = row.getAttribute('data-item');
    const machineIndex = row.getAttribute('data-machine-index');

    if (item) {
        return createIdentifier(IDENTIFIER_TYPE.ITEM, shift, item);
    } else if (machineIndex !== null) {
        return createIdentifier(IDENTIFIER_TYPE.MACHINE, shift, machineIndex);
    }

    return null;
}

/**
 * 設備行からその設備で生産している品番の識別情報リストを取得
 * @param {HTMLElement} row - 設備行
 * @param {string} shift - シフト
 * @param {string} machineIndex - 設備インデックス
 * @returns {Array<{type: string, shift: string, value: string}>} 品番の識別情報リスト
 */
function getItemIdentifiersFromMachineRow(row, shift, machineIndex) {
    const tbody = document.querySelector('tbody');
    if (!tbody) return [];

    // 生産計画セクションの該当設備行を取得
    const productionPlanRow = tbody.querySelector(
        `tr[data-section="${SECTION.PRODUCTION_PLAN}"][data-shift="${shift}"][data-machine-index="${machineIndex}"]`
    );

    if (!productionPlanRow) return [];

    // その行のすべてのセルから品番を取得
    const cells = productionPlanRow.querySelectorAll('td[data-shift][data-date-index][data-machine-index]');
    const itemSet = new Set();
    const identifiers = [];

    cells.forEach(cell => {
        const item = getSelectedItemFromCell(cell);
        if (item && !itemSet.has(item)) {
            itemSet.add(item);
            identifiers.push(createIdentifier(IDENTIFIER_TYPE.ITEM, shift, item));
        }
    });

    return identifiers;
}

// ========================================
// セルの識別情報取得
// ========================================

/**
 * セルから選択されている品番を取得
 * @param {HTMLElement} cell - セル要素
 * @returns {string | null} 品番またはnull（空文字列の場合もnullを返す）
 */
function getSelectedItemFromCell(cell) {
    const select = cell.querySelector('select.vehicle-select');
    if (!select) return null;

    // data-vehicle属性ではなく、実際のselect.valueを使用
    const item = select.value;
    // 空文字列やnull、undefinedの場合はnullを返す
    return (item && item.trim()) ? item.trim() : null;
}

/**
 * 生産計画セルから品番を取得
 * @param {string} shift - シフト（day/night）
 * @param {string} dateIndex - 日付インデックス
 * @param {string} machineIndex - 設備インデックス
 * @returns {string | null} 品番またはnull
 */
function getItemFromProductionPlanCell(shift, dateIndex, machineIndex) {
    const tbody = document.querySelector('tbody');
    if (!tbody) return null;

    const selector =
        `tr[data-section="${SECTION.PRODUCTION_PLAN}"][data-shift="${shift}"][data-machine-index="${machineIndex}"] ` +
        `td[data-shift="${shift}"][data-date-index="${dateIndex}"][data-machine-index="${machineIndex}"]`;

    const productionPlanCell = tbody.querySelector(selector);
    if (!productionPlanCell) return null;

    return getSelectedItemFromCell(productionPlanCell);
}

/**
 * セルのセクションを取得
 * @param {HTMLElement} cell - セル要素
 * @returns {string | null} セクション名またはnull
 */
function getCellSection(cell) {
    const row = cell.closest('tr');
    return row?.getAttribute('data-section') || null;
}

/**
 * セルが設備関連セクションかチェック
 * @param {string} section - セクション名
 * @returns {boolean} 設備関連セクションかどうか
 */
function isMachineRelatedSection(section) {
    return MACHINE_RELATED_SECTIONS.includes(section);
}

/**
 * セルから品番を取得（セクションに応じた取得方法を選択）
 * @param {HTMLElement} cell - セル要素
 * @param {string} section - セクション名
 * @returns {string | null} 品番またはnull
 */
function getItemFromCell(cell, section) {
    // 生産計画セクション: 直接セルから品番を取得
    if (section === SECTION.PRODUCTION_PLAN) {
        return getSelectedItemFromCell(cell);
    }

    // 設備関連セクション: 生産計画セルから品番を取得
    if (isMachineRelatedSection(section)) {
        const shift = cell.getAttribute('data-shift');
        const dateIndex = cell.getAttribute('data-date-index');
        const machineIndex = cell.getAttribute('data-machine-index');

        if (shift && dateIndex !== null && machineIndex !== null) {
            return getItemFromProductionPlanCell(shift, dateIndex, machineIndex);
        }
    }

    return null;
}

/**
 * セルの識別情報を取得
 * @param {HTMLElement} cell - セル要素
 * @returns {{type: string, shift: string, value: string} | null} 識別情報またはnull
 */
function getCellIdentifier(cell) {
    const shift = cell.getAttribute('data-shift');
    if (!shift) return null;

    const section = getCellSection(cell);
    if (!section) return null;

    const item = getItemFromCell(cell, section);
    if (!item) return null;

    return createIdentifier(IDENTIFIER_TYPE.ITEM, shift, item);
}

// ========================================
// ホバー処理
// ========================================

/**
 * 行ヘッダーホバー処理を実行
 * @param {HTMLElement} row - 行要素
 * @param {{type: string, shift: string, value: string}} identifier - 識別情報
 * @param {string} currentHoverKey - 現在のホバーキー
 * @returns {string | null} 新しいホバーキーまたはnull
 */
function executeRowHeaderHover(row, identifier, currentHoverKey) {
    const hoverKey = createHoverKey(identifier);
    if (hoverKey === currentHoverKey) return null;

    removeAllRowHighlights();

    // 設備行の場合は、設備自体と品番の両方をハイライト
    if (identifier.type === IDENTIFIER_TYPE.MACHINE) {
        const shift = identifier.shift;
        const machineIndex = identifier.value;

        // 設備行をハイライト
        highlightMatchingRows(identifier);

        // その設備で生産している品番もハイライト
        const itemIdentifiers = getItemIdentifiersFromMachineRow(row, shift, machineIndex);
        highlightMultipleRows(itemIdentifiers);
    } else {
        // 品番行の場合は、通常通りハイライト
        highlightMatchingRows(identifier);
    }

    return hoverKey;
}

/**
 * セルホバー処理を実行（設備セル用）
 * @param {{type: string, shift: string, value: string} | null} cellIdentifier - セルの識別情報（品番）
 * @param {{type: string, shift: string, value: string} | null} rowIdentifier - 行の識別情報（設備）
 * @param {string} currentHoverKey - 現在のホバーキー
 * @returns {string | null} 新しいホバーキーまたはnull
 */
function executeMachineCellHover(cellIdentifier, rowIdentifier, currentHoverKey) {
    // ホバーキーの決定（品番がある場合は品番、ない場合は設備）
    const primaryIdentifier = cellIdentifier || rowIdentifier;
    if (!primaryIdentifier) return null;

    const hoverKey = createHoverKey(primaryIdentifier);
    if (hoverKey === currentHoverKey) return null;

    removeAllRowHighlights();

    if (cellIdentifier) {
        // 品番がある場合：品番の行 + 設備行
        highlightMatchingRows(cellIdentifier);
        if (rowIdentifier && rowIdentifier.type === IDENTIFIER_TYPE.MACHINE) {
            highlightMatchingRows(rowIdentifier);
        }
    } else if (rowIdentifier && rowIdentifier.type === IDENTIFIER_TYPE.MACHINE) {
        // 品番がない場合：設備行のみ
        highlightMatchingRows(rowIdentifier);
    }

    return hoverKey;
}

/**
 * 鋳造・CVT用の行ホバー処理を設定
 *
 * 対応するホバーパターン:
 * 1. 品番の行（data-item属性）: 同じシフトと品番の全行をハイライト
 * 2. 設備の行（data-machine-index属性）: 同じシフトと設備の全行 + その設備で生産している品番の全行をハイライト
 * 3. 生産計画のセル: 選択されている品番の行をハイライト
 * 4. 設備関連セル（残業、停止時間、金型交換）: 対応する生産計画セルの品番の行をハイライト
 */
export function setupCastingRowHover() {
    const tbody = document.querySelector('tbody');
    if (!tbody) return;

    let currentHoverKey = null;

    tbody.addEventListener('mouseover', function (e) {
        // セルホバーの処理
        const cell = e.target.closest('td');
        if (cell) {
            const cellIdentifier = getCellIdentifier(cell);
            const row = cell.closest('tr');
            const rowIdentifier = row ? getRowIdentifier(row) : null;

            // 設備セルの場合
            if (rowIdentifier && rowIdentifier.type === IDENTIFIER_TYPE.MACHINE) {
                const newKey = executeMachineCellHover(cellIdentifier, rowIdentifier, currentHoverKey);
                if (newKey) {
                    currentHoverKey = newKey;
                }
                return;
            }

            // 品番行のセルなど、その他の場合は何もしない
            return;
        }

        // 行ヘッダーホバーの処理（セルにホバーしていない場合）
        const row = e.target.closest('tr');
        if (row) {
            const identifier = getRowIdentifier(row);
            if (identifier) {
                const newKey = executeRowHeaderHover(row, identifier, currentHoverKey);
                if (newKey) {
                    currentHoverKey = newKey;
                }
            }
        }
    });

    tbody.addEventListener('mouseout', function (e) {
        if (!e.relatedTarget || !tbody.contains(e.relatedTarget)) {
            removeAllRowHighlights();
            currentHoverKey = null;
        }
    });
}
