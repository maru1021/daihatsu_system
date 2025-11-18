3// ========================================
// 定数
// ========================================
const REGULAR_TIME_DAY = 455;
const REGULAR_TIME_NIGHT = 450;
const OVERTIME_MAX_DAY = 120;
const OVERTIME_MAX_NIGHT = 60;
const OVERTIME_ROUND_MINUTES = 5;

// ========================================
// ユーティリティ関数
// ========================================
/**
 * セレクタで要素を取得
 */
function getInputElement(selector) {
    return document.querySelector(selector);
}

/**
 * 入力値を整数で取得（未入力/不正値は0）
 */
function getInputValue(input) {
    if (!input) return 0;
    const value = parseInt(input.value);
    return isNaN(value) ? 0 : value;
}

/**
 * 全品番名を取得
 */
function getItemNames() {
    const itemNames = [];
    document.querySelectorAll('[data-section="total_shipment"][data-shift="day"]').forEach(row => {
        const itemName = row.getAttribute('data-item');
        if (itemName) {
            itemNames.push(itemName);
        }
    });
    return itemNames;
}

/**
 * セルのスタイルを設定
 */
function setCellStyle(cell, value) {
    if (cell) {
        cell.textContent = value > 0 ? value : '';
        cell.style.fontWeight = 'bold';
        cell.style.textAlign = 'center';
    }
}

// ========================================
// 月間合計計算
// ========================================
/**
 * セクション・シフトごとの月間合計を計算
 */
function calculateShiftTotal(section, shift) {
    const rows = document.querySelectorAll(`[data-section="${section}"][data-shift="${shift}"]`);

    rows.forEach(row => {
        const itemName = row.getAttribute('data-item');
        if (!itemName) return;

        let total = 0;
        if (section === 'total_shipment') {
            row.querySelectorAll('.total-shipment').forEach(span => {
                total += parseInt(span.textContent) || 0;
            });
        } else {
            row.querySelectorAll('.production-input').forEach(input => {
                if (!input.disabled && input.style.display !== 'none') {
                    total += parseInt(input.value) || 0;
                }
            });
        }

        const monthlyTotal = row.querySelector('.monthly-total');
        setCellStyle(monthlyTotal, total);
    });
}

/**
 * 全セクションの月間合計を更新
 */
function updateMonthlyTotals() {
    // 全セクションを取得
    const sections = new Set();
    document.querySelectorAll('[data-section]').forEach(row => {
        const section = row.getAttribute('data-section');
        if (section) sections.add(section);
    });

    // セクション・シフトごとに計算
    sections.forEach(section => {
        ['day', 'night'].forEach(shift => {
            calculateShiftTotal(section, shift);
        });
    });

    // 色分けと残業時間を更新
    updateCellColors();
    updateOvertimeHours();

    // 月別計画カードを更新
    updateMonthlyPlanCard();
}

// ========================================
// 月別計画カード更新
// ========================================
/**
 * 月別計画カードの表示を更新（組付出庫数 vs 加工出庫数）
 * 品番ごとに、割り振った加工出庫数の合計と組付出庫数を比較
 */
