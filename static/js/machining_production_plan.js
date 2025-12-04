// ========================================
// 加工生産計画JavaScript
// ========================================
// このファイルは加工ラインの生産計画管理を担当します
// 主な機能:
// - 複数テーブル（組付けライン別）の生産数・在庫計算
// - 同じ加工ライン名での在庫共有
// - 生産数比率の保存と自動計算
// - 良品率を考慮した在庫計算
// - 出庫数の自動調整（複数テーブル間で合計維持）
//
// 重要な設計方針:
// - 出庫数はバックエンドで組付けの生産数から毎回計算される（DBには保存されない）
// - フロントエンドでは出庫数は表示・編集可能だが、保存時はサーバーで再計算される
// - 複数テーブルに存在する品番の出庫数を変更すると、他のテーブルの値を自動調整して合計を維持
// - 1つのテーブルにしかない品番の出庫数は編集不可（readonly）
// - 在庫数もフロントエンドで毎回計算される（翌月の前月末在庫として使用するため保存される）
//
// パフォーマンス最適化:
// - DOM要素のキャッシュシステム（O(1)アクセス）
// - デバウンス関数による再計算の抑制
// - 非同期計算によるUI応答性の向上
// - forループ化による関数呼び出しオーバーヘッドの削減
//
// ========================================
// 定数
// ========================================
const REGULAR_TIME_DAY = 455;      // 加工の日勤定時時間（分）
const REGULAR_TIME_NIGHT = 450;    // 加工の夜勤定時時間（分）
const OVERTIME_MAX_DAY = 120;      // 日勤の残業上限（分）
const OVERTIME_MAX_NIGHT = 60;     // 夜勤の残業上限（分）

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
                    const prodKey = `${lineIndex}-${dateIndex}-${shift}-${itemName}`;
                    const prodInput = document.querySelector(
                        `.production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`
                    );
                    if (prodInput) {
                        if (!inputCache.production[lineIndex]) inputCache.production[lineIndex] = {};
                        if (!inputCache.production[lineIndex][dateIndex]) inputCache.production[lineIndex][dateIndex] = {};
                        if (!inputCache.production[lineIndex][dateIndex][shift]) inputCache.production[lineIndex][dateIndex][shift] = {};
                        inputCache.production[lineIndex][dateIndex][shift][itemName] = prodInput;
                    }

                    // 出庫数入力
                    const shipInput = document.querySelector(
                        `.shipment-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`
                    );
                    if (shipInput) {
                        if (!inputCache.shipment[lineIndex]) inputCache.shipment[lineIndex] = {};
                        if (!inputCache.shipment[lineIndex][dateIndex]) inputCache.shipment[lineIndex][dateIndex] = {};
                        if (!inputCache.shipment[lineIndex][dateIndex][shift]) inputCache.shipment[lineIndex][dateIndex][shift] = {};
                        inputCache.shipment[lineIndex][dateIndex][shift][itemName] = shipInput;
                    }

                    // 在庫数入力
                    const stockInput = document.querySelector(
                        `.stock-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`
                    );
                    if (stockInput) {
                        if (!inputCache.stock[lineIndex]) inputCache.stock[lineIndex] = {};
                        if (!inputCache.stock[lineIndex][dateIndex]) inputCache.stock[lineIndex][dateIndex] = {};
                        if (!inputCache.stock[lineIndex][dateIndex][shift]) inputCache.stock[lineIndex][dateIndex][shift] = {};
                        inputCache.stock[lineIndex][dateIndex][shift][itemName] = stockInput;
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
    const table = tables[lineIndex];
    const lineName = table?.getAttribute('data-line-name');

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
        const shipmentInput = getCachedInput('shipment', lineIndex, dateIndex, shift, name) ||
            getInputElement(`.shipment-input[data-shift="${shift}"][data-item="${name}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);

        const shipmentValue = shipmentInput ? (parseInt(shipmentInput.value) || 0) : 0;
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
        const table = tables[lineIndex];
        const lineName = table?.getAttribute('data-line-name');

        // コンロッドラインの場合は出庫数をコピーせず、後でperformInitialCalculationsで計算する
        if (lineName && lineName.includes('コンロッド')) {
            // ここでは何もしない（値を設定しない）
            return;
        }

        // 通常ライン：出庫数をコピー
        const shipmentInput = getCachedInput('shipment', lineIndex, dateIndex, shift, itemName) ||
            getInputElement(`.shipment-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);

        if (shipmentInput && shipmentInput.value !== '') {
            const shipmentValue = parseInt(shipmentInput.value) || 0;
            if (shipmentValue > 0) {
                productionInput.value = shipmentValue;
                return;
            }
        }

        // 出庫数がない場合は生産数を0にする
        productionInput.value = 0;
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

    tables.forEach((table, lineIndex) => {
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

// ========================================
// 合計値・在庫計算機能
// ========================================
// セクションごとの合計を計算
function calculateSectionTotal(rows, inputClass) {
    rows.forEach(row => {
        let total = 0;
        row.querySelectorAll(`.${inputClass}`).forEach(input => {
            if (input.style.display !== 'none') {
                total += parseInt(input.value) || 0;
            }
        });

        const lastCell = row.querySelector('td:last-child');
        setCellStyle(lastCell, total);
    });
}

// 日勤+夜勤の日別合計を計算（生産数と出庫数）
function updateDailyTotals() {
    const sections = ['production', 'shipment'];

    sections.forEach(section => {
        document.querySelectorAll(`[data-section="${section}"][data-shift="day"]`).forEach(dayRow => {
            const itemName = dayRow.getAttribute('data-item');
            if (!itemName) return;

            const nightRow = document.querySelector(`[data-section="${section}"][data-shift="night"][data-item="${itemName}"]`);
            if (!nightRow) return;

            const dayInputs = dayRow.querySelectorAll(`.${section === 'production' ? 'production-input' : 'shipment-input'}`);
            const nightInputs = nightRow.querySelectorAll(`.${section === 'production' ? 'production-input' : 'shipment-input'}`);

            let dailyTotal = 0;
            dayInputs.forEach((dayInput, index) => {
                if (dayInput.style.display !== 'none') {
                    const dayValue = parseInt(dayInput.value) || 0;
                    const nightValue = nightInputs[index] && nightInputs[index].style.display !== 'none'
                        ? (parseInt(nightInputs[index].value) || 0)
                        : 0;
                    dailyTotal += dayValue + nightValue;
                }
            });

            const dailyTotalCell = dayRow.querySelector('.daily-total');
            if (dailyTotalCell) {
                dailyTotalCell.textContent = dailyTotal > 0 ? dailyTotal : '';
                dailyTotalCell.style.fontWeight = 'bold';
                dailyTotalCell.style.textAlign = 'center';
                dailyTotalCell.style.backgroundColor = '#e0f2fe';
            }
        });
    });
}

// 在庫数を計算（前日在庫 + 生産数 - 出庫数）
// ★重要:
// - 同じ直内では全テーブルで同じ在庫を表示（在庫共有）
// - DBから在庫値は読み込まず、常にフロントエンドで計算
// - 保存時にDBに保存し、翌月の前月末在庫として使用
function updateStockQuantities() {
    const itemNames = getAllItemNames();
    const tables = domCache.tables || document.querySelectorAll('table[data-line-index]');
    const dateCount = domCache.dateCount || document.querySelectorAll('.operation-rate-input[data-line-index="0"]').length;

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
                let hasVisibleStock = false;

                for (let lineIndex = 0; lineIndex < tables.length; lineIndex++) {
                    // このテーブルの良品率を取得
                    const itemData = linesItemData[lineIndex] || {};
                    const yieldRate = itemData.yield_rate || 1.0;

                    const dayProductionInput = getCachedInput('production', lineIndex, dateIndex, 'day', itemName) ||
                        getInputElement(`.production-input[data-line-index="${lineIndex}"][data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
                    const dayShipmentInput = getCachedInput('shipment', lineIndex, dateIndex, 'day', itemName) ||
                        getInputElement(`.shipment-input[data-line-index="${lineIndex}"][data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
                    const dayStockInput = getCachedInput('stock', lineIndex, dateIndex, 'day', itemName) ||
                        getInputElement(`.stock-input[data-line-index="${lineIndex}"][data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);

                    // 表示されているセルのみ計算対象
                    if (dayStockInput && dayStockInput.style.display !== 'none') {
                        hasVisibleStock = true;
                        const dayProduction = dayProductionInput ? (parseInt(dayProductionInput.value) || 0) : 0;
                        const dayShipment = dayShipmentInput ? (parseInt(dayShipmentInput.value) || 0) : 0;

                        // 良品率を適用して合計
                        totalGoodProduction += dayProduction * yieldRate;
                        totalShipment += dayShipment;
                    }
                }

                // 在庫を計算（小数累積）
                if (hasVisibleStock) {
                    calculatedStock = calculatedStock + totalGoodProduction - totalShipment;
                    const stockValue = Math.floor(calculatedStock);

                    // 全テーブルに同じ在庫を設定
                    for (let lineIndex = 0; lineIndex < tables.length; lineIndex++) {
                        const dayStockInput = getCachedInput('stock', lineIndex, dateIndex, 'day', itemName) ||
                            getInputElement(`.stock-input[data-line-index="${lineIndex}"][data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
                        if (dayStockInput && dayStockInput.style.display !== 'none') {
                            dayStockInput.value = stockValue;
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
                let hasVisibleStock = false;

                for (let lineIndex = 0; lineIndex < tables.length; lineIndex++) {
                    // このテーブルの良品率を取得
                    const itemData = linesItemData[lineIndex] || {};
                    const yieldRate = itemData.yield_rate || 1.0;

                    const nightProductionInput = getCachedInput('production', lineIndex, dateIndex, 'night', itemName) ||
                        getInputElement(`.production-input[data-line-index="${lineIndex}"][data-shift="night"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
                    const nightShipmentInput = getCachedInput('shipment', lineIndex, dateIndex, 'night', itemName) ||
                        getInputElement(`.shipment-input[data-line-index="${lineIndex}"][data-shift="night"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
                    const nightStockInput = getCachedInput('stock', lineIndex, dateIndex, 'night', itemName) ||
                        getInputElement(`.stock-input[data-line-index="${lineIndex}"][data-shift="night"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);

                    // 表示されているセルのみ計算対象
                    if (nightStockInput && nightStockInput.style.display !== 'none') {
                        hasVisibleStock = true;
                        const nightProduction = nightProductionInput ? (parseInt(nightProductionInput.value) || 0) : 0;
                        const nightShipment = nightShipmentInput ? (parseInt(nightShipmentInput.value) || 0) : 0;

                        // 良品率を適用して合計
                        totalGoodProduction += nightProduction * yieldRate;
                        totalShipment += nightShipment;
                    }
                }

                // 在庫を計算（小数累積）
                if (hasVisibleStock) {
                    calculatedStock = calculatedStock + totalGoodProduction - totalShipment;
                    const stockValue = Math.floor(calculatedStock);

                    // 全テーブルに同じ在庫を設定
                    for (let lineIndex = 0; lineIndex < tables.length; lineIndex++) {
                        const nightStockInput = getCachedInput('stock', lineIndex, dateIndex, 'night', itemName) ||
                            getInputElement(`.stock-input[data-line-index="${lineIndex}"][data-shift="night"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
                        if (nightStockInput && nightStockInput.style.display !== 'none') {
                            nightStockInput.value = stockValue;
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
const debouncedUpdateRowTotals = debounce(updateRowTotals, 100);
const debouncedUpdateStockQuantities = debounce(updateStockQuantities, 150);

// 行の合計値を計算して表示
function updateRowTotals() {
    // 出庫数の日勤月間合計
    document.querySelectorAll('[data-section="shipment"][data-shift="day"]').forEach(row => {
        const itemName = row.getAttribute('data-item');
        if (!itemName) return;

        let total = 0;
        row.querySelectorAll('.shipment-input').forEach(input => {
            if (input.style.display !== 'none') {
                total += parseInt(input.value) || 0;
            }
        });

        const monthlyTotalCell = row.querySelector('.monthly-total');
        setCellStyle(monthlyTotalCell, total);
    });

    // 出庫数の夜勤月間合計
    calculateSectionTotal(
        document.querySelectorAll('[data-section="shipment"][data-shift="night"]'),
        'shipment-input'
    );

    // 生産数の日勤月間合計
    document.querySelectorAll('[data-section="production"][data-shift="day"]').forEach(row => {
        const itemName = row.getAttribute('data-item');
        if (!itemName) return;

        let total = 0;
        row.querySelectorAll('.production-input').forEach(input => {
            if (input.style.display !== 'none') {
                total += parseInt(input.value) || 0;
            }
        });

        const monthlyTotalCell = row.querySelector('.monthly-total');
        setCellStyle(monthlyTotalCell, total);
    });

    // 生産数の夜勤月間合計
    calculateSectionTotal(
        document.querySelectorAll('[data-section="production"][data-shift="night"]'),
        'production-input'
    );

    // 在庫数の日勤月間合計
    document.querySelectorAll('[data-section="stock"][data-shift="day"]').forEach(row => {
        const itemName = row.getAttribute('data-item');
        if (!itemName) return;

        let total = 0;
        row.querySelectorAll('.stock-input').forEach(input => {
            if (input.style.display !== 'none') {
                total += parseInt(input.value) || 0;
            }
        });

        const monthlyTotalCell = row.querySelector('.monthly-total');
        setCellStyle(monthlyTotalCell, total);
    });

    // 在庫数の夜勤月間合計
    calculateSectionTotal(
        document.querySelectorAll('[data-section="stock"][data-shift="night"]'),
        'stock-input'
    );

    // 残業計画の合計
    calculateSectionTotal(
        document.querySelectorAll('[data-section="overtime"]'),
        'overtime-input'
    );

    // 計画停止の合計
    calculateSectionTotal(
        document.querySelectorAll('[data-section="stop_time"]'),
        'stop-time-input'
    );

    // 日勤+夜勤の合計
    updateDailyTotals();

    // 在庫差分を更新
    updateStockDifferences();
}

// ========================================
// 定時・休出チェック機能
// ========================================
const debouncedUpdateWorkingDayStatus = debounce(function (dateIndex, lineIndex) {
    updateWorkingDayStatus(dateIndex, lineIndex);
}, 100);

function toggleCheck(element) {
    const isWeekend = element.getAttribute('data-weekend') === 'true';
    const hasAssemblyWeekendWork = element.getAttribute('data-has-assembly-weekend-work') === 'true';
    const hasWeekendWork = element.getAttribute('data-has-weekend-work') === 'true';
    const currentText = element.textContent.trim();

    // トグル制御ロジック:
    // - 組付側のみに休出がある場合（加工側に初期データがない）はトグル不可
    // - 加工側に休出データがある場合は常にトグル可能
    if (hasAssemblyWeekendWork && !hasWeekendWork && currentText !== '休出') {
        return;
    }

    const newText = currentText === '' ? (isWeekend ? '休出' : '定時') : '';
    element.textContent = newText;

    // data-regular-hours属性を更新
    element.setAttribute('data-regular-hours', newText === '定時' ? 'true' : 'false');

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
    selector += ' input';

    document.querySelectorAll(selector).forEach(input => {
        // 残業inputは除外（別途制御）
        if (input.classList.contains('overtime-input')) {
            return;
        }
        input.style.display = show ? '' : 'none';
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
    document.querySelectorAll('.check-cell').forEach((checkCell) => {
        const dateIndex = parseInt(checkCell.getAttribute('data-date-index'));
        const lineIndex = parseInt(checkCell.getAttribute('data-line-index')) || 0;
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        const isRegularHours = checkCell.getAttribute('data-regular-hours') === 'true';
        const hasAssemblyWeekendWork = checkCell.getAttribute('data-has-assembly-weekend-work') === 'true';

        if (isWeekend) {
            // 週末の初期化処理
            const checkText = checkCell.textContent.trim();
            const hasWeekendWork = checkText === '休出';

            if (hasWeekendWork) {
                // パターン1: 加工側に休出データあり（組付側より優先）
                checkCell.textContent = '休出';
                checkCell.setAttribute('data-regular-hours', 'false');
                updateWorkingDayStatus(dateIndex, lineIndex, true);
            } else if (hasAssemblyWeekendWork) {
                // パターン2: 組付側のみ休出データあり（出庫数入力のみ表示）
                checkCell.textContent = '';
                checkCell.setAttribute('data-regular-hours', 'false');

                const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
                if (occupancyRateInput) {
                    occupancyRateInput.style.display = 'none';
                }

                toggleInputs(dateIndex, 'day', false, lineIndex);
                toggleInputs(dateIndex, 'night', false, lineIndex);

                // 出庫数入力のみ表示
                document.querySelectorAll(`.shipment-input[data-shift="day"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`).forEach(input => {
                    input.style.display = '';
                });
            } else {
                // パターン3: 休出データなし（すべて非表示）
                checkCell.textContent = '';
                checkCell.setAttribute('data-regular-hours', 'false');

                const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
                if (occupancyRateInput) {
                    occupancyRateInput.style.display = 'none';
                }

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

// 稼働日状態の更新
function updateWorkingDayStatus(dateIndex, lineIndex = 0, isInitializing = false) {
    // 各ラインごとに独立したcheckCellを取得
    const checkCell = document.querySelector(`.check-cell[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
    if (!checkCell) return;

    const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
    const checkText = checkCell.textContent.trim();

    if (isWeekend) {
        // 週末の処理
        const isWorking = checkText === '休出';

        // 稼働率入力の表示制御（このラインのみ）
        const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
        if (occupancyRateInput) {
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
            }
        } else {
            // 休出なし: 出庫数と在庫のみ表示（このラインのみ）
            toggleInputs(dateIndex, 'day', false, lineIndex);
            toggleInputs(dateIndex, 'night', false, lineIndex);

            // 出庫数がある場合は出庫数と在庫を表示、ない場合は出庫数のみ表示
            const hasShipment = Array.from(
                document.querySelectorAll(`.shipment-input[data-shift="day"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`)
            ).some(input => parseInt(input.value || 0) > 0);

            document.querySelectorAll(`.shipment-input[data-shift="day"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`).forEach(input => {
                input.style.display = '';
            });

            if (hasShipment) {
                // 出庫数がある場合は在庫も表示
                document.querySelectorAll(`.stock-input[data-shift="day"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`).forEach(input => {
                    input.style.display = '';
                });
            }

            // 休出を消した場合は生産数を0にクリアして在庫を再計算
            if (!isInitializing) {
                document.querySelectorAll(`.production-input[data-shift="day"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`).forEach(input => {
                    input.value = '0';
                });

                if (!hasShipment) {
                    // 出庫数がない場合は在庫を0にクリア
                    document.querySelectorAll(`.stock-input[data-shift="day"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`).forEach(input => {
                        input.value = '0';
                    });
                }

                // 在庫を再計算
                updateStockQuantities();
            }
        }

        // 残業計画の上限値を設定（休出は残業0）（このラインのみ）
        setOvertimeLimit(dateIndex, 'day', isWorking ? 0 : 0, lineIndex);
        setOvertimeLimit(dateIndex, 'night', isWorking ? 0 : 0, lineIndex);
    } else {
        // 平日の場合
        const isWorking = checkText === '定時';

        if (isWorking) {
            // 定時をつける場合
            // 全テーブルの残業時間を0に設定
            const tables = domCache.tables || document.querySelectorAll('table[data-line-index]');
            let hadNonZeroOvertime = false;

            tables.forEach((table, lineIndex) => {
                const dayOvertimeInput = getInputElement(`.overtime-input[data-shift="day"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
                if (dayOvertimeInput) {
                    const currentOvertime = parseInt(dayOvertimeInput.value) || 0;
                    if (currentOvertime !== 0) {
                        hadNonZeroOvertime = true;
                    }
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
                tables.forEach((table, lineIndex) => {
                    // 定時時間で再計算（残業0）
                    updateAllItemsProduction(dateIndex, ['day'], true, lineIndex);
                });

                // 在庫を再計算
                debouncedUpdateStockQuantities();
            }
        } else {
            // 定時を消す場合：残業上限を元に戻すのみ（値は変更しない、再計算もしない）
            const tables = domCache.tables || document.querySelectorAll('table[data-line-index]');

            tables.forEach((table, lineIndex) => {
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
            const hadWeekendWork = checkCell ? checkCell.getAttribute('data-has-weekend-work') === 'true' : false;
            const hasAssemblyWeekendWork = checkCell ? checkCell.getAttribute('data-has-assembly-weekend-work') === 'true' : false;

            // 週末で元々休出があったが、今は休出がない場合は削除対象
            if (isWeekend && hadWeekendWork && checkText !== '休出' && !hasAssemblyWeekendWork) {
                datesToDelete.push(dateIndex);
                continue;
            }

            // 組付側のみに休出がある場合（加工側に休出がない場合）は出庫数のみ保存
            if (isWeekend && hasAssemblyWeekendWork && checkText !== '休出') {
                const occupancyRate = 0;
                const isRegularWorkingHours = false;

                // 出庫数のみ取得
                const shipmentItems = {};
                itemNames.forEach(itemName => {
                    const shipmentInput = getInputElement(`.shipment-input[data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`);
                    if (shipmentInput) {
                        shipmentItems[itemName] = {
                            production_quantity: 0,
                            stock: 0,
                            shipment: parseInt(shipmentInput.value) || 0
                        };
                    }
                });

                datesData.push({
                    date_index: dateIndex,
                    occupancy_rate: occupancyRate,
                    regular_working_hours: isRegularWorkingHours,
                    shifts: {
                        day: {
                            stop_time: 0,
                            overtime: 0,
                            items: shipmentItems
                        },
                        night: {
                            stop_time: 0,
                            overtime: 0,
                            items: {}
                        }
                    }
                });
                continue;
            }

            // 週末で休出がない場合はスキップ
            if (isWeekend && checkText !== '休出') {
                continue;
            }

            // 平日で稼働率入力が非表示の場合もスキップ
            if (!isWeekend && occupancyRateInput && occupancyRateInput.style.display === 'none') {
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
                    const stockInput = getInputElement(
                        `.stock-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"][data-line-index="${lineIndex}"]`
                    );

                    // 週末の休出の場合は、非表示でも値を保存
                    if (isWeekend && checkText === '休出') {
                        const productionValue = productionInput ? (productionInput.value === '' ? 0 : parseInt(productionInput.value)) : 0;
                        const shipmentValue = shipmentInput ? (shipmentInput.value === '' ? 0 : parseInt(shipmentInput.value)) : 0;
                        const stockValue = stockInput ? (stockInput.value === '' ? 0 : parseInt(stockInput.value)) : 0;

                        shiftData.items[itemName] = {
                            production_quantity: productionValue,
                            stock: stockValue,
                            shipment: shipmentValue
                        };
                    } else if (productionInput || shipmentInput || stockInput) {
                        // 平日の場合は表示されている場合のみ保存
                        const productionValue = productionInput ? (productionInput.value === '' ? 0 : parseInt(productionInput.value)) : 0;
                        const shipmentValue = shipmentInput ? (shipmentInput.value === '' ? 0 : parseInt(shipmentInput.value)) : 0;
                        const stockValue = stockInput ? (stockInput.value === '' ? 0 : parseInt(stockInput.value)) : 0;

                        if (!isWeekend && productionInput && productionInput.style.display !== 'none') {
                            shiftData.items[itemName] = {
                                production_quantity: productionValue,
                                stock: stockValue,
                                shipment: shipmentValue
                            };
                        } else if (productionInput && productionInput.style.display !== 'none') {
                            shiftData.items[itemName] = {
                                production_quantity: productionValue,
                                stock: stockValue,
                                shipment: shipmentValue
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
        .catch(error => {
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
function recalculateOvertimeFromProduction(dateIndex, shift, itemName, lineIndex) {
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

    // 5分刻みに切り上げ
    calculatedOvertime = Math.ceil(calculatedOvertime / 5) * 5;
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

    // 出庫数の変更時に在庫を再計算
    document.querySelectorAll('.shipment-input').forEach(input => {
        let previousShipmentValue = input.value;

        input.addEventListener('focus', function () {
            previousShipmentValue = this.value;
        });

        input.addEventListener('input', function () {
            // プログラマティックな変更の場合はスキップ（無限ループ防止）
            if (this.dataset.programmaticChange === 'true') {
                debouncedUpdateRowTotals();
                debouncedUpdateStockQuantities();
                return;
            }

            const dateIndex = parseInt(this.getAttribute('data-date-index'));
            const shift = this.getAttribute('data-shift');
            const itemName = this.getAttribute('data-item');
            const lineIndex = parseInt(this.getAttribute('data-line-index')) || 0;

            const oldValue = parseInt(previousShipmentValue) || 0;
            const newValue = parseInt(this.value) || 0;

            // 他のテーブルの出庫数を調整（合計値維持）
            adjustOtherTableShipments(itemName, lineIndex, dateIndex, shift, oldValue, newValue);

            // 前回の値を更新
            previousShipmentValue = this.value;

            debouncedUpdateRowTotals();
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
        const isHolidayWork = checkText === '休出';
        const isRegularTime = checkText === '定時';
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
    document.querySelectorAll('.stock-input').forEach(input => {
        if (input.dataset.hasDbValue === 'true') {
            input.dataset.dbStockBase = input.value;
        } else {
            input.dataset.dbStockBase = '0';
        }
    });

    // 初期表示時にすべての生産数を設定
    // - 通常ライン: 出庫数をコピー
    // - コンロッドライン: この時点では何もしない（後で残業時間から計算）
    updateAllProductionQuantities();

    // 生産数設定後に比率を保存
    const tables = domCache.tables || document.querySelectorAll('table[data-line-index]');
    const dateCount = domCache.dateCount || document.querySelectorAll('.operation-rate-input[data-line-index="0"]').length;

    tables.forEach((table, lineIndex) => {
        const lineName = table?.getAttribute('data-line-name');

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

    // 5分刻みに切り上げ
    calculatedOvertime = Math.ceil(calculatedOvertime / 5) * 5;

    // 上限チェック
    const maxOvertime = shift === 'day' ? OVERTIME_MAX_DAY : OVERTIME_MAX_NIGHT;
    return Math.min(calculatedOvertime, maxOvertime);
}

// 残業時間の初期値を計算（生産数から逆算）
function calculateInitialOvertimes() {
    const tables = domCache.tables || document.querySelectorAll('table[data-line-index]');
    const dateCount = domCache.dateCount || document.querySelectorAll('.operation-rate-input[data-line-index="0"]').length;

    tables.forEach((table, lineIndex) => {
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
// 品番の分布チェックと出庫数入力制御
// ========================================
// 品番ごとに存在するテーブルのインデックスリストを保存
// { itemName: [lineIndex1, lineIndex2, ...] }
let itemTableMapping = {};

/**
 * 品番が複数のテーブルに存在するかチェックし、
 * 1つのテーブルにしかない品番の出庫数入力を無効化
 */
function checkAndDisableSingleTableItems() {
    const tables = domCache.tables || document.querySelectorAll('table[data-line-index]');

    // テーブルが1つしかない場合は処理不要
    if (tables.length <= 1) {
        return;
    }

    // 品番ごとに存在するテーブルのリストを記録
    itemTableMapping = {};

    tables.forEach((table, lineIndex) => {
        const itemNames = getItemNames(lineIndex);
        itemNames.forEach(itemName => {
            if (!itemTableMapping[itemName]) {
                itemTableMapping[itemName] = [];
            }
            itemTableMapping[itemName].push(lineIndex);
        });
    });

    // 1つのテーブルにしかない品番の出庫数入力を無効化
    Object.keys(itemTableMapping).forEach(itemName => {
        if (itemTableMapping[itemName].length === 1) {
            // この品番の全ての出庫数入力を無効化
            document.querySelectorAll(`.shipment-input[data-item="${itemName}"]`).forEach(input => {
                input.setAttribute('readonly', 'true');
                input.style.backgroundColor = '#f5f5f5';
                input.style.cursor = 'not-allowed';
                input.title = 'この品番は1つのラインでしか生産できないため変更できません';
            });
        }
    });
}

/**
 * 出庫数変更時に他のテーブルの値を調整して合計を維持
 */
function adjustOtherTableShipments(itemName, changedLineIndex, changedDateIndex, shift, oldValue, newValue) {
    // この品番が存在するテーブルのリストを取得
    const tableList = itemTableMapping[itemName];

    // 1つのテーブルにしかない、または存在しない場合は処理不要
    if (!tableList || tableList.length <= 1) {
        return;
    }

    // 変更量を計算
    const diff = newValue - oldValue;

    // 変更がない場合は処理不要
    if (diff === 0) {
        return;
    }

    // 変更したテーブル以外のテーブルリストを取得
    const otherTables = tableList.filter(lineIndex => lineIndex !== changedLineIndex);

    // 他のテーブルに均等に配分（逆の変更を適用）
    const adjustPerTable = -diff / otherTables.length;

    otherTables.forEach(lineIndex => {
        const shipmentInput = getCachedInput('shipment', lineIndex, changedDateIndex, shift, itemName);

        if (shipmentInput && shipmentInput.style.display !== 'none' && !shipmentInput.hasAttribute('readonly')) {
            const currentValue = parseInt(shipmentInput.value) || 0;
            let newAdjustedValue = Math.round(currentValue + adjustPerTable);

            // マイナスにならないように制限
            newAdjustedValue = Math.max(0, newAdjustedValue);

            // プログラマティックな変更であることを示すフラグを設定
            shipmentInput.dataset.programmaticChange = 'true';
            shipmentInput.value = newAdjustedValue;

            // フラグをクリア
            setTimeout(() => {
                delete shipmentInput.dataset.programmaticChange;
            }, 0);
        }
    });
}

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

    // 品番の分布をチェックして1つのテーブルにしかない品番の出庫数入力を無効化
    checkAndDisableSingleTableItems();

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
