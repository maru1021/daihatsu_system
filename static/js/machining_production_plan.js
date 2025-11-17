// ========================================
// 定数
// ========================================
const REGULAR_TIME_DAY = 455;
const REGULAR_TIME_NIGHT = 450;
const OVERTIME_MAX_DAY = 120;
const OVERTIME_MAX_NIGHT = 60;

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

// 品番リストを取得
function getItemNames() {
    const itemNames = [];
    document.querySelectorAll('[data-section="production"][data-shift="day"] .vehicle-label').forEach(label => {
        itemNames.push(label.textContent.trim());
    });
    return itemNames;
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

// 全品番の生産数を更新（共通処理）
function updateAllItemsProduction(dateIndex, shifts, forceRecalculate = false) {
    const itemNames = getItemNames();
    shifts.forEach(shift => {
        itemNames.forEach(itemName => {
            updateProductionQuantity(dateIndex, shift, itemName, forceRecalculate);
        });
    });
}

// ========================================
// 生産数自動計算機能
// 現在の生産数の比率を維持したまま再計算
// ========================================
function calculateProductionQuantity(dateIndex, shift, itemName) {
    const tact = itemData.tact || 0;
    if (tact === 0) return 0;

    const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
    const occupancyRate = occupancyRateInput ? (parseFloat(occupancyRateInput.value) || 0) / 100 : 0;
    if (occupancyRate === 0) return 0;

    const regularTime = shift === 'day' ? REGULAR_TIME_DAY : REGULAR_TIME_NIGHT;
    const overtimeInput = getInputElement(`.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`);
    const overtime = getInputValue(overtimeInput);
    const stopTimeInput = getInputElement(`.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`);
    const stopTime = getInputValue(stopTimeInput);

    const productionTime = regularTime + overtime - stopTime;
    if (productionTime <= 0) return 0;

    // 基本生産数 = 生産可能時間 / タクト * 稼働率（切り上げ）
    const baseQuantity = Math.ceil(productionTime / tact * occupancyRate);

    // 現在の生産数の比率を取得
    const itemNames = getItemNames();
    if (itemNames.length === 0) return 0;

    let currentTotal = 0;
    const currentValues = {};

    itemNames.forEach(name => {
        const input = getInputElement(`.production-input[data-shift="${shift}"][data-item="${name}"][data-date-index="${dateIndex}"]`);
        const value = input && input.style.display !== 'none' ? (parseInt(input.value) || 0) : 0;
        currentValues[name] = value;
        currentTotal += value;
    });

    // 現在値がない場合は均等割り
    if (currentTotal === 0) {
        return Math.round(baseQuantity / itemNames.length);
    }

    // 現在の比率を維持して配分
    const ratio = currentValues[itemName] / currentTotal;
    return Math.round(baseQuantity * ratio);
}

// 生産数の入力フィールドを更新
function updateProductionQuantity(dateIndex, shift, itemName, forceUpdate = false) {
    const productionInput = getInputElement(
        `.production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
    );

    if (!productionInput || productionInput.style.display === 'none') return;

    // 強制更新フラグがfalseで既にデータが入力されている場合はスキップ
    // 値が空文字列でなければデータが入力されていると判断（0も含む）
    if (!forceUpdate && productionInput.value !== '') {
        return;
    }

    const quantity = calculateProductionQuantity(dateIndex, shift, itemName);
    if (quantity > 0) {
        productionInput.value = quantity;
    } else if (forceUpdate) {
        productionInput.value = '';
    }
}

// すべての生産数を更新
function updateAllProductionQuantities() {
    const dateCount = document.querySelectorAll('.operation-rate-input').length;
    const itemNames = getItemNames();

    for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
        itemNames.forEach(itemName => {
            updateProductionQuantity(dateIndex, 'day', itemName);
            updateProductionQuantity(dateIndex, 'night', itemName);
        });
    }

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
// DB基準値 + 通常計算
function updateStockQuantities() {
    console.log('updateStockQuantities called');
    const itemNames = getItemNames();
    const dateCount = document.querySelectorAll('.operation-rate-input').length;

    itemNames.forEach(itemName => {
        // 前月末の在庫から開始（データがなければ0）
        let calculatedStock = (typeof previousMonthStocks !== 'undefined' && previousMonthStocks[itemName])
            ? previousMonthStocks[itemName]
            : 0;
        console.log(`Item: ${itemName}, Starting stock: ${calculatedStock}`);

        for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
            // 日勤の生産数、出庫数、在庫数を取得
            const dayProductionInput = getInputElement(`.production-input[data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
            const dayShipmentInput = getInputElement(`.shipment-input[data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
            const dayStockInput = getInputElement(`.stock-input[data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);

            // 夜勤の生産数と出庫数を取得
            const nightProductionInput = getInputElement(`.production-input[data-shift="night"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
            const nightShipmentInput = getInputElement(`.shipment-input[data-shift="night"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
            const nightStockInput = getInputElement(`.stock-input[data-shift="night"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);

            // 日勤の在庫計算
            if (dayStockInput && dayStockInput.style.display !== 'none') {
                const dayProduction = dayProductionInput ? (parseInt(dayProductionInput.value) || 0) : 0;
                const dayShipment = dayShipmentInput ? (parseInt(dayShipmentInput.value) || 0) : 0;

                // 通常計算: 前日在庫 + 生産数 - 出庫数
                calculatedStock = calculatedStock + dayProduction - dayShipment;

                // DB基準値を取得して加算
                const dbStockBase = dayStockInput.dataset.dbStockBase
                    ? parseInt(dayStockInput.dataset.dbStockBase)
                    : 0;

                const finalStock = calculatedStock + dbStockBase;
                dayStockInput.value = finalStock;

                console.log(`Date ${dateIndex} Day: calculated=${calculatedStock}, dbBase=${dbStockBase}, final=${finalStock}`);

                // 次の日のために、計算値を更新（DB基準値は加えない）
                // calculatedStockはそのまま
            }

            // 夜勤の在庫計算
            if (nightStockInput && nightStockInput.style.display !== 'none') {
                const nightProduction = nightProductionInput ? (parseInt(nightProductionInput.value) || 0) : 0;
                const nightShipment = nightShipmentInput ? (parseInt(nightShipmentInput.value) || 0) : 0;

                // 通常計算: 日勤終了時在庫 + 生産数 - 出庫数
                calculatedStock = calculatedStock + nightProduction - nightShipment;

                // DB基準値を取得して加算
                const dbStockBase = nightStockInput.dataset.dbStockBase
                    ? parseInt(nightStockInput.dataset.dbStockBase)
                    : 0;

                const finalStock = calculatedStock + dbStockBase;
                nightStockInput.value = finalStock;

                // 次の日のために、計算値を更新（DB基準値は加えない）
                // calculatedStockはそのまま
            }
        }
    });
}

// 在庫差分を計算（生産数 - 出庫数）
function updateStockDifferences() {
    const itemNames = getItemNames();

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
const debouncedUpdateWorkingDayStatus = debounce(function (dateIndex) {
    updateWorkingDayStatus(dateIndex);
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

    const dateIndex = Array.from(element.parentElement.children).indexOf(element) - 1;
    debouncedUpdateWorkingDayStatus(dateIndex);

    // 合計と在庫を更新（表示状態が変更された後に実行）
    setTimeout(() => {
        updateRowTotals();
        updateStockQuantities();
    }, 150);
}

// 入力フィールドの表示/非表示を制御
function toggleInputs(dateIndex, shift, show) {
    const selector = `[data-shift="${shift}"][data-date-index="${dateIndex}"] input`;
    document.querySelectorAll(selector).forEach(input => {
        input.style.display = show ? '' : 'none';
    });
}

// 残業上限を設定
function setOvertimeLimit(dateIndex, shift, max) {
    const input = getInputElement(`.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`);
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
    document.querySelectorAll('.check-cell').forEach((checkCell, index) => {
        const dateIndex = index;
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
                updateWorkingDayStatus(dateIndex, true);
            } else if (hasAssemblyWeekendWork) {
                // パターン2: 組付側のみ休出データあり（出庫数入力のみ表示）
                checkCell.textContent = '';
                checkCell.setAttribute('data-regular-hours', 'false');

                const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
                if (occupancyRateInput) {
                    occupancyRateInput.style.display = 'none';
                }

                toggleInputs(dateIndex, 'day', false);
                toggleInputs(dateIndex, 'night', false);

                // 出庫数入力のみ表示
                document.querySelectorAll(`.shipment-input[data-shift="day"][data-date-index="${dateIndex}"]`).forEach(input => {
                    input.style.display = '';
                });
            } else {
                // パターン3: 休出データなし（すべて非表示）
                checkCell.textContent = '';
                checkCell.setAttribute('data-regular-hours', 'false');

                const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
                if (occupancyRateInput) {
                    occupancyRateInput.style.display = 'none';
                }

                toggleInputs(dateIndex, 'day', false);
                toggleInputs(dateIndex, 'night', false);
            }
        } else {
            // 平日の初期化処理
            if (isRegularHours) {
                checkCell.textContent = '定時';
                checkCell.setAttribute('data-regular-hours', 'true');
                updateWorkingDayStatus(dateIndex, true);
            }
        }
    });
}

// 稼働日状態の更新
function updateWorkingDayStatus(dateIndex, isInitializing = false) {
    const checkCells = document.querySelectorAll('.check-cell');
    const checkCell = checkCells[dateIndex];
    if (!checkCell) return;

    const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
    const checkText = checkCell.textContent.trim();

    if (isWeekend) {
        // 週末の処理
        const isWorking = checkText === '休出';

        // 稼働率入力の表示制御
        const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
        if (occupancyRateInput) {
            occupancyRateInput.style.display = isWorking ? '' : 'none';
        }

        if (isWorking) {
            // 休出あり: すべての入力フィールドを表示
            toggleInputs(dateIndex, 'day', true);
            toggleInputs(dateIndex, 'night', false); // 夜勤は週末常に非表示
        } else {
            // 休出なし: 出庫数のみ表示
            toggleInputs(dateIndex, 'day', false);
            toggleInputs(dateIndex, 'night', false);
            document.querySelectorAll(`.shipment-input[data-shift="day"][data-date-index="${dateIndex}"]`).forEach(input => {
                input.style.display = '';
            });
        }

        // 残業計画の上限値を設定（休出は残業0）
        setOvertimeLimit(dateIndex, 'day', isWorking ? 0 : 0);
        setOvertimeLimit(dateIndex, 'night', isWorking ? 0 : 0);

        // 休出の場合、初期化時以外は生産数を計算
        if (isWorking && !isInitializing) {
            updateAllItemsProduction(dateIndex, ['day'], false);
        }
    } else {
        // 平日の場合
        const isWorking = checkText === '定時';

        if (isWorking) {
            // 定時をつける場合
            const dayOvertimeInput = getInputElement(`.overtime-input[data-shift="day"][data-date-index="${dateIndex}"]`);
            const currentOvertime = dayOvertimeInput ? (parseInt(dayOvertimeInput.value) || 0) : 0;
            const isOvertimeAlreadyZero = currentOvertime === 0;

            if (dayOvertimeInput) {
                dayOvertimeInput.setAttribute('max', 0);
                // 残業時間が0でない場合のみ0に設定
                if (!isOvertimeAlreadyZero) {
                    dayOvertimeInput.dataset.programmaticChange = 'true';
                    dayOvertimeInput.value = '0';
                    setTimeout(() => {
                        delete dayOvertimeInput.dataset.programmaticChange;
                    }, 0);
                }
            }

            setOvertimeLimit(dateIndex, 'night', OVERTIME_MAX_NIGHT);

            // 初期化時以外は日勤の生産数を処理
            if (!isInitializing) {
                const itemNames = getItemNames();

                // 既に保存値がある場合はそれを使用、ない場合は計算
                const hasRegularValues = itemNames.some(itemName => {
                    const productionInput = getInputElement(
                        `.production-input[data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
                    );
                    return productionInput && productionInput.dataset.regularValue;
                });

                if (hasRegularValues) {
                    // 既に保存値がある場合は復元
                    itemNames.forEach(itemName => {
                        const productionInput = getInputElement(
                            `.production-input[data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
                        );
                        if (productionInput && productionInput.style.display !== 'none' && productionInput.dataset.regularValue) {
                            productionInput.value = productionInput.dataset.regularValue;
                        }
                    });
                } else {
                    // 初回の定時ON時：定時時間での生産数を計算
                    if (isOvertimeAlreadyZero) {
                        // 残業時間が既に0の場合は現在の値をそのまま保存
                        itemNames.forEach(itemName => {
                            const productionInput = getInputElement(
                                `.production-input[data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
                            );
                            if (productionInput && productionInput.style.display !== 'none') {
                                productionInput.dataset.regularValue = productionInput.value || '0';
                            }
                        });
                    } else {
                        // 残業時間が0でない場合：定時時間で計算して比率を維持
                        const tact = itemData.tact || 0;
                        if (tact > 0) {
                            const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
                            const occupancyRate = occupancyRateInput ? (parseFloat(occupancyRateInput.value) || 0) / 100 : 0;

                            if (occupancyRate > 0) {
                                const stopTimeInput = getInputElement(`.stop-time-input[data-shift="day"][data-date-index="${dateIndex}"]`);
                                const stopTime = getInputValue(stopTimeInput);
                                const productionTime = REGULAR_TIME_DAY - stopTime;
                                const targetTotal = Math.ceil(productionTime / tact * occupancyRate);

                                // 現在の生産数の比率を取得
                                let currentTotal = 0;
                                const currentValues = {};

                                itemNames.forEach(itemName => {
                                    const productionInput = getInputElement(
                                        `.production-input[data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
                                    );
                                    if (productionInput && productionInput.style.display !== 'none') {
                                        const value = parseInt(productionInput.value) || 0;
                                        currentValues[itemName] = value;
                                        currentTotal += value;
                                    }
                                });

                                // 比率を維持して定時時間の生産数に調整
                                if (currentTotal === 0) {
                                    // 現在値が0の場合は均等割り
                                    const perItemProduction = Math.round(targetTotal / itemNames.length);
                                    itemNames.forEach(itemName => {
                                        const productionInput = getInputElement(
                                            `.production-input[data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
                                        );
                                        if (productionInput && productionInput.style.display !== 'none') {
                                            productionInput.value = perItemProduction;
                                            productionInput.dataset.regularValue = perItemProduction.toString();
                                        }
                                    });
                                } else {
                                    // 現在の比率を維持
                                    const distributions = [];

                                    itemNames.forEach(itemName => {
                                        const productionInput = getInputElement(
                                            `.production-input[data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
                                        );
                                        if (productionInput && productionInput.style.display !== 'none') {
                                            const ratio = currentValues[itemName] / currentTotal;
                                            const exactValue = targetTotal * ratio;
                                            const floorValue = Math.floor(exactValue);
                                            const fraction = exactValue - floorValue;

                                            distributions.push({
                                                itemName: itemName,
                                                input: productionInput,
                                                floorValue: floorValue,
                                                fraction: fraction
                                            });
                                        }
                                    });

                                    // 床値の合計を計算
                                    const floorTotal = distributions.reduce((sum, d) => sum + d.floorValue, 0);
                                    const remainder = targetTotal - floorTotal;

                                    // 小数点以下が大きい順にソート
                                    distributions.sort((a, b) => b.fraction - a.fraction);

                                    // 余りの分だけ小数点以下が大きいものから+1
                                    distributions.forEach((dist, index) => {
                                        const finalValue = dist.floorValue + (index < remainder ? 1 : 0);
                                        dist.input.value = finalValue;
                                        dist.input.dataset.regularValue = finalValue.toString();
                                    });
                                }
                            }
                        }
                    }
                }
            }
        } else {
            // 定時を消す場合：残業上限を元に戻すのみ（値は変更しない、再計算もしない）
            const dayOvertimeInput = getInputElement(`.overtime-input[data-shift="day"][data-date-index="${dateIndex}"]`);
            if (dayOvertimeInput) {
                dayOvertimeInput.removeAttribute('max');
                dayOvertimeInput.setAttribute('max', OVERTIME_MAX_DAY);
            }

            const nightOvertimeInput = getInputElement(`.overtime-input[data-shift="night"][data-date-index="${dateIndex}"]`);
            if (nightOvertimeInput) {
                nightOvertimeInput.removeAttribute('max');
                nightOvertimeInput.setAttribute('max', OVERTIME_MAX_NIGHT);
            }

            // 定時を消す場合は再計算しない（値をそのまま維持）
        }
    }
}

// ========================================
// ライン・月選択変更処理
// ========================================
function handleLineChange() {
    const lineId = $('#line-select').val();
    const targetMonth = $('#target-month').val();
    if (lineId && targetMonth) {
        const [year, month] = targetMonth.split('-');
        window.location.href = `?line=${lineId}&year=${year}&month=${month}`;
    }
}

function handleMonthChange() {
    const lineId = $('#line-select').val();
    const targetMonth = $('#target-month').val();
    if (lineId && targetMonth) {
        const [year, month] = targetMonth.split('-');
        window.location.href = `?line=${lineId}&year=${year}&month=${month}`;
    }
}

// ========================================
// 保存機能
// ========================================
function saveProductionPlan() {
    const saveBtn = document.getElementById('save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';

    const dateCount = document.querySelectorAll('.operation-rate-input').length;
    const itemNames = getItemNames();
    const datesData = [];
    const datesToDelete = []; // 削除する日付のインデックス

    for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
        const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
        const checkCell = document.querySelector(`.check-cell[data-date-index="${dateIndex}"]`);
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
                const shipmentInput = getInputElement(`.shipment-input[data-shift="day"][data-item="${itemName}"][data-date-index="${dateIndex}"]`);
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
            const stopTimeInput = getInputElement(`.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`);
            const overtimeInput = getInputElement(`.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`);

            const shiftData = {
                stop_time: getInputValue(stopTimeInput),
                overtime: getInputValue(overtimeInput),
                items: {}
            };

            itemNames.forEach(itemName => {
                const productionInput = getInputElement(
                    `.production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
                );
                const shipmentInput = getInputElement(
                    `.shipment-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
                );
                const stockInput = getInputElement(
                    `.stock-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
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

    // CSRFトークンを取得
    const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;
    const lineId = $('#line-select').val();
    const targetMonth = $('#target-month').val();
    const [year, month] = targetMonth.split('-');

    // デバッグ用：送信データを確認
    console.log('保存データ:', {
        dates_data: datesData,
        dates_to_delete: datesToDelete
    });

    // 保存リクエスト送信
    fetch(`?line=${lineId}&year=${year}&month=${month}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken
        },
        body: JSON.stringify({
            dates_data: datesData,
            dates_to_delete: datesToDelete
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
            console.error('Error:', error);
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
function recalculateOvertimeFromProduction(dateIndex, shift, itemName) {
    const tact = itemData.tact || 0;
    if (tact === 0) return true;

    const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
    if (!occupancyRateInput || occupancyRateInput.style.display === 'none') return true;
    const occupancyRate = (parseFloat(occupancyRateInput.value) || 0) / 100;
    if (occupancyRate === 0) return true;

    const overtimeInput = getInputElement(`.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`);
    if (!overtimeInput || overtimeInput.style.display === 'none') return true;

    const stopTimeInput = getInputElement(`.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`);
    const stopTime = getInputValue(stopTimeInput);
    const regularTime = shift === 'day' ? REGULAR_TIME_DAY : REGULAR_TIME_NIGHT;

    // 全品番の生産数を合計
    const itemNames = getItemNames();
    let totalProduction = 0;
    itemNames.forEach(name => {
        const productionInput = getInputElement(`.production-input[data-shift="${shift}"][data-item="${name}"][data-date-index="${dateIndex}"]`);
        if (productionInput && productionInput.style.display !== 'none') {
            totalProduction += parseInt(productionInput.value) || 0;
        }
    });

    if (totalProduction === 0) {
        overtimeInput.value = 0;
        return true;
    }

    // 定時間で生産できる台数を計算（全車種の合計）
    const regularProductionTime = regularTime - stopTime;
    const regularTotalProduction = regularProductionTime > 0
        ? Math.ceil(regularProductionTime / tact * occupancyRate)
        : 0;

    // 残業で必要な追加生産数
    const additionalProduction = totalProduction - regularTotalProduction;

    if (additionalProduction <= 0) {
        overtimeInput.value = 0;
        return true;
    }

    // 残業時間を逆算
    let calculatedOvertime = (additionalProduction * tact) / occupancyRate;
    calculatedOvertime = Math.max(0, calculatedOvertime);

    const maxOvertime = shift === 'day' ? OVERTIME_MAX_DAY : OVERTIME_MAX_NIGHT;

    // 残業上限を超える場合
    if (calculatedOvertime > maxOvertime) {
        const shiftName = shift === 'day' ? '日勤' : '夜勤';
        const date = document.querySelector(`.check-cell[data-date-index="${dateIndex}"]`)?.getAttribute('data-date');
        showToast('error', `${date} ${shiftName}：残業時間が上限に達しています。`);
        return false;
    }

    // 5分刻みに丸める
    calculatedOvertime = Math.round(calculatedOvertime / 5) * 5;
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

            updateAllItemsProduction(dateIndex, [shift], true);
            updateRowTotals();
            updateStockQuantities();
        });
    });

    // 稼働率の変更時に生産数を再計算
    document.querySelectorAll('.operation-rate-input').forEach(input => {
        input.addEventListener('input', function () {
            const dateIndex = parseInt(this.getAttribute('data-date-index'));
            updateAllItemsProduction(dateIndex, ['day', 'night'], true);
            updateRowTotals();
            updateStockQuantities();
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

            // 定時ONかつ日勤の場合、定時での生産可能数を超えないかチェック
            if (shift === 'day') {
                const checkCell = document.querySelector(`.check-cell[data-date-index="${dateIndex}"]`);
                const isRegularHours = checkCell && checkCell.getAttribute('data-regular-hours') === 'true';

                if (isRegularHours) {
                    // 定時での生産可能数の上限を計算
                    const tact = itemData.tact || 0;
                    if (tact > 0) {
                        const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
                        const occupancyRate = occupancyRateInput ? (parseFloat(occupancyRateInput.value) || 0) / 100 : 0;

                        if (occupancyRate > 0) {
                            const stopTimeInput = getInputElement(`.stop-time-input[data-shift="day"][data-date-index="${dateIndex}"]`);
                            const stopTime = getInputValue(stopTimeInput);
                            const productionTime = REGULAR_TIME_DAY - stopTime;
                            const maxProduction = Math.ceil(productionTime / tact * occupancyRate);

                            // 全品番の生産数合計を計算（今入力している値を含む）
                            const itemNames = getItemNames();
                            let totalProduction = 0;
                            itemNames.forEach(name => {
                                const prodInput = getInputElement(`.production-input[data-shift="day"][data-item="${name}"][data-date-index="${dateIndex}"]`);
                                if (prodInput && prodInput.style.display !== 'none') {
                                    if (name === itemName) {
                                        totalProduction += parseInt(this.value) || 0;
                                    } else {
                                        totalProduction += parseInt(prodInput.value) || 0;
                                    }
                                }
                            });

                            if (totalProduction > maxProduction) {
                                const date = checkCell.getAttribute('data-date');
                                showToast('error', `${date} 日勤：定時の場合は生産数合計を${maxProduction}以下にしてください。`);
                                this.value = previousValue;
                                return;
                            }
                        }
                    }
                }
            }

            isRecalculating = true;

            const isValid = recalculateOvertimeFromProduction(dateIndex, shift, itemName);

            if (!isValid) {
                this.value = previousValue;
                isRecalculating = false;
                return;
            } else {
                previousValue = this.value;
            }

            updateRowTotals();
            updateStockQuantities();

            isRecalculating = false;
        });
    });

    // 出庫数の変更時に在庫を再計算
    document.querySelectorAll('.shipment-input').forEach(input => {
        input.addEventListener('input', function () {
            updateRowTotals();
            updateStockQuantities();
        });
    });
}

// ========================================
// 初期化処理
// ========================================
$(document).ready(function () {
    // Select2の初期化
    $('#line-select').select2({
        theme: 'bootstrap-5',
        width: 'resolve'
    });

    // イベントリスナー設定
    $('#line-select').on('change', handleLineChange);
    $('#target-month').on('change', handleMonthChange);
    $('#save-btn').on('click', saveProductionPlan);

    // 週末の休出状態を初期化
    initializeWeekendWorkingStatus();

    // イベントリスナーを設定
    setupEventListeners();

    // 初期表示時にすべての生産数を計算
    updateAllProductionQuantities();

    // 在庫数の元のDB値をdata-db-stock-base属性に保存（計算時に加算する基準値）
    // data-has-db-value 属性がある場合のみ保存（DBに実際にデータがある場合）
    document.querySelectorAll('.stock-input').forEach(input => {
        if (input.dataset.hasDbValue === 'true') {
            input.dataset.dbStockBase = input.value;
            console.log(`Saved DB stock base for ${input.dataset.item} date ${input.dataset.dateIndex}: ${input.value}`);
        } else {
            input.dataset.dbStockBase = '0';
        }
    });

    // 在庫数はページ読み込み時には計算しない（データベースの値をそのまま使用）
    // 生産数・出庫数変更時のイベントリスナーで計算される
});