function updateMonthlyPlanCard() {
    const itemNames = getItemNames();
    const dateCount = document.querySelectorAll('.total-shipment').length / itemNames.length;

    itemNames.forEach(itemName => {
        // 品番ごとの組付出庫数を日付ごとに集計（日勤 + 夜勤）
        let assemblyTotal = 0;
        for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
            ['day', 'night'].forEach(shift => {
                const row = document.querySelector(
                    `[data-section="total_shipment"][data-shift="${shift}"][data-item="${itemName}"]`
                );
                if (row) {
                    const cells = row.querySelectorAll('.production-cell');
                    if (cells && cells.length > dateIndex) {
                        const span = cells[dateIndex].querySelector('.total-shipment');
                        assemblyTotal += parseInt(span?.textContent || 0);
                    }
                }
            });
        }

        // 品番ごとの加工出庫数を日付ごとに集計（全ライン、日勤 + 夜勤）
        let machiningTotal = 0;
        const lineNames = Object.keys(tactsData);
        for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
            lineNames.forEach(lineName => {
                const sectionName = `line_${lineName.replace('#', '')}_shipment`;
                ['day', 'night'].forEach(shift => {
                    const input = document.querySelector(
                        `[data-section="${sectionName}"] .production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
                    );
                    if (input && !input.disabled && input.style.display !== 'none') {
                        machiningTotal += parseInt(input.value || 0);
                    }
                });
            });
        }

        // カードを更新
        const planItem = document.querySelector(`.monthly-plan-item[data-item-name="${itemName}"]`);
        if (planItem) {
            // 組付出庫数を表示
            const assemblyTotalSpan = planItem.querySelector('.assembly-total');
            if (assemblyTotalSpan) {
                assemblyTotalSpan.textContent = assemblyTotal;
            }

            // 差分を計算して表示（加工 - 組付）
            const diff = machiningTotal - assemblyTotal;
            const diffSpan = planItem.querySelector('.monthly-plan-diff');
            if (diffSpan) {
                if (diff !== 0) {
                    const sign = diff > 0 ? '+' : '';
                    diffSpan.textContent = ` (${sign}${diff})`;
                    diffSpan.style.fontSize = '0.85em';
                    diffSpan.style.marginLeft = '3px';
                } else {
                    diffSpan.textContent = '';
                }
            }

            // 背景色を設定
            if (machiningTotal > assemblyTotal) {
                // 加工出庫数の方が多い（割り振り過多）場合は薄い黄色
                planItem.style.backgroundColor = '#fef9c3';
            } else if (machiningTotal < assemblyTotal) {
                // 加工出庫数の方が少ない（割り振り不足）場合は薄い赤色
                planItem.style.backgroundColor = '#fee2e2';
            } else {
                // 同じ場合は白色（デフォルト）
                planItem.style.backgroundColor = 'white';
            }
        }
    });
}

// ========================================
// セルの色分け処理
// ========================================
/**
 * 組付出庫数セルの色分けを更新
 */
function updateCellColors() {
    const itemNames = getItemNames();
    const dateCount = document.querySelectorAll('.total-shipment').length / itemNames.length;

    itemNames.forEach(itemName => {
        for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
            ['day', 'night'].forEach(shift => {
                updateCellColor(itemName, dateIndex, shift);
            });
        }
    });
}

/**
 * 個別セルの色分けを更新
 */
function updateCellColor(itemName, dateIndex, shift) {
    // 組付出庫数を取得
    const totalShipmentRow = document.querySelector(
        `[data-section="total_shipment"][data-shift="${shift}"][data-item="${itemName}"]`
    );
    if (!totalShipmentRow) return;

    const totalShipmentCells = totalShipmentRow.querySelectorAll('.production-cell');
    if (!totalShipmentCells || totalShipmentCells.length <= dateIndex) return;

    const totalShipmentCell = totalShipmentCells[dateIndex];
    const totalShipmentSpan = totalShipmentCell.querySelector('.total-shipment');
    const totalShipment = totalShipmentSpan ? (parseInt(totalShipmentSpan.textContent) || 0) : 0;

    // 各ラインの合計を計算
    let lineTotal = 0;
    document.querySelectorAll(
        `.production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
    ).forEach(input => {
        if (!input.disabled) {
            lineTotal += parseInt(input.value) || 0;
        }
    });

    // 色分け
    if (lineTotal > totalShipment) {
        totalShipmentCell.style.setProperty('background-color', '#fff3cd', 'important'); // 黄色
    } else if (lineTotal < totalShipment) {
        totalShipmentCell.style.setProperty('background-color', '#f8d7da', 'important'); // 赤色
    } else {
        totalShipmentCell.style.removeProperty('background-color'); // 通常色に戻す
    }
}

// ========================================
// 残業時間計算
// ========================================
/**
 * 全ラインの残業時間を更新
 */
function updateOvertimeHours() {
    if (typeof datesData === 'undefined' || typeof tactsData === 'undefined') return;

    const itemNames = getItemNames();

    datesData.forEach((dateInfo, dateIndex) => {
        Object.keys(tactsData).forEach(lineName => {
            updateLineOvertime(lineName, dateIndex, itemNames, dateInfo);
        });
    });
}

/**
 * 個別ラインの残業時間を計算・更新
 */
function updateLineOvertime(lineName, dateIndex, itemNames, dateInfo) {
    const tact = tactsData[lineName];
    if (!tact || tact <= 0) return;

    // 稼働率をdatesDataから取得
    const occupancyRate = getOccupancyRate(lineName, dateIndex);

    // 日勤・夜勤の合計生産数を計算
    const productions = calculateLineProduction(lineName, dateIndex, itemNames);

    // 残業時間を計算（日勤・夜勤）
    ['day', 'night'].forEach(shift => {
        const production = productions[shift];
        const regularTime = shift === 'day' ? REGULAR_TIME_DAY : REGULAR_TIME_NIGHT;
        const overtime = calculateOvertime(production, tact, regularTime, occupancyRate);

        updateOvertimeDisplay(lineName, dateIndex, shift, overtime);
    });
}

/**
 * 稼働率を取得（datesDataから）
 */
function getOccupancyRate(lineName, dateIndex) {
    if (typeof datesData === 'undefined' || !datesData[dateIndex]) {
        return 1.0; // デフォルト100%
    }

    const dateInfo = datesData[dateIndex];
    const rate = dateInfo.occupancy_rates && dateInfo.occupancy_rates[lineName];

    return rate ? (rate / 100) : 1.0;
}

/**
 * ラインの生産数を計算
 */
function calculateLineProduction(lineName, dateIndex, itemNames) {
    const productions = { day: 0, night: 0 };
    const sectionName = `line_${lineName.replace('#', '')}_shipment`;

    itemNames.forEach(itemName => {
        ['day', 'night'].forEach(shift => {
            const input = document.querySelector(
                `[data-section="${sectionName}"] .production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
            );

            if (input && !input.disabled && input.style.display !== 'none') {
                productions[shift] += parseInt(input.value) || 0;
            }
        });
    });

    return productions;
}

/**
 * 残業時間を計算（5分刻み）
 */
function calculateOvertime(production, tact, regularTime, occupancyRate) {
    // 定時間で生産できる台数を計算（切り上げ）
    const regularTotalProduction = regularTime > 0
        ? Math.ceil(regularTime / tact * occupancyRate)
        : 0;

    // 残業で必要な追加生産数
    const additionalProduction = production - regularTotalProduction;

    // 残業時間を逆算
    const overtimeMinutes = additionalProduction > 0
        ? (additionalProduction * tact) / occupancyRate
        : 0;

    return Math.ceil(overtimeMinutes / OVERTIME_ROUND_MINUTES) * OVERTIME_ROUND_MINUTES;
}

/**
 * 残業時間の表示を更新
 */
function updateOvertimeDisplay(lineName, dateIndex, shift, overtimeMinutes) {
    const sectionName = `line_${lineName.replace('#', '')}_shipment`;
    const overtimeSpan = document.querySelector(
        `[data-section="${sectionName}"][data-shift="${shift}"][data-type="overtime"] .overtime-hours[data-line="${lineName}"][data-shift="${shift}"][data-date-index="${dateIndex}"]`
    );

    if (overtimeSpan) {
        overtimeSpan.textContent = overtimeMinutes > 0 ? overtimeMinutes : '0';
    }
}

// ========================================
// 自動割り振り
// ========================================
/**
 * 全日付・全品番の自動割り振りを実行
 */
function autoAllocate() {
    if (typeof datesData === 'undefined' || typeof tactsData === 'undefined') {
        showToast('error', 'データが読み込まれていません');
        return;
    }

    const itemNames = getItemNames();
    const dateCount = document.querySelectorAll('.total-shipment').length / itemNames.length;
    const lineNames = Object.keys(tactsData);

    // 各日付ごとに処理
    for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
        allocateDate(dateIndex, itemNames, lineNames);
    }

    // 残業時間を均等化（デバッグ用：最初の1日のみログ出力）
    for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
        balanceOvertimeForDate(dateIndex, itemNames, lineNames, dateIndex === 0);
    }

    // 残業時間を上限内に調整（夜勤60分、日勤120分）
    for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
        adjustOvertimeLimit(dateIndex, itemNames, lineNames, dateIndex === 0);
    }

    updateMonthlyTotals();
    updateOvertimeHours();
    showToast('success', '自動割り振りが完了しました');
}

/**
 * 1日分の割り振りを実行（メインラインを優先して時直を維持）
 */
function allocateDate(dateIndex, itemNames, lineNames) {
    // 稼働率情報を取得
    const occupancyRates = {};
    lineNames.forEach(lineName => {
        const rateInput = document.querySelector(
            `[data-section="line_${lineName.replace('#', '')}_shipment"] .occupancy-rate-input[data-date-index="${dateIndex}"]`
        );
        occupancyRates[lineName] = rateInput ? (parseFloat(rateInput.value) || 100) : 100;
    });

    // 各シフト+ラインの合計生産能力を計算
    let totalMaxProduction = 0;
    const linesCapacity = {};

    lineNames.forEach(lineName => {
        const tact = tactsData[lineName];
        const occupancyRate = occupancyRates[lineName] / 100;

        // 日勤の最大生産数
        const dayMax = Math.floor((REGULAR_TIME_DAY + OVERTIME_MAX_DAY) * occupancyRate / tact);
        // 夜勤の最大生産数
        const nightMax = Math.floor((REGULAR_TIME_NIGHT + OVERTIME_MAX_NIGHT) * occupancyRate / tact);

        linesCapacity[lineName] = {
            day: dayMax,
            night: nightMax,
            total: dayMax + nightMax,
            dayUsed: 0,
            nightUsed: 0
        };

        totalMaxProduction += dayMax + nightMax;
    });

    // 各品番の必要出庫数を取得（日勤+夜勤の合計）
    const requiredShipments = {};
    itemNames.forEach(itemName => {
        // 日勤の出庫数
        const dayShipmentTd = document.querySelector(
            `tr[data-section="total_shipment"][data-shift="day"][data-item="${itemName}"] td[data-date-index="${dateIndex}"]`
        );
        const dayShipment = parseInt(dayShipmentTd?.querySelector('.total-shipment')?.textContent || 0);

        // 夜勤の出庫数
        const nightShipmentTd = document.querySelector(
            `tr[data-section="total_shipment"][data-shift="night"][data-item="${itemName}"] td[data-date-index="${dateIndex}"]`
        );
        const nightShipment = parseInt(nightShipmentTd?.querySelector('.total-shipment')?.textContent || 0);

        // 合計
        requiredShipments[itemName] = dayShipment + nightShipment;
    });

    // 品番を分類: 両方で作れる品番 vs 1ラインでしか作れない品番
    const flexibleItems = []; // 両方で作れる
    const fixedItems = {}; // {lineName: [itemNames]}

    lineNames.forEach(lineName => {
        fixedItems[lineName] = [];
    });

    itemNames.forEach(itemName => {
        const requiredQty = requiredShipments[itemName];
        if (requiredQty === 0) return;

        const availableLines = getAvailableLinesForItem(itemName, lineNames);

        if (availableLines.length === lineNames.length) {
            // 両方で作れる
            flexibleItems.push(itemName);
        } else {
            // 特定のラインでしか作れない
            availableLines.forEach(lineName => {
                fixedItems[lineName].push(itemName);
            });
        }
    });

    const allocations = {}; // {itemName: {lineName: {day: qty, night: qty}}}
    const line2Name = lineNames.find(name => name.includes('#2'));

    // 全品番の割り振り構造を初期化
    itemNames.forEach(itemName => {
        allocations[itemName] = {};
        lineNames.forEach(lineName => {
            allocations[itemName][lineName] = { day: 0, night: 0 };
        });
    });

    // 各品番について、組み付けの日勤/夜勤の出庫数を取得して、時直を維持して割り振り
    for (const itemName of itemNames) {
        // 日勤の出庫数
        const dayShipmentSpan = document.querySelector(
            `tr[data-section="total_shipment"][data-shift="day"][data-item="${itemName}"] td[data-date-index="${dateIndex}"]`
        );
        const dayShipment = parseInt(dayShipmentSpan?.querySelector('.total-shipment')?.textContent || 0);

        // 夜勤の出庫数
        const nightShipmentSpan = document.querySelector(
            `tr[data-section="total_shipment"][data-shift="night"][data-item="${itemName}"] td[data-date-index="${dateIndex}"]`
        );
        const nightShipment = parseInt(nightShipmentSpan?.querySelector('.total-shipment')?.textContent || 0);

        if (dayShipment === 0 && nightShipment === 0) continue;

        // 品番のメインラインを取得（モデルのlineフィールド）
        const mainLine = itemMainLine[itemName];

        // メインラインが設定されている場合はそれを使用、なければデフォルト（両方で作れる場合は2ライン）
        let targetLine;
        if (mainLine) {
            targetLine = mainLine;
        } else {
            // メインラインが設定されていない場合は、作れるラインを確認
            const availableLines = getAvailableLinesForItem(itemName, lineNames);
            const isFlexible = availableLines.length === lineNames.length;
            targetLine = isFlexible ? line2Name : availableLines[0];
        }

        const capacity = linesCapacity[targetLine];

        // 日勤を割り振り
        if (dayShipment > 0) {
            allocations[itemName][targetLine].day = dayShipment;
            capacity.dayUsed += dayShipment;
        }

        // 夜勤を割り振り
        if (nightShipment > 0) {
            allocations[itemName][targetLine].night = nightShipment;
            capacity.nightUsed += nightShipment;
        }
    }

    // 結果を入力フィールドに反映
    for (const itemName in allocations) {
        lineNames.forEach(lineName => {
            const dayQty = allocations[itemName][lineName].day;
            const nightQty = allocations[itemName][lineName].night;
            const sectionName = `line_${lineName.replace('#', '')}_shipment`;

            // 日勤
            const dayInput = document.querySelector(
                `[data-section="${sectionName}"] .production-input[data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
            );
            if (dayInput) {
                dayInput.value = dayQty;
            }

            // 夜勤
            const nightInput = document.querySelector(
                `[data-section="${sectionName}"] .production-input[data-shift="night"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
            );
            if (nightInput) {
                nightInput.value = nightQty;
            }
        });
    }
}

/**
 * 品番が作れるラインのリストを取得
 */
function getAvailableLinesForItem(itemName, lineNames) {
    const lineInfo = itemLineInfo[itemName];

    if (!lineInfo || lineInfo === 'both') {
        // 両方のラインで作れる
        return lineNames;
    } else {
        // 特定のラインでのみ作れる
        return lineNames.filter(lineName => lineName === lineInfo);
    }
}

/**
 * 1日分の残業時間を均等化（複数ラインで作れる品番を移動）
 * 日勤は日勤で、夜勤は夜勤でそれぞれ均等化
 */
function balanceOvertimeForDate(dateIndex, itemNames, lineNames, enableLog = false) {
    if (enableLog) console.log(`\n=== 日付インデックス ${dateIndex} の残業時間均等化 ===`);

    // 稼働率をdatesDataから取得
    const occupancyRates = {};
    lineNames.forEach(lineName => {
        occupancyRates[lineName] = getOccupancyRate(lineName, dateIndex) * 100;
    });

    const line1Name = lineNames.find(name => name.includes('#1'));
    const line2Name = lineNames.find(name => name.includes('#2'));

    if (!line1Name || !line2Name) return;

    // 日勤と夜勤それぞれで均等化
    ['day', 'night'].forEach(shift => {
        balanceOvertimeForShift(dateIndex, itemNames, line1Name, line2Name, shift, occupancyRates, enableLog);
    });
}

/**
 * 1つのシフト（日勤or夜勤）の残業時間を均等化
 */
function balanceOvertimeForShift(dateIndex, itemNames, line1Name, line2Name, shift, occupancyRates, enableLog) {
    if (enableLog) console.log(`\n[${shift === 'day' ? '日勤' : '夜勤'}] 残業時間均等化`);

    // フェーズ1: 初期移動
    const movedItems = performInitialBalancing(
        dateIndex, itemNames, line1Name, line2Name, shift, occupancyRates, enableLog
    );

    // フェーズ2: 微調整
    performFineAdjustment(
        dateIndex, line1Name, line2Name, shift, occupancyRates, movedItems, enableLog
    );

    // 最終結果を表示
    if (enableLog) {
        const overtimes = calculateOvertimesByShift(dateIndex, line1Name, line2Name, shift, occupancyRates, false);
        console.log(`最終状態: #1=${overtimes.line1.toFixed(1)}分, #2=${overtimes.line2.toFixed(1)}分, 差=${Math.abs(overtimes.line1 - overtimes.line2).toFixed(1)}分`);
    }
}

/**
 * 残業時間を上限内に調整（夜勤60分、日勤120分）
 * 1. 夜勤が60分超過 → 日勤に移動
 * 2. 日勤が120分超過 & 夜勤に余裕 → 夜勤に移動
 * 3. 両方超過 → 両方の上限までの生産数に設定
 */
function adjustOvertimeLimit(dateIndex, itemNames, lineNames, enableLog = false) {
    if (enableLog) console.log(`\n=== 日付インデックス ${dateIndex} の残業時間調整 ===`);

    lineNames.forEach(lineName => {
        const tact = tactsData[lineName];
        if (!tact || tact <= 0) return;

        const occupancyRate = getOccupancyRate(lineName, dateIndex);
        const sectionName = `line_${lineName.replace('#', '')}_shipment`;

        // 日勤と夜勤の生産数を集計
        const productions = { day: {}, night: {} };
        let dayTotal = 0, nightTotal = 0;

        itemNames.forEach(itemName => {
            ['day', 'night'].forEach(shift => {
                const input = document.querySelector(
                    `[data-section="${sectionName}"] .production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
                );
                if (input && input.style.display !== 'none') {
                    const qty = parseInt(input.value || 0);
                    productions[shift][itemName] = qty;
                    if (shift === 'day') dayTotal += qty;
                    else nightTotal += qty;
                }
            });
        });

        if (dayTotal === 0 && nightTotal === 0) return;

        // 残業時間を計算
        const dayOvertime = calculateOvertime(dayTotal, tact, REGULAR_TIME_DAY, occupancyRate);
        const nightOvertime = calculateOvertime(nightTotal, tact, REGULAR_TIME_NIGHT, occupancyRate);

        // 各シフトの最大生産可能台数
        const maxDayProduction = Math.floor((REGULAR_TIME_DAY + OVERTIME_MAX_DAY) * occupancyRate / tact);
        const maxNightProduction = Math.floor((REGULAR_TIME_NIGHT + OVERTIME_MAX_NIGHT) * occupancyRate / tact);

        if (enableLog) {
            console.log(`${lineName}: 日勤残業${dayOvertime}分(${dayTotal}台), 夜勤残業${nightOvertime}分(${nightTotal}台)`);
        }

        // ケース1: 夜勤が超過している場合、日勤に移動
        if (nightOvertime > OVERTIME_MAX_NIGHT) {
            const moveFromNight = nightTotal - maxNightProduction;

            if (enableLog) {
                console.log(`  ケース1: 夜勤超過 → ${moveFromNight}台を夜勤→日勤`);
            }

            moveProportionally(productions.night, nightTotal, moveFromNight, sectionName, dateIndex, 'night', 'day', enableLog);

            // 再計算
            dayTotal += moveFromNight;
            nightTotal = maxNightProduction;
        }

        // 再度残業時間を計算
        const newDayOvertime = calculateOvertime(dayTotal, tact, REGULAR_TIME_DAY, occupancyRate);
        const newNightOvertime = calculateOvertime(nightTotal, tact, REGULAR_TIME_NIGHT, occupancyRate);

        // ケース2: 日勤が超過 & 夜勤に余裕がある場合、夜勤に移動
        if (newDayOvertime > OVERTIME_MAX_DAY && newNightOvertime < OVERTIME_MAX_NIGHT) {
            const moveFromDay = Math.min(
                dayTotal - maxDayProduction,
                maxNightProduction - nightTotal
            );

            if (moveFromDay > 0) {
                if (enableLog) {
                    console.log(`  ケース2: 日勤超過 & 夜勤に余裕 → ${moveFromDay}台を日勤→夜勤`);
                }

                // 現在の日勤生産数を再集計
                const currentDayProductions = {};
                let currentDayTotal = 0;
                itemNames.forEach(itemName => {
                    const input = document.querySelector(
                        `[data-section="${sectionName}"] .production-input[data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
                    );
                    if (input && input.style.display !== 'none') {
                        const qty = parseInt(input.value || 0);
                        currentDayProductions[itemName] = qty;
                        currentDayTotal += qty;
                    }
                });

                moveProportionally(currentDayProductions, currentDayTotal, moveFromDay, sectionName, dateIndex, 'day', 'night', enableLog);

                dayTotal -= moveFromDay;
                nightTotal += moveFromDay;
            }
        }

        // ケース3: 両方超過している場合、両方の上限に設定
        const finalDayOvertime = calculateOvertime(dayTotal, tact, REGULAR_TIME_DAY, occupancyRate);
        const finalNightOvertime = calculateOvertime(nightTotal, tact, REGULAR_TIME_NIGHT, occupancyRate);

        if (finalDayOvertime > OVERTIME_MAX_DAY) {
            if (enableLog) {
                console.log(`  ケース3: 日勤上限超過 → 上限${maxDayProduction}台に削減`);
            }

            const reduceDayBy = dayTotal - maxDayProduction;

            // 現在の日勤生産数を再集計
            const currentDayProductions = {};
            let currentDayTotal = 0;
            itemNames.forEach(itemName => {
                const input = document.querySelector(
                    `[data-section="${sectionName}"] .production-input[data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
                );
                if (input && input.style.display !== 'none') {
                    const qty = parseInt(input.value || 0);
                    currentDayProductions[itemName] = qty;
                    currentDayTotal += qty;
                }
            });

            reduceProportionally(currentDayProductions, currentDayTotal, reduceDayBy, sectionName, dateIndex, 'day', enableLog);
        }

        if (finalNightOvertime > OVERTIME_MAX_NIGHT) {
            if (enableLog) {
                console.log(`  ケース3: 夜勤上限超過 → 上限${maxNightProduction}台に削減`);
            }

            const reduceNightBy = nightTotal - maxNightProduction;

            // 現在の夜勤生産数を再集計
            const currentNightProductions = {};
            let currentNightTotal = 0;
            itemNames.forEach(itemName => {
                const input = document.querySelector(
                    `[data-section="${sectionName}"] .production-input[data-shift="night"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
                );
                if (input && input.style.display !== 'none') {
                    const qty = parseInt(input.value || 0);
                    currentNightProductions[itemName] = qty;
                    currentNightTotal += qty;
                }
            });

            reduceProportionally(currentNightProductions, currentNightTotal, reduceNightBy, sectionName, dateIndex, 'night', enableLog);
        }
    });
}

/**
 * 生産比率を維持したまま移動
 */
function moveProportionally(productions, total, moveQty, sectionName, dateIndex, fromShift, toShift, enableLog) {
    Object.keys(productions).forEach(itemName => {
        const qty = productions[itemName];
        if (qty === 0) return;

        const move = Math.round((qty / total) * moveQty);
        if (move === 0) return;

        const fromInput = document.querySelector(
            `[data-section="${sectionName}"] .production-input[data-shift="${fromShift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
        );
        const toInput = document.querySelector(
            `[data-section="${sectionName}"] .production-input[data-shift="${toShift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
        );

        if (fromInput && toInput) {
            const currentFrom = parseInt(fromInput.value || 0);
            const currentTo = parseInt(toInput.value || 0);

            fromInput.value = Math.max(0, currentFrom - move);
            toInput.value = currentTo + move;

            if (enableLog) {
                console.log(`    ${itemName}: ${move}台 (${fromShift}${currentFrom}→${fromInput.value}, ${toShift}${currentTo}→${toInput.value})`);
            }
        }
    });
}

/**
 * 生産比率を維持したまま削減
 */
function reduceProportionally(productions, total, reduceQty, sectionName, dateIndex, shift, enableLog) {
    Object.keys(productions).forEach(itemName => {
        const qty = productions[itemName];
        if (qty === 0) return;

        const reduce = Math.round((qty / total) * reduceQty);
        if (reduce === 0) return;

        const input = document.querySelector(
            `[data-section="${sectionName}"] .production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
        );

        if (input) {
            const current = parseInt(input.value || 0);
            input.value = Math.max(0, current - reduce);

            if (enableLog) {
                console.log(`    ${itemName}: ${reduce}台削減 (${shift}${current}→${input.value})`);
            }
        }
    });
}

/**
 * フェーズ1: #2から#1への初期移動
 * @returns {Array} 移動した品番の情報
 */
function performInitialBalancing(dateIndex, itemNames, line1Name, line2Name, shift, occupancyRates, enableLog) {
    const movedItems = [];
    let overtimes = calculateOvertimesByShift(dateIndex, line1Name, line2Name, shift, occupancyRates, enableLog);

    if (enableLog) {
        console.log(`初期状態: #1=${overtimes.line1.toFixed(1)}分, #2=${overtimes.line2.toFixed(1)}分, 差=${(overtimes.line2 - overtimes.line1).toFixed(1)}分`);
    }

    const MAX_ITERATIONS = 20; // 無限ループ防止
    let iteration = 0;

    // 残業時間を調整（#1が若干多めになるように）
    while (iteration < MAX_ITERATIONS) {
        iteration++;

        const overtimeDiff = overtimes.line2 - overtimes.line1;

        // 終了条件: #1が#2より0〜10分多い状態が理想
        // #2の方が多い、または#1が10分以上多い場合は調整が必要
        if (overtimeDiff > 0) {
            // #2の方が残業が多い → #2から#1へ移動して#1を多めにする
        } else if (overtimeDiff < -10) {
            // #1が10分以上多すぎる → #1から#2へ移動
        } else {
            // #1が0〜10分多い状態（理想的）→ 終了
            if (enableLog) console.log(`  理想的な状態（#1が${Math.abs(overtimeDiff).toFixed(1)}分多い）`);
            break;
        }

        // 残業が多いラインから少ないラインへ移動
        let fromLineName, toLineName;
        if (overtimeDiff > 0) {
            // #2の方が残業が多い → #2から#1へ移動
            fromLineName = line2Name;
            toLineName = line1Name;
        } else {
            // #1の方が残業が多すぎる → #1から#2へ移動
            fromLineName = line1Name;
            toLineName = line2Name;
        }

        // 複数ラインで作れる品番を移動
        let moved = false;
        for (const itemName of itemNames) {
            if (!canMoveItem(itemName, line1Name, line2Name)) continue;

            const inputs = getLineInputs(dateIndex, itemName, line1Name, line2Name, shift);
            if (!inputs) continue;

            // 移動元のラインに品番があるかチェック
            const fromQty = fromLineName === line1Name ? inputs.qty1 : inputs.qty2;
            if (fromQty === 0) continue;

            const moveQty = calculateMoveQuantityBidirectional(
                overtimes, line1Name, line2Name, fromLineName, toLineName, occupancyRates, fromQty
            );

            if (moveQty > 0) {
                if (fromLineName === line1Name) {
                    // #1→#2への移動
                    inputs.line2Input.value = inputs.qty2 + moveQty;
                    inputs.line1Input.value = inputs.qty1 - moveQty;
                } else {
                    // #2→#1への移動
                    inputs.line1Input.value = inputs.qty1 + moveQty;
                    inputs.line2Input.value = inputs.qty2 - moveQty;
                }

                // 同じ品番を複数回移動しないようにmovedItemsに追加
                if (!movedItems.find(item => item.itemName === itemName)) {
                    movedItems.push({
                        itemName,
                        line1Input: inputs.line1Input,
                        line2Input: inputs.line2Input
                    });
                }

                if (enableLog) console.log(`  [${iteration}] ${itemName}: ${moveQty}個を${fromLineName}→${toLineName}に移動`);
                overtimes = calculateOvertimesByShift(dateIndex, line1Name, line2Name, shift, occupancyRates, false);
                moved = true;
                break; // 1つ移動したら残業時間を再計算
            }
        }

        // 移動できる品番がなければ終了
        if (!moved) {
            if (enableLog) console.log(`  移動可能な品番がありません`);
            break;
        }
    }

    if (enableLog) {
        console.log(`移動後: #1=${overtimes.line1.toFixed(1)}分, #2=${overtimes.line2.toFixed(1)}分, 差=${Math.abs(overtimes.line2 - overtimes.line1).toFixed(1)}分`);
    }

    return movedItems;
}

/**
 * フェーズ2: 残業時間の微調整
 */
function performFineAdjustment(dateIndex, line1Name, line2Name, shift, occupancyRates, movedItems, enableLog) {
    const MAX_ITERATIONS = 10;
    const TOLERANCE_MIN = 5; // 許容差（分）
    const EXCESSIVE_DIFF = 10; // #1が多すぎる判定基準（分）

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const overtimes = calculateOvertimesByShift(dateIndex, line1Name, line2Name, shift, occupancyRates, false);
        const diff = overtimes.line2 - overtimes.line1; // 正: #2が多い, 負: #1が多い

        // 終了条件: 差が許容範囲内
        if (isWithinTolerance(diff, TOLERANCE_MIN, EXCESSIVE_DIFF)) {
            if (enableLog) console.log(`  → 残業時間の差が許容範囲内のため終了（差=${diff.toFixed(1)}分）`);
            break;
        }

        const adjusted = adjustBalance(
            diff, movedItems, line1Name, line2Name, occupancyRates,
            iteration, TOLERANCE_MIN, EXCESSIVE_DIFF, enableLog
        );

        if (!adjusted) {
            if (enableLog) console.log(`  → 調整可能な品番がないため終了`);
            break;
        }
    }
}

/**
 * 品番が移動可能かチェック
 */
function canMoveItem(itemName, line1Name, line2Name) {
    const availableLines = getAvailableLinesForItem(itemName, [line1Name, line2Name]);
    return availableLines.length >= 2;
}

/**
 * ライン入力要素を取得
 */
function getLineInputs(dateIndex, itemName, line1Name, line2Name, shift) {
    const line1Section = `line_${line1Name.replace('#', '')}_shipment`;
    const line2Section = `line_${line2Name.replace('#', '')}_shipment`;

    const line1Input = document.querySelector(
        `[data-section="${line1Section}"] .production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
    );
    const line2Input = document.querySelector(
        `[data-section="${line2Section}"] .production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
    );

    if (!line1Input || !line2Input) return null;

    return {
        line1Input,
        line2Input,
        qty1: parseInt(line1Input.value || 0),
        qty2: parseInt(line2Input.value || 0)
    };
}

/**
 * 移動数量を計算（切り上げで多めに#1に移動）
 */
function calculateMoveQuantity(overtimes, line1Name, line2Name, occupancyRates, maxQty) {
    const tact1 = tactsData[line1Name];
    const tact2 = tactsData[line2Name];
    const rate1 = occupancyRates[line1Name] / 100;
    const rate2 = occupancyRates[line2Name] / 100;

    const diff = overtimes.line2 - overtimes.line1;
    const moveQty = Math.ceil(diff / (tact2 / rate2 + tact1 / rate1));

    return Math.max(0, Math.min(moveQty, maxQty));
}

/**
 * 移動数量を計算（双方向対応）
 */
function calculateMoveQuantityBidirectional(overtimes, line1Name, line2Name, fromLineName, toLineName, occupancyRates, maxQty) {
    const tact1 = tactsData[line1Name];
    const tact2 = tactsData[line2Name];
    const rate1 = occupancyRates[line1Name] / 100;
    const rate2 = occupancyRates[line2Name] / 100;

    const overtimeDiff = Math.abs(overtimes.line2 - overtimes.line1);

    // 移動元と移動先のタクトを取得
    const fromTact = fromLineName === line1Name ? tact1 : tact2;
    const toTact = toLineName === line1Name ? tact1 : tact2;
    const fromRate = fromLineName === line1Name ? rate1 : rate2;
    const toRate = toLineName === line1Name ? rate1 : rate2;

    // 残業時間の差を埋めるために必要な移動数量
    const moveQty = Math.ceil(overtimeDiff / (fromTact / fromRate + toTact / toRate));

    return Math.max(0, Math.min(moveQty, maxQty));
}

/**
 * 品番の移動を実行
 */
function executeMove(line1Input, line2Input, moveQty, currentQty1, currentQty2) {
    line1Input.value = currentQty1 + moveQty;
    line2Input.value = currentQty2 - moveQty;
}

/**
 * 差が許容範囲内かチェック
 */
function isWithinTolerance(diff, toleranceMin, excessiveDiff) {
    return Math.abs(diff) < toleranceMin || (diff < 0 && Math.abs(diff) < excessiveDiff);
}

/**
 * バランス調整を実行
 */
function adjustBalance(diff, movedItems, line1Name, line2Name, occupancyRates, iteration, toleranceMin, excessiveDiff, enableLog) {
    if (diff < -excessiveDiff) {
        // #1が多すぎる → 1個戻す
        return moveBackToLine2(movedItems, diff, iteration, enableLog);
    } else if (diff > toleranceMin) {
        // #2が多い → #1に追加移動
        return moveMoreToLine1(movedItems, diff, line1Name, line2Name, occupancyRates, iteration, enableLog);
    }
    return false;
}

/**
 * #1から#2に1個戻す
 */
function moveBackToLine2(movedItems, diff, iteration, enableLog) {
    if (enableLog) {
        console.log(`  イテレーション${iteration + 1}: #1が多すぎる（差${Math.abs(diff).toFixed(1)}分）→ 1個を#1→#2に戻す`);
    }

    for (const moved of movedItems) {
        const current1 = parseInt(moved.line1Input.value || 0);
        if (current1 === 0) continue;

        const current2 = parseInt(moved.line2Input.value || 0);
        moved.line1Input.value = current1 - 1;
        moved.line2Input.value = current2 + 1;

        if (enableLog) console.log(`    ${moved.itemName}: 1個を#1→#2に戻す`);
        return true;
    }
    return false;
}

/**
 * #2から#1に追加移動
 */
function moveMoreToLine1(movedItems, diff, line1Name, line2Name, occupancyRates, iteration, enableLog) {
    if (enableLog) {
        console.log(`  イテレーション${iteration + 1}: #2が多い（差${diff.toFixed(1)}分）→ 追加で#2→#1`);
    }

    for (const moved of movedItems) {
        const current2 = parseInt(moved.line2Input.value || 0);
        if (current2 === 0) continue;

        const tact1 = tactsData[line1Name];
        const tact2 = tactsData[line2Name];
        const rate1 = occupancyRates[line1Name] / 100;
        const rate2 = occupancyRates[line2Name] / 100;

        let addQty = Math.ceil(diff / (tact2 / rate2 + tact1 / rate1));
        addQty = Math.max(1, Math.min(addQty, current2));

        const current1 = parseInt(moved.line1Input.value || 0);
        moved.line1Input.value = current1 + addQty;
        moved.line2Input.value = current2 - addQty;

        if (enableLog) console.log(`    ${moved.itemName}: ${addQty}個を追加で#2→#1`);
        return true;
    }
    return false;
}

/**
 * 特定の直（日勤 or 夜勤）の残業時間を2つのラインで計算
 * @param {number} dateIndex - 日付インデックス
 * @param {string} line1Name - ライン1の名前
 * @param {string} line2Name - ライン2の名前
 * @param {string} shift - 'day' or 'night'
 * @param {object} occupancyRates - 稼働率オブジェクト {lineName: rate}
 * @param {boolean} enableLog - ログ出力フラグ
 * @returns {{line1: number, line2: number}} 各ラインの残業時間（分）
 */
function calculateOvertimesByShift(dateIndex, line1Name, line2Name, shift, occupancyRates, enableLog) {
    const regularTime = shift === 'day' ? REGULAR_TIME_DAY : REGULAR_TIME_NIGHT;
    const results = { line1: 0, line2: 0 };

    [line1Name, line2Name].forEach((lineName, index) => {
        const tact = tactsData[lineName];
        if (!tact || tact <= 0) return;

        const occupancyRate = occupancyRates[lineName] / 100;
        if (!occupancyRate || occupancyRate <= 0) return;

        const sectionName = `line_${lineName.replace('#', '')}_shipment`;

        // 指定された直の生産数を集計
        let total = 0;
        document.querySelectorAll(`[data-section="${sectionName}"] .production-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`).forEach(input => {
            total += parseInt(input.value || 0);
        });

        // 残業時間を計算
        const regularTotalProduction = regularTime > 0
            ? Math.ceil(regularTime / tact * occupancyRate)
            : 0;

        const additionalProduction = total - regularTotalProduction;

        const overtime = additionalProduction > 0
            ? (additionalProduction * tact) / occupancyRate
            : 0;

        if (index === 0) {
            results.line1 = overtime;
        } else {
            results.line2 = overtime;
        }

        if (enableLog) {
            console.log(`  ${lineName} ${shift === 'day' ? '日勤' : '夜勤'}: ${total}個, 定時生産可能${regularTotalProduction}個, 追加${additionalProduction}個, 残業${overtime.toFixed(1)}分`);
        }
    });

    return results;
}

/**
 * 各ラインの現在の残業時間を計算
 */
function calculateOvertimesForDate(dateIndex, lineNames, occupancyRates, enableLog = false) {
    const overtimes = {};

    lineNames.forEach(lineName => {
        const tact = tactsData[lineName];
        const occupancyRate = occupancyRates[lineName] / 100;
        const sectionName = `line_${lineName.replace('#', '')}_shipment`;

        // 日勤と夜勤の生産数を集計
        let dayTotal = 0, nightTotal = 0;

        const inputs = document.querySelectorAll(`[data-section="${sectionName}"] .production-input[data-date-index="${dateIndex}"]`);
        if (enableLog) console.log(`  ${lineName} (${sectionName}): ${inputs.length}個の入力フィールド`);

        inputs.forEach(input => {
            const shift = input.getAttribute('data-shift');
            const qty = parseInt(input.value || 0);
            const item = input.getAttribute('data-item');

            if (enableLog && qty > 0) {
                console.log(`    ${item} ${shift}勤: ${qty}個`);
            }

            if (shift === 'day') {
                dayTotal += qty;
            } else if (shift === 'night') {
                nightTotal += qty;
            }
        });

        if (enableLog) console.log(`  ${lineName} 合計: 日勤${dayTotal}個, 夜勤${nightTotal}個`);

        // 残業時間を計算
        const dayProductionTime = dayTotal * tact;
        const nightProductionTime = nightTotal * tact;

        const dayOvertime = Math.max(0, (dayProductionTime / occupancyRate) - REGULAR_TIME_DAY);
        const nightOvertime = Math.max(0, (nightProductionTime / occupancyRate) - REGULAR_TIME_NIGHT);

        if (enableLog) console.log(`  ${lineName} 残業: 日勤${dayOvertime.toFixed(1)}分, 夜勤${nightOvertime.toFixed(1)}分, 合計${(dayOvertime + nightOvertime).toFixed(1)}分`);

        overtimes[lineName] = dayOvertime + nightOvertime;
    });

    return overtimes;
}

/**
 * 1つの品番を1シフトに割り振る
 */
function allocateToShift(itemName, requiredQty, lineNames, linesInfo, dateIndex, shift) {
    const allocations = {};
    let totalAllocated = 0;

    console.log(`    allocateToShift: itemName=${itemName}, requiredQty=${requiredQty}, shift=${shift}`);
    console.log('    linesInfo:', linesInfo);

    // 各ラインに均等に割り振る（残業均等化）
    const lineCount = lineNames.length;
    const baseQty = Math.floor(requiredQty / lineCount);
    const remainder = requiredQty % lineCount;

    lineNames.forEach((lineName, index) => {
        const lineInfo = linesInfo[lineName];
        if (!lineInfo) {
            console.log(`    ライン${lineName}: lineInfoなし`);
            return;
        }

        // 基本量 + 余り分
        let targetQty = baseQty;
        if (index < remainder) targetQty += 1;

        // ラインの上限を超えないように調整
        const available = lineInfo.maxProduction - lineInfo.currentProduction;
        const actualQty = Math.min(targetQty, available);

        console.log(`    ライン${lineName}: targetQty=${targetQty}, available=${available}, actualQty=${actualQty}, maxProd=${lineInfo.maxProduction}, currentProd=${lineInfo.currentProduction}`);

        if (actualQty > 0) {
            if (!allocations[itemName]) allocations[itemName] = {};
            allocations[itemName][lineName] = actualQty;
            totalAllocated += actualQty;
            lineInfo.currentProduction += actualQty;
        }
    });

    // 割り振れなかった分を他のラインに再配分
    let unallocated = requiredQty - totalAllocated;
    if (unallocated > 0) {
        for (const lineName of lineNames) {
            if (unallocated <= 0) break;

            const lineInfo = linesInfo[lineName];
            if (!lineInfo) continue;

            const available = lineInfo.maxProduction - lineInfo.currentProduction;
            if (available > 0) {
                const additionalQty = Math.min(unallocated, available);

                if (!allocations[itemName]) allocations[itemName] = {};
                allocations[itemName][lineName] = (allocations[itemName][lineName] || 0) + additionalQty;
                totalAllocated += additionalQty;
                lineInfo.currentProduction += additionalQty;
                unallocated -= additionalQty;
            }
        }
    }

    return { allocated: totalAllocated, allocations };
}

/**
 * 1シフト分の割り振りを実行
 */
function allocateShift(dateIndex, shift, itemNames, lineNames) {
    const dateInfo = datesData[dateIndex];
    if (!dateInfo) return { success: false, message: 'データがありません' };

    // ラインの初期情報を設定（残業上限を考慮）
    const overtimeMax = shift === 'day' ? OVERTIME_MAX_DAY : OVERTIME_MAX_NIGHT;
    const linesInfo = initializeLinesInfo(lineNames, dateInfo, shift, overtimeMax);

    // 品番を分類（ライン専用 vs 柔軟）
    const { fixedAllocations, flexibleItems } = classifyItems(
        itemNames, dateIndex, shift, lineNames, linesInfo
    );

    // 柔軟な品番を残業均等化で割り振り
    const flexibleAllocations = allocateFlexibleItems(flexibleItems, lineNames, linesInfo);

    // 割り振り結果をマージして反映
    const finalAllocations = { ...fixedAllocations, ...flexibleAllocations };
    applyAllocations(finalAllocations, itemNames, lineNames, dateIndex, shift, linesInfo);

    // 残業上限チェック
    const checkResult = checkOvertimeLimits(linesInfo, dateIndex, shift, overtimeMax);
    return checkResult;
}

/**
 * ライン情報を初期化
 */
function initializeLinesInfo(lineNames, dateInfo, shift, overtimeMax) {
    const linesInfo = {};
    const regularTime = shift === 'day' ? REGULAR_TIME_DAY : REGULAR_TIME_NIGHT;

    lineNames.forEach(lineName => {
        const tact = tactsData[lineName];
        const occupancyRate = (dateInfo.occupancy_rates && dateInfo.occupancy_rates[lineName])
            ? (dateInfo.occupancy_rates[lineName] / 100)
            : 1.0;

        // 残業上限を考慮した最大生産可能時間
        const maxProductionTime = (regularTime + overtimeMax) * occupancyRate;
        const maxProduction = Math.floor(maxProductionTime / tact);

        linesInfo[lineName] = {
            tact: tact,
            occupancyRate: occupancyRate,
            availableTime: regularTime * occupancyRate,
            maxProductionTime: maxProductionTime,
            maxProduction: maxProduction,
            currentProduction: 0
        };
    });

    return linesInfo;
}

/**
 * 残業上限チェック
 */
function checkOvertimeLimits(linesInfo, dateIndex, shift, overtimeMax) {
    const shiftName = shift === 'day' ? '日勤' : '夜勤';
    const dateElements = document.querySelectorAll('.check-cell');
    const dateText = dateElements[dateIndex]?.getAttribute('data-date') || `日付${dateIndex + 1}`;

    for (const lineName in linesInfo) {
        const lineInfo = linesInfo[lineName];
        if (lineInfo.currentProduction > lineInfo.maxProduction) {
            return {
                success: false,
                message: `${dateText} ${shiftName}：ライン${lineName}の生産数が残業上限（${overtimeMax}分）を超えています。生産可能数: ${lineInfo.maxProduction}個、必要数: ${lineInfo.currentProduction}個`
            };
        }
    }

    return { success: true };
}

/**
 * 品番をライン固定と柔軟に分類
 */
function classifyItems(itemNames, dateIndex, shift, lineNames, linesInfo) {
    const fixedAllocations = {};
    const flexibleItems = [];

    itemNames.forEach(itemName => {
        const totalShipment = getTotalShipment(itemName, dateIndex, shift);

        if (totalShipment === 0) {
            fixedAllocations[itemName] = createEmptyAllocation(lineNames);
            return;
        }

        const lineInfo = itemLineInfo[itemName];

        if (lineInfo === '#1') {
            fixedAllocations[itemName] = allocateToFixedLine('#1', totalShipment, lineNames, linesInfo);
        } else if (lineInfo === '#2') {
            fixedAllocations[itemName] = allocateToFixedLine('#2', totalShipment, lineNames, linesInfo);
        } else {
            flexibleItems.push({ itemName, totalShipment });
        }
    });

    return { fixedAllocations, flexibleItems };
}

/**
 * 組付出庫数を取得
 */
function getTotalShipment(itemName, dateIndex, shift) {
    const totalShipmentRow = document.querySelector(
        `[data-section="total_shipment"][data-shift="${shift}"][data-item="${itemName}"]`
    );
    if (!totalShipmentRow) return 0;

    const totalShipmentCells = totalShipmentRow.querySelectorAll('.production-cell');
    if (!totalShipmentCells || totalShipmentCells.length <= dateIndex) return 0;

    const totalShipmentSpan = totalShipmentCells[dateIndex].querySelector('.total-shipment');
    return totalShipmentSpan ? (parseInt(totalShipmentSpan.textContent) || 0) : 0;
}

/**
 * 空の割り振りを作成
 */
function createEmptyAllocation(lineNames) {
    const allocation = {};
    lineNames.forEach(lineName => {
        allocation[lineName] = 0;
    });
    return allocation;
}

/**
 * 固定ラインへの割り振り
 */
function allocateToFixedLine(targetLine, totalShipment, lineNames, linesInfo) {
    const allocation = {};
    lineNames.forEach(lineName => {
        allocation[lineName] = lineName === targetLine ? totalShipment : 0;
    });

    if (linesInfo[targetLine]) {
        linesInfo[targetLine].currentProduction += totalShipment;
    }

    return allocation;
}

/**
 * 柔軟な品番を残業均等化で割り振り
 */
function allocateFlexibleItems(flexibleItems, lineNames, linesInfo) {
    const allocations = {};

    flexibleItems.forEach(item => {
        allocations[item.itemName] = allocateToMinimizeOvertime(
            item.totalShipment,
            lineNames,
            linesInfo
        );
    });

    return allocations;
}

/**
 * 残業時間が均等になるように割り振り
 */
function allocateToMinimizeOvertime(totalQuantity, availableLines, linesInfo) {
    const allocation = createEmptyAllocation(availableLines);
    const lineStatus = initializeLineStatus(availableLines, linesInfo);

    let remaining = totalQuantity;

    while (remaining > 0) {
        const targetLine = findBestLineForAllocation(availableLines, lineStatus);

        if (targetLine) {
            allocation[targetLine]++;
            remaining--;
            updateLineStatus(targetLine, lineStatus);
        } else {
            // フォールバック: 最初のラインに全て割り当て
            if (availableLines.length > 0) {
                allocation[availableLines[0]] += remaining;
            }
            break;
        }
    }

    // linesInfoを更新
    availableLines.forEach(lineName => {
        if (linesInfo[lineName]) {
            linesInfo[lineName].currentProduction += allocation[lineName];
        }
    });

    return allocation;
}

/**
 * ライン状態を初期化
 */
function initializeLineStatus(availableLines, linesInfo) {
    const lineStatus = {};

    availableLines.forEach(lineName => {
        const info = linesInfo[lineName];
        if (info && info.tact > 0) {
            const requiredTime = info.currentProduction * info.tact;
            const overtime = Math.max(0, requiredTime - info.availableTime);

            lineStatus[lineName] = {
                tact: info.tact,
                currentRequiredTime: requiredTime,
                currentOvertime: overtime,
                availableTime: info.availableTime
            };
        }
    });

    return lineStatus;
}

/**
 * 最適なライン（残業時間差が最小）を選択
 */
function findBestLineForAllocation(availableLines, lineStatus) {
    let minDifference = Infinity;
    let targetLine = null;

    availableLines.forEach(lineName => {
        if (!lineStatus[lineName]) return;

        const status = lineStatus[lineName];
        const newRequiredTime = status.currentRequiredTime + status.tact;
        const newOvertime = Math.max(0, newRequiredTime - status.availableTime);

        // 他のラインとの残業時間の最大差を計算
        let maxDiff = 0;
        availableLines.forEach(otherLineName => {
            if (otherLineName === lineName || !lineStatus[otherLineName]) return;
            const diff = Math.abs(newOvertime - lineStatus[otherLineName].currentOvertime);
            maxDiff = Math.max(maxDiff, diff);
        });

        if (maxDiff < minDifference) {
            minDifference = maxDiff;
            targetLine = lineName;
        }
    });

    return targetLine;
}

/**
 * ライン状態を更新
 */
function updateLineStatus(lineName, lineStatus) {
    lineStatus[lineName].currentRequiredTime += lineStatus[lineName].tact;
    lineStatus[lineName].currentOvertime = Math.max(
        0,
        lineStatus[lineName].currentRequiredTime - lineStatus[lineName].availableTime
    );
}

/**
 * 割り振り結果を入力フィールドに反映
 */
function applyAllocations(allocations, itemNames, lineNames, dateIndex, shift, linesInfo) {
    itemNames.forEach(itemName => {
        lineNames.forEach(lineName => {
            const sectionName = `line_${lineName.replace('#', '')}_shipment`;
            const input = document.querySelector(
                `[data-section="${sectionName}"] .production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
            );

            if (input) {
                const value = (allocations[itemName] && allocations[itemName][lineName]) || 0;
                input.value = value;

                // linesInfoのcurrentProductionを更新
                if (linesInfo && linesInfo[lineName]) {
                    linesInfo[lineName].currentProduction = (linesInfo[lineName].currentProduction || 0) + value;
                }
            }
        });
    });
}

// ========================================
// 保存処理
// ========================================
/**
 * データを収集してサーバーに送信
 */
function saveData() {
    const data = collectSaveData();

    const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;

    fetch(window.location.href, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken
        },
        body: JSON.stringify(data)
    })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                showToast('success', result.message || '保存しました');
            } else {
                showToast('error', result.message || '保存に失敗しました');
            }
        })
        .catch(error => {
            showToast('error', '保存中にエラーが発生しました: ' + error.message);
        });
}

/**
 * 保存用データを収集
 */
function collectSaveData() {
    const itemNames = getItemNames();
    const dateCount = document.querySelectorAll('.total-shipment').length / itemNames.length;

    const data = {
        action: 'save',
        line_type: lineType,
        year: year,
        month: month,
        dates: []
    };

    for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
        data.dates.push(collectDateData(dateIndex, itemNames));
    }

    return data;
}

/**
 * 1日分のデータを収集
 */
function collectDateData(dateIndex, itemNames) {
    const dateData = {
        date_index: dateIndex,
        items: {},
        overtime: {}  // 残業時間を追加
    };

    itemNames.forEach(itemName => {
        dateData.items[itemName] = {};

        ['day', 'night'].forEach(shift => {
            dateData.items[itemName][shift] = collectLineData(dateIndex, shift, itemName);
        });
    });

    // 各ラインの残業時間を収集
    const lineNames = Object.keys(tactsData);
    lineNames.forEach(lineName => {
        dateData.overtime[lineName] = {};
        ['day', 'night'].forEach(shift => {
            const overtimeSpan = document.querySelector(
                `.overtime-hours[data-line="${lineName}"][data-shift="${shift}"][data-date-index="${dateIndex}"]`
            );
            dateData.overtime[lineName][shift] = overtimeSpan ? (parseInt(overtimeSpan.textContent) || 0) : 0;
        });
    });

    return dateData;
}

/**
 * ライン別データを収集
 */
function collectLineData(dateIndex, shift, itemName) {
    const lineData = {};
    const lineInputs = document.querySelectorAll(
        `.production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
    );

    lineInputs.forEach((input) => {
        const row = input.closest('tr');
        const section = row ? row.getAttribute('data-section') : null;

        if (section && section !== 'total_shipment') {
            const lineMatch = section.match(/(line_.+)_shipment/);
            if (lineMatch) {
                const lineKey = lineMatch[1];
                lineData[lineKey] = parseInt(input.value) || 0;
            }
        }
    });

    return lineData;
}

// ========================================
// イベントリスナー設定
// ========================================
/**
 * 全イベントリスナーを設定
 */
function setupEventListeners() {
    // 保存ボタン
    document.getElementById('save-btn')?.addEventListener('click', saveData);

    // ライン選択変更
    $('#line-type-select').on('change', handleLineTypeChange);

    // 月選択変更
    document.getElementById('target-month')?.addEventListener('change', handleMonthChange);

    // 入力値変更時
    document.querySelectorAll('.production-input').forEach(input => {
        input.addEventListener('input', function () {
            updateMonthlyTotals();
            updateCellColors();
        });
    });
}

/**
 * ライン選択変更時の処理
 */
function handleLineTypeChange() {
    const selectedLineType = $(this).val();
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.set('line_type', selectedLineType);

    if (!urlParams.has('year')) urlParams.set('year', year);
    if (!urlParams.has('month')) urlParams.set('month', month);

    window.location.search = urlParams.toString();
}

/**
 * 月選択変更時の処理
 */
function handleMonthChange() {
    const [selectedYear, selectedMonth] = this.value.split('-');
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.set('year', selectedYear);
    urlParams.set('month', selectedMonth);

    if (!urlParams.has('line_type')) urlParams.set('line_type', lineType);

    window.location.search = urlParams.toString();
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

    tbody.addEventListener('mouseover', function(e) {
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

    tbody.addEventListener('mouseout', function(e) {
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
    // メインヘッダーの日付セル
    const mainHeaderCells = document.querySelectorAll(`thead th[data-date-index="${dateIndex}"]`);
    mainHeaderCells.forEach(cell => {
        cell.classList.add('date-hover');
    });

    // セクション日付ヘッダー
    const sectionHeaderCells = document.querySelectorAll(`.section-date-header th[data-date-index="${dateIndex}"]`);
    sectionHeaderCells.forEach(cell => {
        cell.classList.add('date-hover');
    });
}

/**
 * 日付ヘッダーからハイライトを削除
 */
function removeDateHighlight(dateIndex) {
    // メインヘッダーの日付セル
    const mainHeaderCells = document.querySelectorAll(`thead th[data-date-index="${dateIndex}"]`);
    mainHeaderCells.forEach(cell => {
        cell.classList.remove('date-hover');
    });

    // セクション日付ヘッダー
    const sectionHeaderCells = document.querySelectorAll(`.section-date-header th[data-date-index="${dateIndex}"]`);
    sectionHeaderCells.forEach(cell => {
        cell.classList.remove('date-hover');
    });
}


// ========================================
// 初期化
// ========================================
document.addEventListener('DOMContentLoaded', function () {
    // Select2初期化
    $('.select2').select2({
        theme: 'bootstrap-5',
        width: '100%'
    });

    // イベントリスナー設定
    setupEventListeners();

    // カラムホバーを設定
    setupColumnHover();

    // 既存データがない場合のみ自動割り振りを実行
    if (typeof hasExistingData !== 'undefined' && !hasExistingData) {
        autoAllocate();
    } else {
        updateMonthlyTotals();
    }
});
