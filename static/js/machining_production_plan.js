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
    const itemNames = [];
    document.querySelectorAll('[data-section="production"][data-shift="day"] .vehicle-label').forEach(label => {
        itemNames.push(label.textContent.trim());
    });

    const datesData = [];

    for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
        const occupancyRateInput = document.querySelector(`.operation-rate-input[data-date-index="${dateIndex}"]`);

        // 非表示の場合はこの日付をスキップ
        if (occupancyRateInput && occupancyRateInput.style.display === 'none') {
            continue;
        }

        const occupancyRate = occupancyRateInput ? (parseFloat(occupancyRateInput.value) || 0) : 0;

        // 定時チェックの状態を取得
        const checkCell = document.querySelector(`.check-cell[data-date-index="${dateIndex}"]`);
        const isRegularWorkingHours = checkCell ? checkCell.getAttribute('data-regular-hours') === 'true' : false;

        // シフトデータを構築
        const buildShiftData = (shift) => {
            const stopTimeInput = document.querySelector(`.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`);
            const overtimeInput = document.querySelector(`.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`);

            const shiftData = {
                stop_time: stopTimeInput && stopTimeInput.style.display !== 'none' ? (parseInt(stopTimeInput.value) || 0) : 0,
                overtime: overtimeInput && overtimeInput.style.display !== 'none' ? (parseInt(overtimeInput.value) || 0) : 0,
                items: {}
            };

            itemNames.forEach(itemName => {
                const productionInput = document.querySelector(
                    `.production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
                );
                const stockInput = document.querySelector(
                    `.stock-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
                );
                const shipmentInput = document.querySelector(
                    `.shipment-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
                );

                if (productionInput && productionInput.style.display !== 'none') {
                    shiftData.items[itemName] = {
                        production_quantity: parseInt(productionInput.value) || 0,
                        stock: stockInput && stockInput.style.display !== 'none' ? (parseInt(stockInput.value) || 0) : 0,
                        shipment: shipmentInput && shipmentInput.style.display !== 'none' ? (parseInt(shipmentInput.value) || 0) : 0
                    };
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

    // 保存リクエスト送信
    fetch(`?line=${lineId}&year=${year}&month=${month}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken
        },
        body: JSON.stringify({ dates_data: datesData })
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
// 定時・休出チェック機能
// ========================================
function toggleCheck(element) {
    const isWeekend = element.getAttribute('data-weekend') === 'true';
    const currentText = element.textContent;

    const newText = currentText === '' ? (isWeekend ? '休出' : '定時') : '';
    element.textContent = newText;

    // data-regular-hours属性を更新
    element.setAttribute('data-regular-hours', newText === '定時' ? 'true' : 'false');

    const dateIndex = Array.from(element.parentElement.children).indexOf(element) - 1;
    updateWorkingDayStatus(dateIndex);
}

// 入力フィールドの表示/非表示を制御
function toggleInputs(dateIndex, shift, show) {
    const selector = `[data-shift="${shift}"][data-date-index="${dateIndex}"] input`;
    document.querySelectorAll(selector).forEach(input => {
        input.style.display = show ? '' : 'none';
    });
}

// 週末の休出状態を初期化
function initializeWeekendWorkingStatus() {
    document.querySelectorAll('.check-cell').forEach((checkCell, index) => {
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        if (!isWeekend) return;

        const hasWeekendWork = checkCell.getAttribute('data-has-weekend-work') === 'true';
        const hasAssemblyWeekendWork = checkCell.getAttribute('data-has-assembly-weekend-work') === 'true';

        if (hasWeekendWork) {
            checkCell.textContent = '休出';
            checkCell.setAttribute('data-regular-hours', 'false');
        } else if (hasAssemblyWeekendWork) {
            // 組付側に休出がある場合は、出庫数のinputのみ表示
            checkCell.textContent = '';
            checkCell.setAttribute('data-regular-hours', 'false');
            const dateIndex = index;

            // 稼働率の入力フィールドを非表示
            const occupancyRateInput = document.querySelector(`.operation-rate-input[data-date-index="${dateIndex}"]`);
            if (occupancyRateInput) {
                occupancyRateInput.style.display = 'none';
            }

            // 生産数、在庫数、残業計画、計画停止を非表示
            toggleInputs(dateIndex, 'day', false);
            toggleInputs(dateIndex, 'night', false);

            // 出庫数のinputのみ表示（日勤のみ）
            document.querySelectorAll(`.shipment-input[data-shift="day"][data-date-index="${dateIndex}"]`).forEach(input => {
                input.style.display = '';
            });
        } else {
            checkCell.textContent = '';
            checkCell.setAttribute('data-regular-hours', 'false');
            const dateIndex = index;

            // 稼働率の入力フィールドを非表示
            const occupancyRateInput = document.querySelector(`.operation-rate-input[data-date-index="${dateIndex}"]`);
            if (occupancyRateInput) {
                occupancyRateInput.style.display = 'none';
            }

            toggleInputs(dateIndex, 'day', false);
            toggleInputs(dateIndex, 'night', false);
        }
    });
}

// 稼働日状態の更新
function updateWorkingDayStatus(dateIndex) {
    const checkCells = document.querySelectorAll('.check-cell');
    const checkCell = checkCells[dateIndex];
    if (!checkCell) return;

    const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
    const checkText = checkCell.textContent.trim();

    if (isWeekend) {
        // 週末の場合
        const isWorking = checkText === '休出';

        // 稼働率の入力フィールドを制御
        const occupancyRateInput = document.querySelector(`.operation-rate-input[data-date-index="${dateIndex}"]`);
        if (occupancyRateInput) {
            occupancyRateInput.style.display = isWorking ? '' : 'none';
        }

        toggleInputs(dateIndex, 'day', isWorking);
        toggleInputs(dateIndex, 'night', false); // 夜勤は週末は常に非表示
    }
}

// ========================================
// 合計値計算機能
// ========================================
// 行の合計値を計算して表示
function updateRowTotals() {
    const itemNames = [];
    document.querySelectorAll('[data-section="production"][data-shift="day"] .vehicle-label').forEach(label => {
        itemNames.push(label.textContent.trim());
    });

    itemNames.forEach(itemName => {
        // 出庫数の日勤の月間合計
        let shipmentDayTotal = 0;
        document.querySelectorAll(`.shipment-input[data-shift="day"][data-item="${itemName}"]`).forEach(input => {
            if (input.style.display !== 'none') {
                shipmentDayTotal += parseInt(input.value) || 0;
            }
        });

        // 出庫数の夜勤の月間合計
        let shipmentNightTotal = 0;
        document.querySelectorAll(`.shipment-input[data-shift="night"][data-item="${itemName}"]`).forEach(input => {
            if (input.style.display !== 'none') {
                shipmentNightTotal += parseInt(input.value) || 0;
            }
        });

        // 出庫数の日勤月間合計を表示
        const shipmentDayRow = document.querySelector(`[data-section="shipment"][data-shift="day"][data-item="${itemName}"]`);
        if (shipmentDayRow) {
            const monthlyTotalCell = shipmentDayRow.querySelector('.monthly-total');
            if (monthlyTotalCell) {
                monthlyTotalCell.textContent = shipmentDayTotal > 0 ? shipmentDayTotal : '';
                monthlyTotalCell.style.fontWeight = 'bold';
                monthlyTotalCell.style.textAlign = 'center';
            }
        }

        // 出庫数の夜勤月間合計を表示
        const shipmentNightRow = document.querySelector(`[data-section="shipment"][data-shift="night"][data-item="${itemName}"]`);
        if (shipmentNightRow) {
            const monthlyTotalCell = shipmentNightRow.querySelector('.monthly-total');
            if (monthlyTotalCell) {
                monthlyTotalCell.textContent = shipmentNightTotal > 0 ? shipmentNightTotal : '';
                monthlyTotalCell.style.fontWeight = 'bold';
                monthlyTotalCell.style.textAlign = 'center';
            }
        }

        // 出庫数の日勤+夜勤の合計を表示
        const shipmentDailyTotal = shipmentDayTotal + shipmentNightTotal;
        const shipmentDailyTotalCell = document.querySelector(`[data-section="shipment"][data-shift="day"][data-item="${itemName}"] .shipment-daily-total`);
        if (shipmentDailyTotalCell) {
            shipmentDailyTotalCell.textContent = shipmentDailyTotal > 0 ? shipmentDailyTotal : '';
            shipmentDailyTotalCell.style.fontWeight = 'bold';
            shipmentDailyTotalCell.style.textAlign = 'center';
            shipmentDailyTotalCell.style.backgroundColor = '#e0f2fe';
        }

        // 生産数の日勤の月間合計
        let productionDayTotal = 0;
        document.querySelectorAll(`.production-input[data-shift="day"][data-item="${itemName}"]`).forEach(input => {
            if (input.style.display !== 'none' && !input.classList.contains('shipment-input') && !input.classList.contains('stock-input')) {
                productionDayTotal += parseInt(input.value) || 0;
            }
        });

        // 生産数の夜勤の月間合計
        let productionNightTotal = 0;
        document.querySelectorAll(`.production-input[data-shift="night"][data-item="${itemName}"]`).forEach(input => {
            if (input.style.display !== 'none' && !input.classList.contains('shipment-input') && !input.classList.contains('stock-input')) {
                productionNightTotal += parseInt(input.value) || 0;
            }
        });

        // 生産数の日勤月間合計を表示
        const productionDayRow = document.querySelector(`[data-section="production"][data-shift="day"][data-item="${itemName}"]`);
        if (productionDayRow) {
            const monthlyTotalCell = productionDayRow.querySelector('.monthly-total');
            if (monthlyTotalCell) {
                monthlyTotalCell.textContent = productionDayTotal > 0 ? productionDayTotal : '';
                monthlyTotalCell.style.fontWeight = 'bold';
                monthlyTotalCell.style.textAlign = 'center';
            }
        }

        // 生産数の夜勤月間合計を表示
        const productionNightRow = document.querySelector(`[data-section="production"][data-shift="night"][data-item="${itemName}"]`);
        if (productionNightRow) {
            const monthlyTotalCell = productionNightRow.querySelector('.monthly-total');
            if (monthlyTotalCell) {
                monthlyTotalCell.textContent = productionNightTotal > 0 ? productionNightTotal : '';
                monthlyTotalCell.style.fontWeight = 'bold';
                monthlyTotalCell.style.textAlign = 'center';
            }
        }

        // 生産数の日勤+夜勤の合計を表示
        const productionDailyTotal = productionDayTotal + productionNightTotal;
        const dailyTotalCell = document.querySelector(`[data-section="production"][data-shift="day"][data-item="${itemName}"] .daily-total`);
        if (dailyTotalCell) {
            dailyTotalCell.textContent = productionDailyTotal > 0 ? productionDailyTotal : '';
            dailyTotalCell.style.fontWeight = 'bold';
            dailyTotalCell.style.textAlign = 'center';
            dailyTotalCell.style.backgroundColor = '#e0f2fe';
        }

        // 在庫数の日勤の月間合計
        let stockDayTotal = 0;
        document.querySelectorAll(`.stock-input[data-shift="day"][data-item="${itemName}"]`).forEach(input => {
            if (input.style.display !== 'none') {
                stockDayTotal += parseInt(input.value) || 0;
            }
        });

        // 在庫数の夜勤の月間合計
        let stockNightTotal = 0;
        document.querySelectorAll(`.stock-input[data-shift="night"][data-item="${itemName}"]`).forEach(input => {
            if (input.style.display !== 'none') {
                stockNightTotal += parseInt(input.value) || 0;
            }
        });

        // 在庫数の日勤月間合計を表示
        const stockDayRow = document.querySelector(`[data-section="stock"][data-shift="day"][data-item="${itemName}"]`);
        if (stockDayRow) {
            const monthlyTotalCell = stockDayRow.querySelector('.monthly-total');
            if (monthlyTotalCell) {
                monthlyTotalCell.textContent = stockDayTotal > 0 ? stockDayTotal : '';
                monthlyTotalCell.style.fontWeight = 'bold';
                monthlyTotalCell.style.textAlign = 'center';
            }
        }

        // 在庫数の夜勤月間合計を表示
        const stockNightRow = document.querySelector(`[data-section="stock"][data-shift="night"][data-item="${itemName}"]`);
        if (stockNightRow) {
            const monthlyTotalCell = stockNightRow.querySelector('.monthly-total');
            if (monthlyTotalCell) {
                monthlyTotalCell.textContent = stockNightTotal > 0 ? stockNightTotal : '';
                monthlyTotalCell.style.fontWeight = 'bold';
                monthlyTotalCell.style.textAlign = 'center';
            }
        }

        // 在庫数の差分（生産数 - 出庫数）を計算して表示
        const stockDifference = productionDailyTotal - shipmentDailyTotal;
        const stockDifferenceCell = document.querySelector(`[data-section="stock"][data-shift="day"][data-item="${itemName}"] .stock-difference`);
        if (stockDifferenceCell) {
            stockDifferenceCell.textContent = stockDifference !== 0 ? stockDifference : '';
            stockDifferenceCell.style.fontWeight = 'bold';
            stockDifferenceCell.style.textAlign = 'center';
            stockDifferenceCell.style.backgroundColor = '#e0f2fe';
        }
    });

    // 残業計画の合計
    ['day', 'night'].forEach(shift => {
        const overtimeRow = document.querySelector(`[data-section="overtime"][data-shift="${shift}"]`);
        if (overtimeRow) {
            let total = 0;
            overtimeRow.querySelectorAll('.overtime-input').forEach(input => {
                if (input.style.display !== 'none') {
                    total += parseInt(input.value) || 0;
                }
            });
            const monthlyTotalCell = overtimeRow.querySelector('.monthly-total');
            if (monthlyTotalCell) {
                monthlyTotalCell.textContent = total > 0 ? total : '';
                monthlyTotalCell.style.fontWeight = 'bold';
                monthlyTotalCell.style.textAlign = 'center';
            }
        }
    });

    // 計画停止の合計
    ['day', 'night'].forEach(shift => {
        const stopTimeRow = document.querySelector(`[data-section="stop_time"][data-shift="${shift}"]`);
        if (stopTimeRow) {
            let total = 0;
            stopTimeRow.querySelectorAll('.stop-time-input').forEach(input => {
                if (input.style.display !== 'none') {
                    total += parseInt(input.value) || 0;
                }
            });
            const monthlyTotalCell = stopTimeRow.querySelector('.monthly-total');
            if (monthlyTotalCell) {
                monthlyTotalCell.textContent = total > 0 ? total : '';
                monthlyTotalCell.style.fontWeight = 'bold';
                monthlyTotalCell.style.textAlign = 'center';
            }
        }
    });
}

// ========================================
// イベントリスナー設定
// ========================================
function setupEventListeners() {
    // 出庫数・生産数・在庫数の変更時に合計を更新
    document.querySelectorAll('.shipment-input, .stock-input').forEach(input => {
        input.addEventListener('input', function () {
            updateRowTotals();
        });
    });

    // 生産数の変更時に合計を更新
    document.querySelectorAll('.production-input').forEach(input => {
        if (!input.classList.contains('shipment-input') && !input.classList.contains('stock-input')) {
            input.addEventListener('input', function () {
                updateRowTotals();
            });
        }
    });

    // 残業時間と停止時間の変更時に合計を更新
    document.querySelectorAll('.overtime-input, .stop-time-input').forEach(input => {
        input.addEventListener('input', function () {
            updateRowTotals();
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

    // 初期表示時に合計を計算
    updateRowTotals();
});
