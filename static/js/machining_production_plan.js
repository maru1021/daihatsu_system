// ========================================
// 加工生産計画JavaScript
// ========================================
// このファイルは加工ラインの生産計画管理を担当します
//
// 主な機能:
// - 複数テーブル（組付けライン別）の生産数・在庫計算
// - 同じ加工ライン名での在庫共有
// - 生産数比率の保存と自動計算
// - 良品率を考慮した在庫計算
// - 残業上限を考慮した初期割り振り
//
// 重要な設計方針:
// - 出庫数はバックエンドで組付けの生産数から毎回計算される（DBには保存されない）
// - フロントエンドでは出庫数は読み取り専用で表示のみ（編集不可）
// - 生産数は夜勤60分、日勤120分の残業上限を考慮して初期割り振りされる
// - 在庫数はフロントエンドで毎回計算される（翌月の前月末在庫として使用するため保存される）
// - 週末で休出がない場合、生産数は0だが出庫数は在庫計算に含める
//
// パフォーマンス最適化:
// - DOM要素のキャッシュシステム（O(1)アクセス）
// - デバウンス関数による再計算の抑制
// - 非同期計算によるUI応答性の向上
// - forループ化による関数呼び出しオーバーヘッドの削減
//
// コード構造:
// 1. 定数定義
// 2. グローバルキャッシュ
// 3. ユーティリティ関数
// 4. 生産数計算関数
// 5. 在庫計算関数
// 6. 残業計算関数
// 7. 稼働日状態管理
// 8. 保存処理
// 9. UI制御とイベントリスナー
// 10. 初期化処理
//
// ========================================
// 定数
// ========================================
const REGULAR_TIME_DAY = 455;           // 加工の日勤定時時間（分）
const REGULAR_TIME_NIGHT = 450;         // 加工の夜勤定時時間（分）
const OVERTIME_MAX_DAY = 120;           // 日勤の残業上限（分）
const OVERTIME_MAX_NIGHT = 60;          // 夜勤の残業上限（分）
const OVERTIME_ROUND_MINUTES = 5;       // 残業時間の丸め単位（分）
const DEBOUNCE_DELAY = 100;             // デバウンス遅延時間（ミリ秒）
const STOCK_UPDATE_DELAY = 150;         // 在庫更新遅延時間（ミリ秒）

// シフト定数
const SHIFT = {
    DAY: 'day',
    NIGHT: 'night'
};

// セル表示文字列
const CELL_TEXT = {
    REGULAR: '定時',
    WEEKEND_WORK: '休出'
};

// 品番別の生産数比率を保存
// { lineIndex: { dateIndex: { shift: { itemName: ratio } } } }
const productionRatios = {};

// ========================================
// グローバルキャッシュ（パフォーマンス最適化用）
// ========================================
let domCache = {
    tables: null,
    dateCount: 0,
    checkCells: null,
    lineCount: 0
};

// 入力要素のキャッシュ（O(1)アクセス）
// inputCache[type][lineIndex][dateIndex][shift][itemName] で直接アクセス
let inputCache = {
    production: {},   // 生産数入力
    shipment: {},     // 出庫数入力
    stock: {},        // 在庫数入力
    overtime: {},     // 残業時間入力
    stopTime: {},     // 計画停止入力
    operationRate: {} // 稼働率入力
};

// DOM要素をキャッシュして繰り返しquerySelectorを回避
function buildDOMCache() {
    domCache.tables = document.querySelectorAll('table[data-line-index]');
    domCache.dateCount = document.querySelectorAll('.operation-rate-input[data-line-index="0"]').length;
    domCache.checkCells = document.querySelectorAll('.check-cell');
    domCache.lineCount = domCache.tables.length;
}

// 入力要素のキャッシュを構築
function buildInputCache() {
    const dateCount = domCache.dateCount;
    const lineCount = domCache.lineCount;

    // 各タイプの入力要素を初期化
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
        const itemNames = getItemNames(lineIndex);

        for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
            ['day', 'night'].forEach(shift => {
                itemNames.forEach(itemName => {
                    // 生産数入力
                    const prodInput = document.querySelector(
                        `.production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`
                    );
                    if (prodInput) {
                        if (!inputCache.production[lineIndex]) inputCache.production[lineIndex] = {};
                        if (!inputCache.production[lineIndex][dateIndex]) inputCache.production[lineIndex][dateIndex] = {};
                        if (!inputCache.production[lineIndex][dateIndex][shift]) inputCache.production[lineIndex][dateIndex][shift] = {};
                        inputCache.production[lineIndex][dateIndex][shift][itemName] = prodInput;
                    }

                    // 出庫数表示（span要素）
                    const shipDisplay = document.querySelector(
                        `.shipment-display[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`
                    );
                    if (shipDisplay) {
                        if (!inputCache.shipment[lineIndex]) inputCache.shipment[lineIndex] = {};
                        if (!inputCache.shipment[lineIndex][dateIndex]) inputCache.shipment[lineIndex][dateIndex] = {};
                        if (!inputCache.shipment[lineIndex][dateIndex][shift]) inputCache.shipment[lineIndex][dateIndex][shift] = {};
                        inputCache.shipment[lineIndex][dateIndex][shift][itemName] = shipDisplay;
                    }

                    // 在庫数表示
                    const stockDisplay = document.querySelector(
                        `.stock-display[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`
                    );
                    if (stockDisplay) {
                        if (!inputCache.stock[lineIndex]) inputCache.stock[lineIndex] = {};
                        if (!inputCache.stock[lineIndex][dateIndex]) inputCache.stock[lineIndex][dateIndex] = {};
                        if (!inputCache.stock[lineIndex][dateIndex][shift]) inputCache.stock[lineIndex][dateIndex][shift] = {};
                        inputCache.stock[lineIndex][dateIndex][shift][itemName] = stockDisplay;
                    }
                });

                // 残業時間入力
                const overtimeInput = document.querySelector(
                    `.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`
                );
                if (overtimeInput) {
                    if (!inputCache.overtime[lineIndex]) inputCache.overtime[lineIndex] = {};
                    if (!inputCache.overtime[lineIndex][dateIndex]) inputCache.overtime[lineIndex][dateIndex] = {};
                    inputCache.overtime[lineIndex][dateIndex][shift] = overtimeInput;
                }

                // 計画停止入力
                const stopTimeInput = document.querySelector(
                    `.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`
                );
                if (stopTimeInput) {
                    if (!inputCache.stopTime[lineIndex]) inputCache.stopTime[lineIndex] = {};
                    if (!inputCache.stopTime[lineIndex][dateIndex]) inputCache.stopTime[lineIndex][dateIndex] = {};
                    inputCache.stopTime[lineIndex][dateIndex][shift] = stopTimeInput;
                }
            });

            // 稼働率入力
            const operationRateInput = document.querySelector(
                `.operation-rate-input[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`
            );
            if (operationRateInput) {
                if (!inputCache.operationRate[lineIndex]) inputCache.operationRate[lineIndex] = {};
                inputCache.operationRate[lineIndex][dateIndex] = operationRateInput;
            }
        }
    }
}

// キャッシュから入力要素を取得（高速アクセス）
function getCachedInput(type, lineIndex, dateIndex, shift, itemName) {
    try {
        if (type === 'production' || type === 'shipment' || type === 'stock') {
            return inputCache[type]?.[lineIndex]?.[dateIndex]?.[shift]?.[itemName];
        } else if (type === 'overtime' || type === 'stopTime') {
            return inputCache[type]?.[lineIndex]?.[dateIndex]?.[shift];
        } else if (type === 'operationRate') {
            return inputCache[type]?.[lineIndex]?.[dateIndex];
        }
    } catch (e) {
        // キャッシュがない場合はDOM検索にフォールバック
        return null;
    }
    return null;
}

// ========================================
// ユーティリティ関数
// ========================================
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 品番リストを取得（テーブルごとに異なる品番がある可能性があるため、lineIndexを指定）
function getItemNames(lineIndex) {
    const itemNames = [];
    if (lineIndex !== undefined && lineIndex !== null) {
        // 特定のテーブルから品番を取得
        const table = document.querySelector(`table[data-line-index="${lineIndex}"]`);
        if (table) {
            table.querySelectorAll('[data-section="production"][data-shift="day"] .vehicle-label').forEach(label => {
                itemNames.push(label.textContent.trim());
            });
        }
    } else {
        // lineIndexが指定されていない場合は最初のテーブルから取得（後方互換性）
        const firstTable = document.querySelector('table[data-line-index="0"]');
        if (firstTable) {
            firstTable.querySelectorAll('[data-section="production"][data-shift="day"] .vehicle-label').forEach(label => {
                itemNames.push(label.textContent.trim());
            });
        }
    }
    return itemNames;
}

// 全テーブルの品番を重複なく取得
function getAllItemNames() {
    const itemNamesSet = new Set();
    const tables = document.querySelectorAll('table[data-line-index]');
    tables.forEach(table => {
        table.querySelectorAll('[data-section="production"][data-shift="day"] .vehicle-label').forEach(label => {
            itemNamesSet.add(label.textContent.trim());
        });
    });
    return Array.from(itemNamesSet);
}

// 入力要素を取得
function getInputElement(selector) {
    return document.querySelector(selector);
}

// 入力値を取得（非表示の場合は0を返す）
function getInputValue(input) {
    return input && input.style.display !== 'none' ? (parseInt(input.value) || 0) : 0;
}

// 出庫数の値を取得（span要素から）
function getShipmentValue(shipmentDisplay) {
    return shipmentDisplay && shipmentDisplay.style.display !== 'none' ? (parseInt(shipmentDisplay.textContent) || 0) : 0;
}

// セルのスタイルを設定
function setCellStyle(cell, value) {
    if (cell) {
        cell.textContent = value > 0 ? value : '';
        cell.style.fontWeight = 'bold';
        cell.style.textAlign = 'center';
    }
}

// 生産数の比率を保存
function saveProductionRatios(lineIndex, dateIndex, shift) {
    const itemNames = getItemNames(lineIndex);
    let total = 0;
    const values = {};

    itemNames.forEach(name => {
        const input = getInputElement(`.production-input[data-shift="${shift}"][data-item="${name}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
        const value = input && input.style.display !== 'none' ? (parseInt(input.value) || 0) : 0;
        values[name] = value;
        total += value;
    });

    if (!productionRatios[lineIndex]) productionRatios[lineIndex] = {};
    if (!productionRatios[lineIndex][dateIndex]) productionRatios[lineIndex][dateIndex] = {};
    if (!productionRatios[lineIndex][dateIndex][shift]) productionRatios[lineIndex][dateIndex][shift] = {};

    if (total > 0) {
        itemNames.forEach(name => {
            productionRatios[lineIndex][dateIndex][shift][name] = values[name] / total;
        });
    } else {
        // 値がない場合は均等割り
        const equalRatio = 1.0 / itemNames.length;
        itemNames.forEach(name => {
            productionRatios[lineIndex][dateIndex][shift][name] = equalRatio;
        });
    }

    let ratioSum = 0;
    Object.values(productionRatios[lineIndex][dateIndex][shift]).forEach(r => ratioSum += r);
}

// 保存された比率を取得
function getProductionRatio(lineIndex, dateIndex, shift, itemName) {
    if (productionRatios[lineIndex] &&
        productionRatios[lineIndex][dateIndex] &&
        productionRatios[lineIndex][dateIndex][shift] &&
        productionRatios[lineIndex][dateIndex][shift][itemName] !== undefined) {
        return productionRatios[lineIndex][dateIndex][shift][itemName];
    }
    // 保存されていない場合は均等割り
    const itemNames = getItemNames(lineIndex);
    return 1.0 / itemNames.length;
}

// 全品番の生産数を更新（共通処理）
/**
 * 全品番の生産数を更新
 * @param {number} dateIndex - 日付インデックス
 * @param {string[]} shifts - シフト配列（例: [SHIFT.DAY, SHIFT.NIGHT]）
 * @param {boolean} forceRecalculate - 強制再計算フラグ
 * @param {number} lineIndex - ラインインデックス
 */
function updateAllItemsProduction(dateIndex, shifts, forceRecalculate = false, lineIndex = 0) {
    const itemNames = getItemNames(lineIndex);
    shifts.forEach(shift => {
        itemNames.forEach(itemName => {
            updateProductionQuantity(dateIndex, shift, itemName, forceRecalculate, lineIndex);
        });
    });
}

// ========================================
// 生産数自動計算機能
// 現在の生産数の比率を維持したまま再計算
// ========================================
function calculateProductionQuantity(dateIndex, shift, itemName, lineIndex) {
    const itemData = linesItemData[lineIndex] || {};
    const tact = itemData.tact || 0;

    if (tact === 0) return 0;

    // キャッシュから稼働率入力を取得
    const occupancyRateInput = getCachedInput('operationRate', lineIndex, dateIndex) ||
        getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
    const occupancyRate = occupancyRateInput ? (parseFloat(occupancyRateInput.value) || 0) / 100 : 0;
    if (occupancyRate === 0) return 0;

    const regularTime = shift === 'day' ? REGULAR_TIME_DAY : REGULAR_TIME_NIGHT;

    // キャッシュから残業時間入力を取得
    const overtimeInput = getCachedInput('overtime', lineIndex, dateIndex, shift) ||
        getInputElement(`.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
    let overtime = getInputValue(overtimeInput);

    // キャッシュから計画停止入力を取得
    const stopTimeInput = getCachedInput('stopTime', lineIndex, dateIndex, shift) ||
        getInputElement(`.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
    const stopTime = getInputValue(stopTimeInput);

    // チェックセル取得（土日・定時判定用）
    const checkCell = document.querySelector(`.check-cell[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
    const isWeekend = checkCell?.getAttribute('data-weekend') === 'true';
    const isHolidayWork = checkCell?.textContent.trim() === '休出';
    const isRegularHours = checkCell?.getAttribute('data-regular-hours') === 'true';

    // 残業上限を適用
    const maxOvertime = shift === 'day' ? OVERTIME_MAX_DAY : OVERTIME_MAX_NIGHT;

    // 土日で休出でない場合は残業0
    if (isWeekend && !isHolidayWork) {
        overtime = 0;
    }
    // 日勤で定時チェックがある場合は残業0
    else if (shift === 'day' && isRegularHours) {
        overtime = 0;
    }
    // 土日の休出の場合は残業0
    else if (isWeekend && isHolidayWork) {
        overtime = 0;
    }
    // 通常時は残業上限を適用
    else {
        overtime = Math.min(overtime, maxOvertime);
    }

    const productionTime = regularTime + overtime - stopTime;
    if (productionTime <= 0) return 0;

    // 基本生産数 = 生産可能時間 / タクト * 稼働率（切り上げ）
    const baseQuantity = Math.ceil(productionTime / tact * occupancyRate);

    // 保存された比率を使って配分
    const ratio = getProductionRatio(lineIndex, dateIndex, shift, itemName);
    const result = Math.round(baseQuantity * ratio);

    return result;
}

// コンロッドライン用：出庫数の比率から残業時間に応じた生産数を計算
function calculateConrodProductionByRatio(lineIndex, dateIndex, shift) {
    const tables = domCache.tables || document.querySelectorAll('table[data-line-index]');
    const lineName = tables[lineIndex]?.getAttribute('data-line-name');

    // コンロッドラインでない場合は処理しない
    if (!lineName || !lineName.includes('コンロッド')) {
        return false;
    }

    // 残業時間を取得
    const overtimeInput = getCachedInput('overtime', lineIndex, dateIndex, shift) ||
        getInputElement(`.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);

    const overtime = overtimeInput ? (parseInt(overtimeInput.value) || 0) : 0;

    // タクトと稼働率を取得
    const itemData = linesItemData[lineIndex] || {};
    const tact = itemData.tact || 0;
    if (tact === 0) return false;

    const occupancyRateInput = getCachedInput('operationRate', lineIndex, dateIndex) ||
        getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
    const occupancyRate = occupancyRateInput ? (parseFloat(occupancyRateInput.value) || 0) / 100 : 0;
    if (occupancyRate === 0) return false;

    // 停止時間を取得
    const stopTimeInput = getCachedInput('stopTime', lineIndex, dateIndex, shift) ||
        getInputElement(`.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
    const stopTime = getInputValue(stopTimeInput);

    // 定時間を取得
    const regularTime = shift === 'day' ? REGULAR_TIME_DAY : REGULAR_TIME_NIGHT;

    // チェックセル取得（土日・定時判定用）
    const checkCell = document.querySelector(`.check-cell[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
    const isWeekend = checkCell?.getAttribute('data-weekend') === 'true';
    const isHolidayWork = checkCell?.textContent.trim() === '休出';
    const isRegularHours = checkCell?.getAttribute('data-regular-hours') === 'true';

    // 残業上限を適用
    let effectiveOvertime = overtime;
    const maxOvertime = shift === 'day' ? OVERTIME_MAX_DAY : OVERTIME_MAX_NIGHT;

    // 土日で休出でない場合、日勤で定時チェックがある場合、土日の休出の場合は残業0
    if ((isWeekend && !isHolidayWork) || (shift === 'day' && isRegularHours) || (isWeekend && isHolidayWork)) {
        effectiveOvertime = 0;
    } else {
        effectiveOvertime = Math.min(effectiveOvertime, maxOvertime);
    }

    // 総生産可能時間
    const totalProductionTime = regularTime + effectiveOvertime - stopTime;
    if (totalProductionTime <= 0) return false;

    // 総生産可能台数
    const totalProducibleQuantity = Math.ceil(totalProductionTime / tact * occupancyRate);

    // 出庫数から比率を計算
    const itemNames = getItemNames(lineIndex);
    const shipmentRatios = {};
    let totalShipment = 0;

    itemNames.forEach(name => {
        const shipmentDisplay = getCachedInput('shipment', lineIndex, dateIndex, shift, name) ||
            getInputElement(`.shipment-display[data-shift="${shift}"][data-item="${name}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);

        const shipmentValue = getShipmentValue(shipmentDisplay);
        shipmentRatios[name] = shipmentValue;
        totalShipment += shipmentValue;
    });

    if (totalShipment === 0) {
        return false;
    }

    // 比率に応じて生産数を配分
    itemNames.forEach(name => {
        const ratio = shipmentRatios[name] / totalShipment;
        const productionQty = Math.round(totalProducibleQuantity * ratio);

        const productionInput = getCachedInput('production', lineIndex, dateIndex, shift, name) ||
            getInputElement(`.production-input[data-shift="${shift}"][data-item="${name}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);

        if (productionInput && productionInput.style.display !== 'none') {
            productionInput.value = productionQty;
        }
    });

    return true;
}

// 生産数の入力フィールドを更新
function updateProductionQuantity(dateIndex, shift, itemName, forceUpdate = false, lineIndex = 0) {
    // キャッシュから生産数入力を取得
    const productionInput = getCachedInput('production', lineIndex, dateIndex, shift, itemName) ||
        getInputElement(`.production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);

    if (!productionInput || productionInput.style.display === 'none') {
        return;
    }

    // DBに保存されたデータがある場合はスキップ（data-has-db-value属性で判定）
    const hasDbValue = productionInput.dataset.hasDbValue === 'true';
    if (!forceUpdate && hasDbValue) {
        // DBに保存された値がある場合はそのまま使用（何もしない）
        return;
    }

    // 生産数データがDBにない場合（初期表示時）
    if (!forceUpdate && !hasDbValue) {
        // コンロッドラインかチェック
        const tables = domCache.tables || document.querySelectorAll('table[data-line-index]');
        const lineName = tables[lineIndex]?.getAttribute('data-line-name');

        // コンロッドラインの場合は出庫数をコピーせず、後でperformInitialCalculationsで計算する
        if (lineName && lineName.includes('コンロッド')) {
            // ここでは何もしない（値を設定しない）
            return;
        }

        // 通常ライン：出庫数は日付単位で割り振られるため、ここでは何もしない
        // allocateShipmentToProductionで一括処理される
        return;
    }

    const quantity = calculateProductionQuantity(dateIndex, shift, itemName, lineIndex);
    if (quantity > 0) {
        productionInput.value = quantity;
    } else if (forceUpdate) {
        productionInput.value = '';
    }
}

// すべての生産数を更新
function updateAllProductionQuantities() {
    const tables = domCache.tables || document.querySelectorAll('table[data-line-index]');
    const dateCount = domCache.dateCount || document.querySelectorAll('.operation-rate-input[data-line-index="0"]').length;

    tables.forEach((_table, lineIndex) => {
        const itemNames = getItemNames(lineIndex);
        for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
            itemNames.forEach(itemName => {
                updateProductionQuantity(dateIndex, 'day', itemName, false, lineIndex);
                updateProductionQuantity(dateIndex, 'night', itemName, false, lineIndex);
            });
        }
    });

    updateRowTotals();
}

// 出庫数を夜勤と日勤に残業上限を考慮して割り振る
function allocateShipmentToProduction() {
    const tables = domCache.tables || document.querySelectorAll('table[data-line-index]');
    const dateCount = domCache.dateCount || document.querySelectorAll('.operation-rate-input[data-line-index="0"]').length;

    tables.forEach((_table, lineIndex) => {
        const lineName = _table?.getAttribute('data-line-name');

        // コンロッドラインは別処理なのでスキップ
        if (lineName && lineName.includes('コンロッド')) {
            return;
        }

        const itemNames = getItemNames(lineIndex);

        // 対象月全体で、DBに保存された生産数が1つでもあるかチェック
        const hasAnyDbValueInMonth = itemNames.some(itemName => {
            for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
                const dayInput = getCachedInput('production', lineIndex, dateIndex, 'day', itemName);
                const nightInput = getCachedInput('production', lineIndex, dateIndex, 'night', itemName);
                if ((dayInput && dayInput.dataset.hasDbValue === 'true') ||
                    (nightInput && nightInput.dataset.hasDbValue === 'true')) {
                    return true;
                }
            }
            return false;
        });

        // 対象月に1つでもDBデータがある場合は、出庫数からの生産数計算は不要
        if (hasAnyDbValueInMonth) {
            return;
        }

        for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
            // checkCellの状態を確認
            const checkCell = document.querySelector(`.check-cell[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
            const checkText = checkCell ? checkCell.textContent.trim() : '';
            const isWeekend = checkCell ? checkCell.getAttribute('data-weekend') === 'true' : false;
            const hadData = checkCell ? checkCell.getAttribute('data-has-weekend-work') === 'true' : false;

            // 週末の場合
            if (isWeekend) {
                // 休出でない場合はスキップ
                if (checkText !== CELL_TEXT.WEEKEND_WORK) {
                    continue;
                }
                // DBにデータがない場合もスキップ（組付の休出に合わせた初期表示のケース）
                if (!hadData) {
                    continue;
                }
            }
            // 平日の場合は常に計算（定時チェック不要）

            // タクトと稼働率を取得
            const itemData = linesItemData[lineIndex] || {};
            const tact = itemData.tact || 0;
            if (tact === 0) continue;

            const occupancyRateInput = getCachedInput('operationRate', lineIndex, dateIndex);
            if (!occupancyRateInput) continue;
            const occupancyRate = (parseFloat(occupancyRateInput.value) || 0) / 100;
            if (occupancyRate === 0) continue;

            // 夜勤の停止時間を取得
            const nightStopTimeInput = getCachedInput('stopTime', lineIndex, dateIndex, 'night');
            const nightStopTime = getInputValue(nightStopTimeInput);

            // 日勤の停止時間を取得
            const dayStopTimeInput = getCachedInput('stopTime', lineIndex, dateIndex, 'day');
            const dayStopTime = getInputValue(dayStopTimeInput);

            // 夜勤で残業60分で生産可能な最大台数
            const maxNightProductionTime = REGULAR_TIME_NIGHT - nightStopTime + OVERTIME_MAX_NIGHT;
            const maxNightProduction = maxNightProductionTime > 0
                ? Math.floor(maxNightProductionTime / tact * occupancyRate)
                : 0;

            // 日勤で残業120分で生産可能な最大台数
            const maxDayProductionTime = REGULAR_TIME_DAY - dayStopTime + OVERTIME_MAX_DAY;
            const maxDayProduction = maxDayProductionTime > 0
                ? Math.floor(maxDayProductionTime / tact * occupancyRate)
                : 0;

            // 各品番の出庫数を取得して合計
            let totalShipment = 0;
            const shipmentByItem = {};
            itemNames.forEach(itemName => {
                const dayShipmentDisplay = getCachedInput('shipment', lineIndex, dateIndex, 'day', itemName);
                const shipmentValue = getShipmentValue(dayShipmentDisplay);
                shipmentByItem[itemName] = shipmentValue;
                totalShipment += shipmentValue;
            });

            if (totalShipment === 0) {
                // 出庫数が0の場合は生産数も0（表示されている入力のみ）
                itemNames.forEach(itemName => {
                    const dayProductionInput = getCachedInput('production', lineIndex, dateIndex, 'day', itemName);
                    const nightProductionInput = getCachedInput('production', lineIndex, dateIndex, 'night', itemName);
                    if (dayProductionInput && dayProductionInput.style.display !== 'none') {
                        dayProductionInput.value = 0;
                    }
                    if (nightProductionInput && nightProductionInput.style.display !== 'none') {
                        nightProductionInput.value = 0;
                    }
                });
                continue;
            }

            // 夜勤と日勤に割り振る
            // 日勤には出庫数全体を割り振り、夜勤は上限内で割り振る
            // 夜勤が上限を超える場合は、超過分を日勤に追加

            let nightAllocation = 0;
            let dayAllocation = 0;
            let nightOverflow = 0;  // 夜勤で溢れた分

            // 夜勤の割り振り（上限まで）
            if (totalShipment <= maxNightProduction) {
                // 出庫数全体が夜勤の上限内に収まる場合
                nightAllocation = totalShipment;
                dayAllocation = totalShipment;  // 日勤にも全体を割り振る
            } else {
                // 出庫数が夜勤の上限を超える場合
                nightAllocation = maxNightProduction;
                nightOverflow = totalShipment - maxNightProduction;

                // 日勤には出庫数全体 + 夜勤の溢れ分を割り振る（上限まで）
                const totalDayRequired = totalShipment + nightOverflow;
                dayAllocation = Math.min(totalDayRequired, maxDayProduction);
            }

            // 各品番に比率で割り振る
            itemNames.forEach(itemName => {
                const itemShipment = shipmentByItem[itemName];
                if (itemShipment === 0) {
                    const dayProductionInput = getCachedInput('production', lineIndex, dateIndex, 'day', itemName);
                    const nightProductionInput = getCachedInput('production', lineIndex, dateIndex, 'night', itemName);
                    // 表示されている場合のみ値を設定（非表示の場合は設定しない）
                    if (dayProductionInput && dayProductionInput.style.display !== 'none') {
                        dayProductionInput.dataset.programmaticChange = 'true';
                        dayProductionInput.value = 0;
                        setTimeout(() => delete dayProductionInput.dataset.programmaticChange, 0);
                    }
                    if (nightProductionInput && nightProductionInput.style.display !== 'none') {
                        nightProductionInput.dataset.programmaticChange = 'true';
                        nightProductionInput.value = 0;
                        setTimeout(() => delete nightProductionInput.dataset.programmaticChange, 0);
                    }
                    return;
                }

                const ratio = itemShipment / totalShipment;
                const nightProductionValue = Math.round(nightAllocation * ratio);
                const dayProductionValue = Math.round(dayAllocation * ratio);

                const nightProductionInput = getCachedInput('production', lineIndex, dateIndex, 'night', itemName);
                const dayProductionInput = getCachedInput('production', lineIndex, dateIndex, 'day', itemName);

                if (nightProductionInput && nightProductionInput.style.display !== 'none') {
                    nightProductionInput.dataset.programmaticChange = 'true';
                    nightProductionInput.value = nightProductionValue;
                    setTimeout(() => delete nightProductionInput.dataset.programmaticChange, 0);
                }

                // 表示されている場合のみ値を設定（非表示の場合は設定しない）
                if (dayProductionInput && dayProductionInput.style.display !== 'none') {
                    dayProductionInput.dataset.programmaticChange = 'true';
                    dayProductionInput.value = dayProductionValue;
                    setTimeout(() => delete dayProductionInput.dataset.programmaticChange, 0);
                }
            });
        }
    });
}

// ========================================
// 合計値・在庫計算機能
// ========================================
/**
 * セクションごとの合計を計算（input要素とspan要素の両方に対応）
 * @param {NodeList} rows - 対象の行
 * @param {string} elementClass - 合計対象の要素のクラス名
 * @param {Object} options - オプション設定
 * @param {boolean} options.showZero - 0の場合も表示するか（デフォルト: false）
 * @param {string} options.targetCellClass - 合計を表示するセルのクラス名（デフォルト: 'monthly-total'）
 */
function calculateSectionTotal(rows, elementClass, options = {}) {
    const { showZero = false, targetCellClass = 'monthly-total' } = options;

    rows.forEach(row => {
        let total = 0;
        const elements = row.querySelectorAll(`.${elementClass}`);

        elements.forEach(element => {
            if (element.style.display !== 'none') {
                // input要素かspan要素かを判定
                const value = element.tagName === 'SPAN'
                    ? (parseInt(element.textContent) || 0)
                    : (parseInt(element.value) || 0);
                total += value;
            }
        });

        const targetCell = row.querySelector(`.${targetCellClass}`);
        if (targetCell) {
            targetCell.textContent = (total > 0 || showZero) ? total : '';
            targetCell.style.fontWeight = 'bold';
            targetCell.style.textAlign = 'center';
            if (targetCellClass === 'stock-difference') {
                targetCell.style.backgroundColor = '#e0f2fe';
            }
        }
    });
}

/**
 * 在庫数の月計を更新（月末在庫 - 前月末在庫の差分）
 */
function updateStockMonthlyTotals() {
    // 在庫数の日勤月間合計（月末在庫 - 前月末在庫の差分）
    document.querySelectorAll('[data-section="stock"][data-shift="day"]').forEach(row => {
        const itemName = row.getAttribute('data-item');
        if (!itemName) return;

        // 表示されている在庫を取得
        const displays = Array.from(row.querySelectorAll('.stock-display')).filter(
            display => display.style.display !== 'none' && display.textContent.trim() !== ''
        );

        if (displays.length > 0) {
            // 前月末在庫を取得
            const previousStock = (typeof previousMonthStocks !== 'undefined' && previousMonthStocks[itemName])
                ? previousMonthStocks[itemName]
                : 0;
            // 月末在庫（最後の在庫数）を取得
            const lastStock = parseInt(displays[displays.length - 1].textContent) || 0;
            const difference = lastStock - previousStock;

            // stock-differenceセルに表示（月計列）
            const stockDifferenceCell = row.querySelector('.stock-difference');
            if (stockDifferenceCell) {
                stockDifferenceCell.textContent = difference !== 0 ? difference : '';
                stockDifferenceCell.style.fontWeight = 'bold';
                stockDifferenceCell.style.textAlign = 'center';
                stockDifferenceCell.style.backgroundColor = '#e0f2fe';
            }
        } else {
            const stockDifferenceCell = row.querySelector('.stock-difference');
            if (stockDifferenceCell) {
                stockDifferenceCell.textContent = '';
            }
        }
    });

    // 在庫数の夜勤月間合計（表示しない）
    document.querySelectorAll('[data-section="stock"][data-shift="night"]').forEach(row => {
        const monthlyTotalCell = row.querySelector('.monthly-total');
        if (monthlyTotalCell) {
            monthlyTotalCell.textContent = '';
        }
    });
}

/**
 * 日勤+夜勤の月計(直)を計算（生産数と出庫数）
 *
 * 重要: 複数のMachiningLineに同じ品番が存在する場合、
 * 各テーブル内で日勤と夜勤をペアリングする必要がある。
 * そのため、日勤行の親テーブルを取得し、同じテーブル内で夜勤行を検索する。
 */
function updateDailyTotals() {
    const sections = ['production', 'shipment'];

    sections.forEach(section => {
        const inputClass = section === 'production' ? 'production-input' : 'shipment-display';

        document.querySelectorAll(`[data-section="${section}"][data-shift="day"]`).forEach(dayRow => {
            const itemName = dayRow.getAttribute('data-item');
            if (!itemName) return;

            // 同じテーブル内の夜勤行を取得
            const nightRow = getNightRowInSameTable(dayRow, section, itemName);
            if (!nightRow) return;

            // 日勤と夜勤の入力要素を取得
            const dayInputs = dayRow.querySelectorAll(`.${inputClass}`);
            const nightInputs = nightRow.querySelectorAll(`.${inputClass}`);

            // 日勤+夜勤の合計を計算
            const dailyTotal = calculateDayAndNightTotal(dayInputs, nightInputs);

            // 月計(直)セルに表示
            updateDailyTotalCell(dayRow, dailyTotal);
        });
    });
}

/**
 * 同じテーブル内の夜勤行を取得
 * 複数テーブルに同じ品番が存在する場合を考慮
 */
function getNightRowInSameTable(dayRow, section, itemName) {
    const table = dayRow.closest('table');

    if (table) {
        // 同じテーブル内で夜勤行を検索
        return table.querySelector(`[data-section="${section}"][data-shift="night"][data-item="${itemName}"]`);
    }

    // フォールバック: グローバル検索
    return document.querySelector(`[data-section="${section}"][data-shift="night"][data-item="${itemName}"]`);
}

/**
 * 日勤と夜勤の入力値を合計（input要素とspan要素の両方に対応）
 */
function calculateDayAndNightTotal(dayInputs, nightInputs) {
    let total = 0;

    dayInputs.forEach((dayInput, index) => {
        if (dayInput.style.display !== 'none') {
            // input要素かspan要素かを判定
            const dayValue = dayInput.tagName === 'SPAN'
                ? (parseInt(dayInput.textContent) || 0)
                : (parseInt(dayInput.value) || 0);

            const nightInput = nightInputs[index];
            const nightValue = nightInput && nightInput.style.display !== 'none'
                ? (nightInput.tagName === 'SPAN'
                    ? (parseInt(nightInput.textContent) || 0)
                    : (parseInt(nightInput.value) || 0))
                : 0;

            total += dayValue + nightValue;
        }
    });

    return total;
}

/**
 * 月計(直)セルを更新
 */
function updateDailyTotalCell(row, total) {
    const dailyTotalCell = row.querySelector('.daily-total');

    if (dailyTotalCell) {
        dailyTotalCell.textContent = total > 0 ? total : '';
        dailyTotalCell.style.fontWeight = 'bold';
        dailyTotalCell.style.textAlign = 'center';
        dailyTotalCell.style.backgroundColor = '#e0f2fe';
    }
}

/**
 * 在庫数を計算（前日在庫 + 生産数 - 出庫数）
 *
 * 重要な仕様:
 * - 同じ直内では全テーブルで同じ在庫を表示（在庫共有）
 * - DBから在庫値は読み込まず、常にフロントエンドで計算
 * - 保存時にDBに保存し、翌月の前月末在庫として使用
 * - 週末で休出がない場合は生産数を0として計算
 * - 出庫数は組付けの生産数なので常に計算に含める
 */
function updateStockQuantities() {
    const itemNames = getAllItemNames();
    const tables = domCache.tables || document.querySelectorAll('table[data-line-index]');
    const dateCount = domCache.dateCount || document.querySelectorAll('.operation-rate-input[data-line-index="0"]').length;

    // 在庫計算前に、休出がついていない週末の生産数を強制的に0にする
    for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
        for (let lineIndex = 0; lineIndex < tables.length; lineIndex++) {
            const checkCell = document.querySelector(`.check-cell[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
            const isWeekend = checkCell ? checkCell.getAttribute('data-weekend') === 'true' : false;
            const checkText = checkCell ? checkCell.textContent.trim() : '';

            // 週末で休出がない場合、生産数を強制的に0にする
            if (isWeekend && checkText !== CELL_TEXT.WEEKEND_WORK) {
                for (const itemName of itemNames) {
                    // 日勤の生産数を0に
                    const dayProductionInput = getCachedInput('production', lineIndex, dateIndex, 'day', itemName);
                    if (dayProductionInput) {
                        const currentValue = dayProductionInput.value;
                        if (currentValue && currentValue !== '0' && currentValue !== '') {
                            dayProductionInput.value = '0';
                        }
                    }

                    // 夜勤の生産数を0に
                    const nightProductionInput = getCachedInput('production', lineIndex, dateIndex, 'night', itemName);
                    if (nightProductionInput) {
                        const currentValue = nightProductionInput.value;
                        if (currentValue && currentValue !== '0' && currentValue !== '') {
                            nightProductionInput.value = '0';
                        }
                    }
                }
            }
        }
    }

    // 品番ごとに在庫を計算
    for (let i = 0; i < itemNames.length; i++) {
        const itemName = itemNames[i];

        // 前月末の在庫から開始（データがなければ0）
        // ★重要: 小数で管理して端数を累積する（各直での切り捨てによる誤差を防ぐ）
        let calculatedStock = (typeof previousMonthStocks !== 'undefined' && previousMonthStocks[itemName])
            ? previousMonthStocks[itemName]
            : 0;

        let lastVisibleStock = null;

        // 日時順にループ（dateIndex, shift）
        for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
            // 日勤の処理
            {
                // 同じ直内の全テーブルの生産・出庫を合計
                let totalGoodProduction = 0;
                let totalShipment = 0;
                let totalStockAdjustment = 0;
                let hasVisibleStock = false;

                for (let lineIndex = 0; lineIndex < tables.length; lineIndex++) {
                    // チェックセルを確認（休出削除済みかどうか）
                    const checkCell = document.querySelector(`.check-cell[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
                    const checkText = checkCell ? checkCell.textContent.trim() : '';
                    const isWeekend = checkCell ? checkCell.getAttribute('data-weekend') === 'true' : false;

                    // このテーブルの良品率を取得
                    const itemData = linesItemData[lineIndex] || {};
                    const yieldRate = itemData.yield_rate || 1.0;

                    const dayProductionInput = getCachedInput('production', lineIndex, dateIndex, 'day', itemName) ||
                        getInputElement(`.production-input[data-line-index="${lineIndex}"][data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
                    const dayShipmentDisplay = getCachedInput('shipment', lineIndex, dateIndex, 'day', itemName) ||
                        getInputElement(`.shipment-display[data-line-index="${lineIndex}"][data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
                    const dayStockDisplay = getCachedInput('stock', lineIndex, dateIndex, 'day', itemName) ||
                        getInputElement(`.stock-display[data-line-index="${lineIndex}"][data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
                    const dayStockAdjustmentInput = getInputElement(`.stock-adjustment-input[data-line-index="${lineIndex}"][data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);

                    // 表示されているセルのみ計算対象
                    if (dayStockDisplay && dayStockDisplay.style.display !== 'none') {
                        hasVisibleStock = true;

                        // 生産数: 週末で休出がない場合は0、それ以外は入力値を使用
                        let dayProduction = 0;
                        if (isWeekend && checkText !== CELL_TEXT.WEEKEND_WORK) {
                            // 週末で休出がない場合は生産数0
                            dayProduction = 0;
                        } else if (dayProductionInput && dayProductionInput.style.display !== 'none') {
                            // 表示されている場合のみ値を取得
                            dayProduction = parseInt(dayProductionInput.value) || 0;
                        }

                        // 出庫数: 組付けが使用する個数なので常に計算に含める
                        const dayShipment = getShipmentValue(dayShipmentDisplay);
                        const dayStockAdjustment = dayStockAdjustmentInput ? (parseInt(dayStockAdjustmentInput.value) || 0) : 0;

                        // 良品率を適用して合計
                        totalGoodProduction += dayProduction * yieldRate;
                        totalShipment += dayShipment;

                        // 在庫数調整は最初のテーブルのみ集計（全テーブル共通なので重複カウント防止）
                        if (lineIndex === 0) {
                            totalStockAdjustment = dayStockAdjustment;
                        }
                    }
                }

                // 在庫を計算（小数累積）+ 在庫数調整
                if (hasVisibleStock) {
                    calculatedStock = calculatedStock + totalGoodProduction - totalShipment + totalStockAdjustment;
                    const stockValue = Math.floor(calculatedStock);

                    // 全テーブルに同じ在庫を設定
                    for (let lineIndex = 0; lineIndex < tables.length; lineIndex++) {
                        const dayStockDisplay = getCachedInput('stock', lineIndex, dateIndex, 'day', itemName) ||
                            getInputElement(`.stock-display[data-line-index="${lineIndex}"][data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
                        if (dayStockDisplay) {
                            // display:noneでない場合のみ表示と背景色を更新
                            if (dayStockDisplay.style.display !== 'none') {
                                dayStockDisplay.textContent = stockValue;
                                // 負の値の場合はnegative-stockクラスを追加
                                const parentCell = dayStockDisplay.parentElement;
                                if (stockValue < 0) {
                                    parentCell.classList.add('negative-stock');
                                } else {
                                    parentCell.classList.remove('negative-stock');
                                }
                            }
                        }
                    }

                    lastVisibleStock = stockValue;
                }
            }

            // 夜勤の処理
            {
                // 同じ直内の全テーブルの生産・出庫を合計
                let totalGoodProduction = 0;
                let totalShipment = 0;
                let totalStockAdjustment = 0;
                let hasVisibleStock = false;

                for (let lineIndex = 0; lineIndex < tables.length; lineIndex++) {
                    // チェックセルを確認（休出削除済みかどうか）
                    const checkCell = document.querySelector(`.check-cell[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
                    const checkText = checkCell ? checkCell.textContent.trim() : '';
                    const isWeekend = checkCell ? checkCell.getAttribute('data-weekend') === 'true' : false;

                    // このテーブルの良品率を取得
                    const itemData = linesItemData[lineIndex] || {};
                    const yieldRate = itemData.yield_rate || 1.0;

                    const nightProductionInput = getCachedInput('production', lineIndex, dateIndex, 'night', itemName) ||
                        getInputElement(`.production-input[data-line-index="${lineIndex}"][data-shift="night"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
                    const nightShipmentDisplay = getCachedInput('shipment', lineIndex, dateIndex, 'night', itemName) ||
                        getInputElement(`.shipment-display[data-line-index="${lineIndex}"][data-shift="night"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
                    const nightStockDisplay = getCachedInput('stock', lineIndex, dateIndex, 'night', itemName) ||
                        getInputElement(`.stock-display[data-line-index="${lineIndex}"][data-shift="night"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
                    const nightStockAdjustmentInput = getInputElement(`.stock-adjustment-input[data-line-index="${lineIndex}"][data-shift="night"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);

                    // 表示されているセルのみ計算対象
                    if (nightStockDisplay && nightStockDisplay.style.display !== 'none') {
                        hasVisibleStock = true;

                        // 生産数: 週末で休出がない場合は0、それ以外は入力値を使用
                        let nightProduction = 0;
                        if (isWeekend && checkText !== CELL_TEXT.WEEKEND_WORK) {
                            // 週末で休出がない場合は生産数0
                            nightProduction = 0;
                        } else if (nightProductionInput && nightProductionInput.style.display !== 'none') {
                            // 表示されている場合のみ値を取得
                            nightProduction = parseInt(nightProductionInput.value) || 0;
                        }

                        // 出庫数: 組付けが使用する個数なので常に計算に含める
                        const nightShipment = getShipmentValue(nightShipmentDisplay);
                        const nightStockAdjustment = nightStockAdjustmentInput ? (parseInt(nightStockAdjustmentInput.value) || 0) : 0;

                        // 良品率を適用して合計
                        totalGoodProduction += nightProduction * yieldRate;
                        totalShipment += nightShipment;

                        // 在庫数調整は最初のテーブルのみ集計（全テーブル共通なので重複カウント防止）
                        if (lineIndex === 0) {
                            totalStockAdjustment = nightStockAdjustment;
                        }
                    }
                }

                // 在庫を計算（小数累積）+ 在庫数調整
                if (hasVisibleStock) {
                    calculatedStock = calculatedStock + totalGoodProduction - totalShipment + totalStockAdjustment;
                    const stockValue = Math.floor(calculatedStock);

                    // 全テーブルに同じ在庫を設定
                    for (let lineIndex = 0; lineIndex < tables.length; lineIndex++) {
                        const nightStockDisplay = getCachedInput('stock', lineIndex, dateIndex, 'night', itemName) ||
                            getInputElement(`.stock-display[data-line-index="${lineIndex}"][data-shift="night"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
                        if (nightStockDisplay) {
                            // display:noneでない場合のみ表示と背景色を更新
                            if (nightStockDisplay.style.display !== 'none') {
                                nightStockDisplay.textContent = stockValue;
                                // 負の値の場合はnegative-stockクラスを追加
                                const parentCell = nightStockDisplay.parentElement;
                                if (stockValue < 0) {
                                    parentCell.classList.add('negative-stock');
                                } else {
                                    parentCell.classList.remove('negative-stock');
                                }
                            }
                        }
                    }

                    lastVisibleStock = stockValue;
                }
            }
        }

        // 月末在庫カードを更新
        const inventoryCard = document.querySelector(`.monthly-plan-item[data-item-name="${itemName}"]`);
        if (inventoryCard && lastVisibleStock !== null) {
            const stockSpan = inventoryCard.querySelector('.end-of-month-stock');
            if (stockSpan) {
                stockSpan.textContent = lastVisibleStock;

                // 適正在庫をdata属性から取得
                const optimalInventory = parseInt(inventoryCard.dataset.optimalInventory) || 0;

                // 差分を計算
                const difference = lastVisibleStock - optimalInventory;

                // カードの背景色を変更
                inventoryCard.classList.remove('shortage', 'excess');
                if (difference < 0) {
                    inventoryCard.classList.add('shortage');
                } else if (difference > 0) {
                    inventoryCard.classList.add('excess');
                }

                // 差分を更新
                const diffSpan = inventoryCard.querySelector('.monthly-plan-diff');
                if (diffSpan) {
                    diffSpan.textContent = '(' + (difference > 0 ? '+' : '') + difference + ')';
                }
            }
        }
    }
}

// 在庫差分を計算（生産数 - 出庫数）
function updateStockDifferences() {
    const itemNames = getAllItemNames();

    itemNames.forEach(itemName => {
        // 生産数の日勤合計を取得
        const productionDayRow = document.querySelector(`[data-section="production"][data-shift="day"][data-item="${itemName}"]`);
        const productionDailyTotal = productionDayRow ? (parseInt(productionDayRow.querySelector('.daily-total')?.textContent) || 0) : 0;

        // 出庫数の日勤合計を取得
        const shipmentDayRow = document.querySelector(`[data-section="shipment"][data-shift="day"][data-item="${itemName}"]`);
        const shipmentDailyTotal = shipmentDayRow ? (parseInt(shipmentDayRow.querySelector('.shipment-daily-total')?.textContent) || 0) : 0;

        // 在庫差分を計算
        const stockDifference = productionDailyTotal - shipmentDailyTotal;

        // 在庫差分セルに表示
        const stockDifferenceCell = document.querySelector(`[data-section="stock"][data-shift="day"][data-item="${itemName}"] .stock-difference`);
        if (stockDifferenceCell) {
            stockDifferenceCell.textContent = stockDifference !== 0 ? stockDifference : '';
            stockDifferenceCell.style.fontWeight = 'bold';
            stockDifferenceCell.style.textAlign = 'center';
            stockDifferenceCell.style.backgroundColor = '#e0f2fe';
        }
    });
}

// ========================================
// デバウンス版の重い計算（パフォーマンス最適化）
// ========================================
const debouncedUpdateRowTotals = debounce(updateRowTotals, DEBOUNCE_DELAY);
const debouncedUpdateStockQuantities = debounce(updateStockQuantities, STOCK_UPDATE_DELAY);

// 行の合計値を計算して表示
function updateRowTotals() {
    // 出庫数の月間合計（日勤・夜勤）
    calculateSectionTotal(
        document.querySelectorAll('[data-section="shipment"][data-shift="day"]'),
        'shipment-display'
    );
    calculateSectionTotal(
        document.querySelectorAll('[data-section="shipment"][data-shift="night"]'),
        'shipment-display'
    );

    // 生産数の月間合計（日勤・夜勤）
    calculateSectionTotal(
        document.querySelectorAll('[data-section="production"][data-shift="day"]'),
        'production-input'
    );
    calculateSectionTotal(
        document.querySelectorAll('[data-section="production"][data-shift="night"]'),
        'production-input'
    );

    // 在庫数の月計（月末在庫 - 前月末在庫）
    updateStockMonthlyTotals();

    // 残業計画の合計
    calculateSectionTotal(
        document.querySelectorAll('[data-section="overtime"]'),
        'overtime-input'
    );

    // 計画停止の合計（0の場合も表示）
    calculateSectionTotal(
        document.querySelectorAll('[data-section="stop_time"]'),
        'stop-time-input',
        { showZero: true }
    );

    // 日勤+夜勤の合計
    updateDailyTotals();
}

// ========================================
// 定時・休出チェック機能
// ========================================
const debouncedUpdateWorkingDayStatus = debounce(function (dateIndex, lineIndex) {
    updateWorkingDayStatus(dateIndex, lineIndex);
}, DEBOUNCE_DELAY);

function toggleCheck(element) {
    const isWeekend = element.getAttribute('data-weekend') === 'true';
    const currentText = element.textContent.trim();

    // トグル制御ロジック:
    // - 週末の場合は常にトグル可能（休出のオン/オフを切り替え）
    // - 平日の場合は定時のオン/オフを切り替え

    const newText = currentText === '' ? (isWeekend ? CELL_TEXT.WEEKEND_WORK : CELL_TEXT.REGULAR) : '';
    element.textContent = newText;

    // data-regular-hours属性を更新
    element.setAttribute('data-regular-hours', newText === CELL_TEXT.REGULAR ? 'true' : 'false');

    const dateIndex = parseInt(element.getAttribute('data-date-index'));
    const lineIndex = parseInt(element.getAttribute('data-line-index')) || 0;
    debouncedUpdateWorkingDayStatus(dateIndex, lineIndex);

    // 残業input表示制御を更新
    updateOvertimeInputVisibility();

    // 合計を更新（在庫はupdateWorkingDayStatus内で更新される）
    setTimeout(() => {
        updateRowTotals();
    }, 150);
}

// 入力フィールドの表示/非表示を制御
function toggleInputs(dateIndex, shift, show, lineIndex = null) {
    let selector = `[data-shift="${shift}"][data-date-index="${dateIndex}"]`;
    if (lineIndex !== null) {
        selector += `[data-line-index="${lineIndex}"]`;
    }

    // input要素の表示/非表示
    document.querySelectorAll(selector + ' input').forEach(input => {
        // 残業inputは除外（別途制御）
        if (input.classList.contains('overtime-input')) {
            return;
        }
        // 非表示にする場合は値を0にクリア（在庫計算への影響を防ぐ）
        if (!show) {
            input.value = 0;
        }
        input.style.display = show ? '' : 'none';
    });

    // 在庫表示(span)の表示/非表示
    document.querySelectorAll(selector + ' .stock-display').forEach(display => {
        // 非表示にする場合は値をクリア
        if (!show) {
            display.textContent = '';
        }
        display.style.display = show ? '' : 'none';
    });
}

// 残業上限を設定
function setOvertimeLimit(dateIndex, shift, max, lineIndex = null) {
    let selector = `.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`;
    if (lineIndex !== null) {
        selector += `[data-line-index="${lineIndex}"]`;
    }
    const input = getInputElement(selector);
    if (input) {
        if (max !== null) {
            input.setAttribute('max', max);
            // 上限が0の場合、現在値が0でなければ0に設定
            // プログラマティックな変更を示すフラグを設定してinputイベントを抑制
            if (max === 0 && input.value !== '0') {
                input.dataset.programmaticChange = 'true';
                input.value = '0';
                // フラグをクリア（nextTickで）
                setTimeout(() => {
                    delete input.dataset.programmaticChange;
                }, 0);
            }
        } else {
            input.removeAttribute('max');
        }
    }
}

// 週末の休出状態と平日の定時状態を初期化
function initializeWeekendWorkingStatus() {
    // 当月データがあるかどうかを判定（全ラインで1つでもhas_dataがあればデータありと判断）
    const hasAnyData = Array.from(document.querySelectorAll('.check-cell')).some(cell =>
        cell.getAttribute('data-has-weekend-work') === 'true'
    );

    document.querySelectorAll('.check-cell').forEach((checkCell) => {
        const dateIndex = parseInt(checkCell.getAttribute('data-date-index'));
        const lineIndex = parseInt(checkCell.getAttribute('data-line-index')) || 0;
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const isRegularHours = checkCell.getAttribute('data-regular-hours') === 'true';
        const hasAssemblyWeekendWork = checkCell.getAttribute('data-has-assembly-weekend-work') === 'true';

        if (isWeekend) {
            // 週末の初期化処理
            const checkText = checkCell.textContent.trim();
            const hasWeekendWork = checkText === CELL_TEXT.WEEKEND_WORK;

            if (hasWeekendWork) {
                // パターン1: 加工側に休出データあり（組付側より優先）
                checkCell.textContent = '休出';
                checkCell.setAttribute('data-regular-hours', 'false');
                updateWorkingDayStatus(dateIndex, lineIndex, true);
            } else if (hasAssemblyWeekendWork) {
                // パターン2: 組付側のみ休出データあり
                if (!hasAnyData) {
                    // 当月データがない場合は、組付の休出に合わせて休出として初期表示
                    checkCell.textContent = '休出';
                    checkCell.setAttribute('data-regular-hours', 'false');

                    updateWorkingDayStatus(dateIndex, lineIndex, true);

                    // 生産数を明示的に空にクリア（組付の休出に合わせた初期表示のため）
                    document.querySelectorAll(`.production-input[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`).forEach(input => {
                        input.value = '';
                    });
                } else {
                    // 当月データがある場合は、出庫数と在庫を表示（ユーザーが休出を消した状態）
                    checkCell.textContent = '';
                    checkCell.setAttribute('data-regular-hours', 'false');

                    // updateWorkingDayStatus関数を呼んで統一的に処理
                    // （出庫数がある場合は出庫数と在庫を表示するロジックが含まれる）
                    updateWorkingDayStatus(dateIndex, lineIndex, true);
                }
            } else {
                // パターン3: 休出データなし（すべて非表示）
                checkCell.textContent = '';
                checkCell.setAttribute('data-regular-hours', 'false');

                const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
                if (occupancyRateInput) {
                    occupancyRateInput.value = 0;
                    occupancyRateInput.style.display = 'none';
                }

                // 生産数を明示的に0にクリア（toggleInputsより前に実行）
                document.querySelectorAll(`.production-input[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`).forEach(input => {
                    input.value = 0;
                });

                toggleInputs(dateIndex, 'day', false, lineIndex);
                toggleInputs(dateIndex, 'night', false, lineIndex);
            }
        } else {
            // 平日の初期化処理
            if (isRegularHours) {
                checkCell.textContent = '定時';
                checkCell.setAttribute('data-regular-hours', 'true');
                updateWorkingDayStatus(dateIndex, lineIndex, true);
            }
        }
    });
}

/**
 * 稼働日状態を更新
 *
 * @param {number} dateIndex - 日付インデックス
 * @param {number} lineIndex - ラインインデックス
 * @param {boolean} isInitializing - 初期化フラグ
 *
 * 処理内容:
 * - 週末: 休出の有無に応じて入力フィールドを表示/非表示
 * - 平日: 定時の有無に応じて残業時間を制御
 * - 出庫数がある場合は在庫も表示
 */
function updateWorkingDayStatus(dateIndex, lineIndex = 0, isInitializing = false) {
    // 各ラインごとに独立したcheckCellを取得
    const checkCell = document.querySelector(`.check-cell[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
    if (!checkCell) return;

    const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
    const checkText = checkCell.textContent.trim();

    if (isWeekend) {
        // 週末の処理
        const isWorking = checkText === CELL_TEXT.WEEKEND_WORK;

        // 稼働率入力の表示制御（このラインのみ）
        const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
        if (occupancyRateInput) {
            if (!isWorking) {
                occupancyRateInput.value = 0;
            }
            occupancyRateInput.style.display = isWorking ? '' : 'none';
        }

        if (isWorking) {
            // 休出あり: すべての入力フィールドを表示（このラインのみ）
            toggleInputs(dateIndex, 'day', true, lineIndex);
            toggleInputs(dateIndex, 'night', false, lineIndex); // 夜勤は週末常に非表示

            // 休出の場合、初期化時以外は生産数を計算して在庫を再計算
            if (!isInitializing) {
                updateAllItemsProduction(dateIndex, ['day'], false, lineIndex);
                updateStockQuantities();
            } else {
                // 初期化時で、DBにデータがない場合は生産数をクリア
                const hadData = checkCell.getAttribute('data-has-weekend-work') === 'true';
                if (!hadData) {
                    document.querySelectorAll(`.production-input[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`).forEach(input => {
                        if (input.dataset.hasDbValue !== 'true') {
                            input.value = '';
                        }
                    });
                }
            }
        } else {
            // 休出なし: 出庫数と在庫のみ表示（このラインのみ）
            toggleInputs(dateIndex, 'day', false, lineIndex);
            toggleInputs(dateIndex, 'night', false, lineIndex);

            // 出庫数がある場合は出庫数と在庫を表示、ない場合は出庫数のみ表示
            const hasShipment = Array.from(
                document.querySelectorAll(`.shipment-display[data-shift="day"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`)
            ).some(display => parseInt(display.textContent || 0) > 0);

            document.querySelectorAll(`.shipment-display[data-shift="day"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`).forEach(display => {
                display.style.display = '';
            });

            if (hasShipment) {
                // 出庫数がある場合は在庫も表示
                document.querySelectorAll(`.stock-display[data-shift="day"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`).forEach(display => {
                    display.style.display = '';
                });
            }

            // 休出を消した場合、または初期化時で元々休出があった（削除済み）場合は生産数を0にクリア
            const hadData = checkCell.getAttribute('data-has-weekend-work') === 'true';
            if (!isInitializing || hadData) {
                document.querySelectorAll(`.production-input[data-shift="day"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`).forEach(input => {
                    input.value = '0';
                });

                if (!hasShipment) {
                    // 出庫数がない場合は在庫を0にクリア
                    document.querySelectorAll(`.stock-display[data-shift="day"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`).forEach(display => {
                        display.textContent = '0';
                    });
                }

                // 在庫を再計算（初期化時以外のみ）
                if (!isInitializing) {
                    updateStockQuantities();
                }
            }
        }

        // 残業計画の上限値を設定（休出は残業0）（このラインのみ）
        setOvertimeLimit(dateIndex, 'day', isWorking ? 0 : 0, lineIndex);
        setOvertimeLimit(dateIndex, 'night', isWorking ? 0 : 0, lineIndex);
    } else {
        // 平日の場合
        const isWorking = checkText === CELL_TEXT.REGULAR;

        if (isWorking) {
            // 定時をつける場合
            // 全テーブルの残業時間を0に設定
            const tables = domCache.tables || document.querySelectorAll('table[data-line-index]');

            tables.forEach((_table, lineIndex) => {
                const dayOvertimeInput = getInputElement(`.overtime-input[data-shift="day"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
                if (dayOvertimeInput) {
                    dayOvertimeInput.setAttribute('max', 0);
                    dayOvertimeInput.dataset.programmaticChange = 'true';
                    dayOvertimeInput.value = '0';
                    setTimeout(() => {
                        delete dayOvertimeInput.dataset.programmaticChange;
                    }, 0);
                }

                // 夜勤の残業上限を設定
                const nightOvertimeInput = getInputElement(`.overtime-input[data-shift="night"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
                if (nightOvertimeInput) {
                    nightOvertimeInput.setAttribute('max', OVERTIME_MAX_NIGHT);
                }
            });

            // 初期化時以外は日勤の生産数を処理
            if (!isInitializing) {
                // 全テーブルで生産数を再計算（残業0で）
                tables.forEach((_table, lineIndex) => {
                    // 定時時間で再計算（残業0）
                    updateAllItemsProduction(dateIndex, ['day'], true, lineIndex);
                });

                // 在庫を再計算
                debouncedUpdateStockQuantities();
            }
        } else {
            // 定時を消す場合：残業上限を元に戻すのみ（値は変更しない、再計算もしない）
            const tables = domCache.tables || document.querySelectorAll('table[data-line-index]');

            tables.forEach((_table, lineIndex) => {
                const dayOvertimeInput = getInputElement(`.overtime-input[data-shift="day"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
                if (dayOvertimeInput) {
                    dayOvertimeInput.removeAttribute('max');
                    dayOvertimeInput.setAttribute('max', OVERTIME_MAX_DAY);
                }

                const nightOvertimeInput = getInputElement(`.overtime-input[data-shift="night"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
                if (nightOvertimeInput) {
                    nightOvertimeInput.removeAttribute('max');
                    nightOvertimeInput.setAttribute('max', OVERTIME_MAX_NIGHT);
                }
            });

            // 定時を消す場合は再計算しない（値をそのまま維持）
        }
    }
}

// ========================================
// ライン・月選択変更処理
// ========================================
function handleLineChange() {
    const lineName = $('#line-select').val();
    const targetMonth = $('#target-month').val();
    if (lineName && targetMonth) {
        const [year, month] = targetMonth.split('-');
        window.location.href = `?line_name=${encodeURIComponent(lineName)}&year=${year}&month=${month}`;
    }
}

function handleMonthChange() {
    const lineName = $('#line-select').val();
    const targetMonth = $('#target-month').val();
    if (lineName && targetMonth) {
        const [year, month] = targetMonth.split('-');
        window.location.href = `?line_name=${encodeURIComponent(lineName)}&year=${year}&month=${month}`;
    }
}

// ========================================
// 保存機能
// ========================================
/**
 * 生産計画データを保存
 *
 * 処理の流れ:
 * 1. 全テーブルからデータを収集
 * 2. 削除対象の日付を特定
 * 3. サーバーにPOSTリクエスト送信
 * 4. 成功時にページをリロード
 */
function saveProductionPlan() {
    const saveBtn = document.getElementById('save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';

    const tables = document.querySelectorAll('table[data-line-index]');
    const linesData = []; // 全テーブルのデータを格納

    // 各テーブルごとにデータを収集
    tables.forEach((table, lineIndex) => {
        const itemNames = getItemNames(lineIndex);
        const datesData = [];
        const datesToDelete = [];

        // このテーブルの稼働率入力要素を取得（dateCountを決定）
        const occupancyRateInputs = table.querySelectorAll('.operation-rate-input');
        const dateCount = occupancyRateInputs.length;

        // このテーブルのcheckCellsを取得
        const checkCells = table.querySelectorAll('.check-cell');

        for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
            const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
            const checkCell = checkCells[dateIndex];
            const checkText = checkCell ? checkCell.textContent.trim() : '';
            const isWeekend = checkCell ? checkCell.getAttribute('data-weekend') === 'true' : false;
            const hadData = checkCell ? checkCell.getAttribute('data-has-weekend-work') === 'true' : false;
            const hasAssemblyWeekendWork = checkCell ? checkCell.getAttribute('data-has-assembly-weekend-work') === 'true' : false;

            // 週末で元々休出があったが、今は休出がない場合は削除対象
            // （組付側に休出があるかどうかに関わらず削除）
            if (isWeekend && hadData && checkText !== CELL_TEXT.WEEKEND_WORK) {
                datesToDelete.push(dateIndex);
                continue;
            }

            // 平日で元々データがあったが、今は定時でもない場合は削除対象
            // （定時チェックを外した場合）
            // ただし、稼働率が非表示でない場合のみ削除対象とする
            if (!isWeekend && hadData && checkText !== CELL_TEXT.REGULAR && occupancyRateInput && occupancyRateInput.style.display === 'none') {
                datesToDelete.push(dateIndex);
                continue;
            }

            // 組付側のみに休出がある場合（加工側に休出がない場合）は何も保存しない
            // （出庫数は組付けから自動計算されるため、加工側のDBに保存する必要はない）
            if (isWeekend && hasAssemblyWeekendWork && checkText !== '休出') {
                continue;
            }

            // 週末で休出がない場合はスキップ
            if (isWeekend && checkText !== CELL_TEXT.WEEKEND_WORK) {
                continue;
            }

            // 平日で稼働率入力が非表示の場合もスキップ
            if (!isWeekend && occupancyRateInput && occupancyRateInput.style.display === 'none') {
                continue;
            }

            // 平日で定時チェックがなく、かつ稼働率が入力されていない場合はスキップ
            if (!isWeekend && checkText !== CELL_TEXT.REGULAR && (!occupancyRateInput || occupancyRateInput.value === '')) {
                continue;
            }

            const occupancyRate = occupancyRateInput ? (parseFloat(occupancyRateInput.value) || 0) : 0;

            // 定時チェックの状態を取得
            const isRegularWorkingHours = checkCell ? checkCell.getAttribute('data-regular-hours') === 'true' : false;

            // シフトデータを構築
            const buildShiftData = (shift) => {
                const stopTimeInput = getInputElement(`.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
                const overtimeInput = getInputElement(`.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);

                const shiftData = {
                    stop_time: getInputValue(stopTimeInput),
                    overtime: getInputValue(overtimeInput),
                    items: {}
                };

                itemNames.forEach(itemName => {
                    const productionInput = getInputElement(
                        `.production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`
                    );
                    const shipmentInput = getInputElement(
                        `.shipment-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`
                    );
                    const stockDisplay = getInputElement(
                        `.stock-display[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`
                    );
                    const stockAdjustmentInput = getInputElement(
                        `.stock-adjustment-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`
                    );

                    // 週末の休出の場合は、非表示でも値を保存
                    if (isWeekend && checkText === CELL_TEXT.WEEKEND_WORK) {
                        const productionValue = productionInput ? (productionInput.value === '' ? 0 : parseInt(productionInput.value)) : 0;
                        const shipmentValue = shipmentInput ? (shipmentInput.value === '' ? 0 : parseInt(shipmentInput.value)) : 0;
                        const stockValue = stockDisplay ? (stockDisplay.textContent === '' ? 0 : parseInt(stockDisplay.textContent)) : 0;
                        const stockAdjustmentValue = stockAdjustmentInput ? (stockAdjustmentInput.value === '' ? 0 : parseInt(stockAdjustmentInput.value)) : 0;

                        shiftData.items[itemName] = {
                            production_quantity: productionValue,
                            stock: stockValue,
                            shipment: shipmentValue,
                            stock_adjustment: stockAdjustmentValue
                        };
                    } else if (productionInput || shipmentInput || stockDisplay) {
                        // 平日の場合は表示されている場合のみ保存
                        const productionValue = productionInput ? (productionInput.value === '' ? 0 : parseInt(productionInput.value)) : 0;
                        const shipmentValue = shipmentInput ? (shipmentInput.value === '' ? 0 : parseInt(shipmentInput.value)) : 0;
                        const stockValue = stockDisplay ? (stockDisplay.textContent === '' ? 0 : parseInt(stockDisplay.textContent)) : 0;
                        const stockAdjustmentValue = stockAdjustmentInput ? (stockAdjustmentInput.value === '' ? 0 : parseInt(stockAdjustmentInput.value)) : 0;

                        if (!isWeekend && productionInput && productionInput.style.display !== 'none') {
                            shiftData.items[itemName] = {
                                production_quantity: productionValue,
                                stock: stockValue,
                                shipment: shipmentValue,
                                stock_adjustment: stockAdjustmentValue
                            };
                        } else if (productionInput && productionInput.style.display !== 'none') {
                            shiftData.items[itemName] = {
                                production_quantity: productionValue,
                                stock: stockValue,
                                shipment: shipmentValue,
                                stock_adjustment: stockAdjustmentValue
                            };
                        }
                    }
                });

                return shiftData;
            };

            datesData.push({
                date_index: dateIndex,
                occupancy_rate: occupancyRate,
                regular_working_hours: isRegularWorkingHours,
                shifts: {
                    day: buildShiftData('day'),
                    night: buildShiftData('night')
                }
            });
        }

        // このテーブル（ライン）のデータを追加
        linesData.push({
            dates_data: datesData,
            dates_to_delete: datesToDelete
        });
    });

    // CSRFトークンを取得
    const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;
    const lineName = $('#line-select').val();
    const targetMonth = $('#target-month').val();
    const [year, month] = targetMonth.split('-');

    // 保存リクエスト送信
    fetch(`?line_name=${encodeURIComponent(lineName)}&year=${year}&month=${month}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken
        },
        body: JSON.stringify({
            lines_data: linesData
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                showToast('success', '保存が完了しました');
                location.reload();
            } else {
                showToast('error', '保存に失敗しました');
            }
        })
        .catch(() => {
            showToast('error', '保存中にエラーが発生しました');
        })
        .finally(() => {
            saveBtn.disabled = false;
            saveBtn.textContent = '保存';
        });
}

// ========================================
// 生産数から残業時間を逆算
// ========================================
function recalculateOvertimeFromProduction(dateIndex, shift, _itemName, lineIndex) {
    lineIndex = lineIndex || 0;

    const itemData = linesItemData[lineIndex] || {};
    const tact = itemData.tact || 0;
    if (tact === 0) return true;

    const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
    if (!occupancyRateInput || occupancyRateInput.style.display === 'none') return true;
    const occupancyRate = (parseFloat(occupancyRateInput.value) || 0) / 100;
    if (occupancyRate === 0) return true;

    // 残業入力（定時・休出時は非表示のため、存在確認は後で行う）
    const overtimeInput = getInputElement(`.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);

    const stopTimeInput = getInputElement(`.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
    const stopTime = getInputValue(stopTimeInput);
    const regularTime = shift === 'day' ? REGULAR_TIME_DAY : REGULAR_TIME_NIGHT;

    // 全品番の生産数を合計
    const itemNames = getItemNames(lineIndex);
    let totalProduction = 0;
    itemNames.forEach(name => {
        const productionInput = getInputElement(`.production-input[data-shift="${shift}"][data-item="${name}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
        if (productionInput && productionInput.style.display !== 'none') {
            totalProduction += parseInt(productionInput.value) || 0;
        }
    });

    if (totalProduction === 0) {
        if (overtimeInput) overtimeInput.value = 0;
        return true;
    }

    // 定時間で生産できる台数を計算
    const regularProductionTime = regularTime - stopTime;
    const regularTotalProduction = regularProductionTime > 0
        ? Math.ceil(regularProductionTime / tact * occupancyRate)
        : 0;

    // 残業で必要な追加生産数
    const additionalProduction = totalProduction - regularTotalProduction;

    // チェックセル取得（各ラインごとに独立）
    const checkCell = document.querySelector(`.check-cell[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
    const date = checkCell?.getAttribute('data-date') || '';
    const shiftName = shift === 'day' ? '日勤' : '夜勤';

    // 日勤のみ：定時ONまたは休出の場合は残業不可
    if (shift === 'day') {
        const isRegularHours = checkCell && checkCell.getAttribute('data-regular-hours') === 'true';
        const checkText = checkCell ? checkCell.textContent.trim() : '';
        const isHolidayWork = checkText === '休出';

        if (isRegularHours || isHolidayWork) {
            if (additionalProduction > 0) {
                const mode = isRegularHours ? '定時' : '休出';
                showToast('error', `${date} 日勤：${mode}の場合は残業できません。生産数合計を${regularTotalProduction}以下にしてください。`);
                return false;
            }
            // 定時内に収まっている場合は正常終了
            return true;
        }
    }

    // 定時・休出でない場合のみ残業入力の存在を確認
    if (!overtimeInput || overtimeInput.style.display === 'none') return true;

    if (additionalProduction <= 0) {
        overtimeInput.value = 0;
        return true;
    }

    // 残業時間を逆算
    let calculatedOvertime = (additionalProduction * tact) / occupancyRate;
    calculatedOvertime = Math.max(0, calculatedOvertime);

    const maxOvertime = shift === 'day' ? OVERTIME_MAX_DAY : OVERTIME_MAX_NIGHT;

    // 残業上限を超える場合（通常時の残業上限チェック）
    if (calculatedOvertime > maxOvertime) {
        showToast('error', `${date} ${shiftName}：残業時間が上限（${maxOvertime}分）に達しています。生産数合計を${regularTotalProduction + Math.floor(maxOvertime * occupancyRate / tact)}以下にしてください。`);
        return false;
    }

    // 残業時間を丸め単位で切り上げ
    calculatedOvertime = Math.ceil(calculatedOvertime / OVERTIME_ROUND_MINUTES) * OVERTIME_ROUND_MINUTES;
    overtimeInput.value = calculatedOvertime;
    return true;
}

// ========================================
// イベントリスナー設定
// ========================================
function setupEventListeners() {
    // 残業時間と停止時間の変更時に生産数を再計算
    document.querySelectorAll('.overtime-input, .stop-time-input').forEach(input => {
        input.addEventListener('input', function () {
            // プログラマティックな変更の場合はスキップ
            if (this.dataset.programmaticChange === 'true') {
                return;
            }

            const dateIndex = parseInt(this.getAttribute('data-date-index'));
            const shift = this.getAttribute('data-shift');
            const lineIndex = parseInt(this.getAttribute('data-line-index')) || 0;

            updateAllItemsProduction(dateIndex, [shift], true, lineIndex);
            debouncedUpdateRowTotals();
            debouncedUpdateStockQuantities();
        });
    });

    // 稼働率の変更時に生産数を再計算
    document.querySelectorAll('.operation-rate-input').forEach(input => {
        input.addEventListener('input', function () {
            const dateIndex = parseInt(this.getAttribute('data-date-index'));
            const lineIndex = parseInt(this.getAttribute('data-line-index')) || 0;
            updateAllItemsProduction(dateIndex, ['day', 'night'], true, lineIndex);
            debouncedUpdateRowTotals();
            debouncedUpdateStockQuantities();
        });
    });

    // 生産数の変更時に合計を更新し、残業時間を逆算
    let isRecalculating = false;

    document.querySelectorAll('.production-input').forEach(input => {
        let previousValue = input.value;

        input.addEventListener('focus', function () {
            previousValue = this.value;
        });

        input.addEventListener('input', function () {
            if (isRecalculating) return;

            const dateIndex = parseInt(this.getAttribute('data-date-index'));
            const shift = this.getAttribute('data-shift');
            const itemName = this.getAttribute('data-item');
            const lineIndex = parseInt(this.getAttribute('data-line-index')) || 0;

            isRecalculating = true;

            // 生産数が変更されたので、新しい比率を保存
            saveProductionRatios(lineIndex, dateIndex, shift);

            // 残業時間の逆算と上限チェック（定時・休出時の上限チェックも含む）
            const isValid = recalculateOvertimeFromProduction(dateIndex, shift, itemName, lineIndex);
            if (!isValid) {
                this.value = previousValue;
                // 元の値に戻したので、比率も再保存
                saveProductionRatios(lineIndex, dateIndex, shift);
                isRecalculating = false;
                return;
            } else {
                previousValue = this.value;
            }

            debouncedUpdateRowTotals();
            debouncedUpdateStockQuantities();

            isRecalculating = false;
        });
    });

    // 出庫数は読み取り専用（表示のみ）なのでイベントリスナー不要

    // 在庫数調整の変更時に在庫を再計算し、全テーブルに同期
    document.querySelectorAll('.stock-adjustment-input').forEach(input => {
        input.addEventListener('input', function () {
            const dateIndex = parseInt(this.getAttribute('data-date-index'));
            const shift = this.getAttribute('data-shift');
            const itemName = this.getAttribute('data-item');
            const lineIndex = parseInt(this.getAttribute('data-line-index')) || 0;
            const value = this.value;

            // 全テーブルの同じ品番・日付・直の在庫数調整に同じ値を設定
            document.querySelectorAll(`.stock-adjustment-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`).forEach(targetInput => {
                const targetLineIndex = parseInt(targetInput.getAttribute('data-line-index')) || 0;
                if (targetLineIndex !== lineIndex) {
                    targetInput.value = value;
                }
            });

            // 在庫を再計算
            debouncedUpdateStockQuantities();
        });
    });
}

// ========================================
// カラムホバー処理
// ========================================
/**
 * カラムホバー機能を設定（日付ヘッダーのみハイライト）
 */
function setupColumnHover() {
    const tbody = document.querySelector('tbody');
    if (!tbody) return;

    let currentHoverDateIndex = -1;

    tbody.addEventListener('mouseover', function (e) {
        const cell = e.target.closest('td, th');
        if (!cell || cell.tagName !== 'TD') return;

        const dateIndex = cell.getAttribute('data-date-index');
        if (dateIndex === null) return;

        const dateIndexNum = parseInt(dateIndex);
        if (dateIndexNum === currentHoverDateIndex) return;

        if (currentHoverDateIndex >= 0) {
            removeDateHighlight(currentHoverDateIndex);
        }

        currentHoverDateIndex = dateIndexNum;
        addDateHighlight(dateIndexNum);
    });

    tbody.addEventListener('mouseout', function (e) {
        if (!e.relatedTarget || !tbody.contains(e.relatedTarget)) {
            if (currentHoverDateIndex >= 0) {
                removeDateHighlight(currentHoverDateIndex);
                currentHoverDateIndex = -1;
            }
        }
    });
}

/**
 * 日付ヘッダーにハイライトを追加
 */
function addDateHighlight(dateIndex) {
    // 日付行のセルのみ（2行目：日付の行）
    const dateRow = document.querySelector('thead tr:nth-child(2)');
    if (dateRow) {
        const dateCell = dateRow.querySelector(`th[data-date-index="${dateIndex}"]`);
        if (dateCell) {
            dateCell.classList.add('date-hover');
        }
    }
}

/**
 * 日付ヘッダーからハイライトを削除
 */
function removeDateHighlight(dateIndex) {
    // 日付行のセルのみ（2行目：日付の行）
    const dateRow = document.querySelector('thead tr:nth-child(2)');
    if (dateRow) {
        const dateCell = dateRow.querySelector(`th[data-date-index="${dateIndex}"]`);
        if (dateCell) {
            dateCell.classList.remove('date-hover');
        }
    }
}

// ========================================
// 残業input表示制御
// ========================================
/**
 * 残業inputの表示/非表示を更新
 * - 休出: 日勤・夜勤とも非表示
 * - 定時: 日勤のみ非表示
 * - 土日（休出なし）: 日勤・夜勤とも非表示
 * - 通常: すべて表示
 */
function updateOvertimeInputVisibility() {
    const checkCells = document.querySelectorAll('.check-cell');

    checkCells.forEach((checkCell) => {
        const dateIndex = parseInt(checkCell.getAttribute('data-date-index'));
        const checkText = checkCell.textContent.trim();
        const isHolidayWork = checkText === CELL_TEXT.WEEKEND_WORK;
        const isRegularTime = checkText === CELL_TEXT.REGULAR;
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';

        const dayOvertimeInputs = document.querySelectorAll(
            `.overtime-input[data-shift="day"][data-date-index="${dateIndex}"]`
        );
        const nightOvertimeInputs = document.querySelectorAll(
            `.overtime-input[data-shift="night"][data-date-index="${dateIndex}"]`
        );
        const dayStopTimeInputs = document.querySelectorAll(
            `.stop-time-input[data-shift="day"][data-date-index="${dateIndex}"]`
        );
        const nightStopTimeInputs = document.querySelectorAll(
            `.stop-time-input[data-shift="night"][data-date-index="${dateIndex}"]`
        );

        if (isWeekend && !isHolidayWork) {
            // 土日（休出なし）: 両方非表示
            dayOvertimeInputs.forEach(input => {
                input.style.display = 'none';
                input.value = 0;
            });
            nightOvertimeInputs.forEach(input => {
                input.style.display = 'none';
                input.value = 0;
            });
            dayStopTimeInputs.forEach(input => {
                input.style.display = 'none';
                input.value = 0;
            });
            nightStopTimeInputs.forEach(input => {
                input.style.display = 'none';
                input.value = 0;
            });
        } else if (isHolidayWork) {
            // 休出: 残業は非表示、計画停止は表示
            dayOvertimeInputs.forEach(input => {
                input.style.display = 'none';
                input.value = 0;
            });
            nightOvertimeInputs.forEach(input => {
                input.style.display = 'none';
                input.value = 0;
            });
            dayStopTimeInputs.forEach(input => {
                input.style.display = '';
            });
            nightStopTimeInputs.forEach(input => {
                input.style.display = '';
            });
        } else if (isRegularTime) {
            // 定時: 日勤の残業のみ非表示、計画停止は表示
            dayOvertimeInputs.forEach(input => {
                input.style.display = 'none';
                input.value = 0;
            });
            nightOvertimeInputs.forEach(input => {
                input.style.display = '';
            });
            dayStopTimeInputs.forEach(input => {
                input.style.display = '';
            });
            nightStopTimeInputs.forEach(input => {
                input.style.display = '';
            });
        } else {
            // 通常: すべて表示
            dayOvertimeInputs.forEach(input => {
                input.style.display = '';
            });
            nightOvertimeInputs.forEach(input => {
                input.style.display = '';
            });
            dayStopTimeInputs.forEach(input => {
                input.style.display = '';
            });
            nightStopTimeInputs.forEach(input => {
                input.style.display = '';
            });
        }
    });
}

// ========================================
// 非同期計算（パフォーマンス最適化）
// ========================================
// 重い計算を非同期で実行
function asyncUpdateRowTotals() {
    return new Promise((resolve) => {
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(() => {
                updateRowTotals();
                resolve();
            });
        } else {
            setTimeout(() => {
                updateRowTotals();
                resolve();
            }, 0);
        }
    });
}

function asyncUpdateStockQuantities() {
    return new Promise((resolve) => {
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(() => {
                updateStockQuantities();
                resolve();
            });
        } else {
            setTimeout(() => {
                updateStockQuantities();
                resolve();
            }, 0);
        }
    });
}

// 初期計算を段階的に実行
async function performInitialCalculations() {
    // 在庫数の元のDB値をdata-db-stock-base属性に保存
    document.querySelectorAll('.stock-display').forEach(display => {
        if (display.dataset.hasDbValue === 'true') {
            display.dataset.dbStockBase = display.textContent;
        } else {
            display.dataset.dbStockBase = '0';
        }
    });

    // 初期表示時にすべての生産数を設定
    // - 通常ライン: 出庫数を夜勤・日勤の上限を考慮して割り振る
    // - コンロッドライン: この時点では何もしない（後で残業時間から計算）
    updateAllProductionQuantities();

    // 通常ラインの出庫数を夜勤と日勤に割り振る（残業上限を考慮）
    allocateShipmentToProduction();

    // 月計を更新（生産数・出庫数の月計のみ。在庫数の月計は在庫計算後に更新）
    updateRowTotals();

    // 生産数設定後に比率を保存
    const tables = domCache.tables || document.querySelectorAll('table[data-line-index]');
    const dateCount = domCache.dateCount || document.querySelectorAll('.operation-rate-input[data-line-index="0"]').length;

    tables.forEach((_table, lineIndex) => {
        const lineName = _table?.getAttribute('data-line-name');

        // コンロッドラインの場合、出庫数の比率から残業時間に応じた生産数を計算
        // 処理の流れ：
        // 1. 出庫数（3倍済み）から各品番の比率を算出
        // 2. (定時間+残業時間)/タクト*稼働率 で生産可能台数を算出
        // 3. 生産可能台数を比率で配分して各品番の生産数を設定
        if (lineName && lineName.includes('コンロッド')) {
            for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
                ['day', 'night'].forEach(shift => {
                    // 生産数がDBに保存されていない場合のみ計算
                    const itemNames = getItemNames(lineIndex);
                    const hasAnyDbValue = itemNames.some(name => {
                        const input = getCachedInput('production', lineIndex, dateIndex, shift, name);
                        return input && input.dataset.hasDbValue === 'true';
                    });

                    // DBにデータがない場合のみ計算を実行
                    if (!hasAnyDbValue) {
                        calculateConrodProductionByRatio(lineIndex, dateIndex, shift);
                    }
                });
            }
        }

        // 全ラインの比率を保存（コンロッドは計算後の生産数から比率を保存）
        for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
            ['day', 'night'].forEach(shift => {
                saveProductionRatios(lineIndex, dateIndex, shift);
            });
        }
    });

    // 残業時間の初期値を計算（データがない場合のみ）
    calculateInitialOvertimes();

    // 在庫数を非同期で計算
    await asyncUpdateStockQuantities();

    // 在庫数計算後に在庫数の月計を更新
    updateRowTotals();
}

// シフトの合計生産数を取得
function getTotalProductionForShift(lineIndex, dateIndex, shift) {
    const itemNames = getItemNames(lineIndex);
    let total = 0;

    itemNames.forEach(itemName => {
        const productionInput = getCachedInput('production', lineIndex, dateIndex, shift, itemName) ||
            getInputElement(`.production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);

        if (productionInput && productionInput.style.display !== 'none') {
            total += parseInt(productionInput.value) || 0;
        }
    });

    return total;
}

// 生産数から必要な残業時間を逆算
function calculateRequiredOvertime(totalProduction, tact, occupancyRate, stopTime, shift, dateIndex, lineIndex) {
    const regularTime = shift === 'day' ? REGULAR_TIME_DAY : REGULAR_TIME_NIGHT;
    const regularProductionTime = regularTime - stopTime;

    // 定時間で生産できる台数
    const regularTotalProduction = regularProductionTime > 0
        ? Math.ceil(regularProductionTime / tact * occupancyRate)
        : 0;

    // 残業で必要な追加生産数
    const additionalProduction = totalProduction - regularTotalProduction;

    if (additionalProduction <= 0) {
        return 0;
    }

    // チェックセル取得（土日・定時判定用）
    const checkCell = document.querySelector(`.check-cell[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
    const isWeekend = checkCell?.getAttribute('data-weekend') === 'true';
    const isHolidayWork = checkCell?.textContent.trim() === '休出';
    const isRegularHours = checkCell?.getAttribute('data-regular-hours') === 'true';

    // 土日で休出でない場合、または日勤で定時チェックがある場合、または土日の休出の場合は残業0
    if ((isWeekend && !isHolidayWork) || (shift === 'day' && isRegularHours) || (isWeekend && isHolidayWork)) {
        return 0;
    }

    // 残業時間を逆算
    let calculatedOvertime = (additionalProduction * tact) / occupancyRate;
    calculatedOvertime = Math.max(0, calculatedOvertime);

    // 残業時間を丸め単位で切り上げ
    calculatedOvertime = Math.ceil(calculatedOvertime / OVERTIME_ROUND_MINUTES) * OVERTIME_ROUND_MINUTES;

    // 上限チェック
    const maxOvertime = shift === 'day' ? OVERTIME_MAX_DAY : OVERTIME_MAX_NIGHT;
    return Math.min(calculatedOvertime, maxOvertime);
}

// 残業時間の初期値を計算（生産数から逆算）
function calculateInitialOvertimes() {
    const tables = domCache.tables || document.querySelectorAll('table[data-line-index]');
    const dateCount = domCache.dateCount || document.querySelectorAll('.operation-rate-input[data-line-index="0"]').length;

    tables.forEach((_table, lineIndex) => {
        for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
            ['day', 'night'].forEach(shift => {
                const overtimeInput = getCachedInput('overtime', lineIndex, dateIndex, shift) ||
                    getInputElement(`.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);

                // DBにデータがある場合はスキップ
                if (!overtimeInput || overtimeInput.style.display === 'none' ||
                    overtimeInput.dataset.hasDbValue === 'true') {
                    return;
                }

                // 生産数の合計を取得
                const totalProduction = getTotalProductionForShift(lineIndex, dateIndex, shift);
                if (totalProduction === 0) {
                    overtimeInput.value = 0;
                    return;
                }

                // タクトと稼働率を取得
                const itemData = linesItemData[lineIndex] || {};
                const tact = itemData.tact || 0;
                if (tact === 0) return;

                const occupancyRateInput = getCachedInput('operationRate', lineIndex, dateIndex) ||
                    getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
                const occupancyRate = occupancyRateInput ? (parseFloat(occupancyRateInput.value) || 0) / 100 : 0;
                if (occupancyRate === 0) return;

                // 停止時間を取得
                const stopTimeInput = getCachedInput('stopTime', lineIndex, dateIndex, shift) ||
                    getInputElement(`.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
                const stopTime = getInputValue(stopTimeInput);

                // 残業時間を計算
                const calculatedOvertime = calculateRequiredOvertime(totalProduction, tact, occupancyRate, stopTime, shift, dateIndex, lineIndex);

                // プログラマティックな変更を示すフラグを設定（inputイベントを抑制）
                overtimeInput.dataset.programmaticChange = 'true';
                overtimeInput.value = calculatedOvertime;
                setTimeout(() => delete overtimeInput.dataset.programmaticChange, 0);
            });
        }
    });
}

// ========================================
// 出庫数関連の機能は削除（出庫数は読み取り専用）
// ========================================
// 以前は出庫数の自動調整と入力制御があったが、
// 出庫数はバックエンドから計算された値を表示するのみになったため削除

// ========================================
// 初期化処理
// ========================================
$(document).ready(async function () {
    // ========================================
    // ステップ1: 基本UIの初期化
    // ========================================
    // Select2の初期化
    $('#line-select').select2({
        theme: 'bootstrap-5',
        width: 'resolve'
    });

    // イベントリスナー設定
    $('#line-select').on('change', handleLineChange);
    $('#target-month').on('change', handleMonthChange);
    $('#save-btn').on('click', saveProductionPlan);

    // ========================================
    // ステップ2: DOMキャッシュの構築
    // ========================================
    buildDOMCache();

    // 入力要素のキャッシュを構築（パフォーマンス最適化）
    buildInputCache();

    // ========================================
    // ステップ3: 即座に表示が必要な初期化処理
    // ========================================
    // 週末の休出状態を初期化
    initializeWeekendWorkingStatus();

    // 残業input表示制御を初期化
    updateOvertimeInputVisibility();

    // 出庫数は読み取り専用なので入力制御不要

    // ========================================
    // ステップ4: 初期計算（イベントリスナー設定前に実行）
    // ========================================
    await performInitialCalculations();

    // ========================================
    // ステップ5: イベントリスナーとインタラクション
    // ========================================
    // イベントリスナーを設定（初期計算後に設定することで、初期値設定時のイベント発火を防ぐ）
    setupEventListeners();

    // カラムホバーを設定
    setupColumnHover();

    // ========================================
    // ステップ6: ページ初期化完了
    // ========================================
    // ローディング非表示
    if (typeof hideLoading === 'function') {
        hideLoading();
    }
});
