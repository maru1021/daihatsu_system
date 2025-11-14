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

    // 月別計画の割合を適用（四捨五入）
    const ratio = monthlyPlanRatios[itemName] || 0;
    return Math.round(baseQuantity * ratio);
}

// 生産数の入力フィールドを更新
function updateProductionQuantity(dateIndex, shift, itemName, forceUpdate = false) {
    const productionInput = getInputElement(
        `.production-input[data-shift="${shift}"][data-item="${itemName}"][data-date-index="${dateIndex}"]`
    );

    if (!productionInput || productionInput.style.display === 'none') return;

    // 強制更新フラグがfalseで既にデータが入力されている場合はスキップ
    if (!forceUpdate && productionInput.value && parseInt(productionInput.value) > 0) {
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
// 合計値計算機能
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

// 日勤+夜勤の日別合計を計算
function updateDailyTotals() {
    document.querySelectorAll('[data-section="production"][data-shift="day"]').forEach(dayRow => {
        const itemName = dayRow.getAttribute('data-item');
        if (!itemName) return;

        const nightRow = document.querySelector(`[data-section="production"][data-shift="night"][data-item="${itemName}"]`);
        if (!nightRow) return;

        const dayInputs = dayRow.querySelectorAll('.production-input');
        const nightInputs = nightRow.querySelectorAll('.production-input');

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

    // 月別生産計画の背景色を更新
    updateMonthlyPlanColors();
}

// 月別生産計画の背景色と差分を更新
function updateMonthlyPlanColors() {
    document.querySelectorAll('.monthly-plan-item').forEach(planItem => {
        const itemName = planItem.getAttribute('data-item-name');
        if (!itemName) return;

        const monthlyPlanQuantity = monthlyPlanQuantities[itemName] || 0;
        if (monthlyPlanQuantity === 0) {
            planItem.style.backgroundColor = 'white';
            return;
        }

        // 実際の生産合計を計算
        let actualTotal = 0;
        const dayRow = document.querySelector(`[data-section="production"][data-shift="day"][data-item="${itemName}"]`);
        if (dayRow) {
            const dailyTotalCell = dayRow.querySelector('.daily-total');
            if (dailyTotalCell && dailyTotalCell.textContent) {
                actualTotal = parseInt(dailyTotalCell.textContent) || 0;
            }
        }

        // 差分を計算
        const diff = actualTotal - monthlyPlanQuantity;

        // 差分表示を更新
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

        // 月別計画と実際の生産数を比較して背景色を設定
        if (actualTotal > monthlyPlanQuantity) {
            // 実際の生産数の方が多い場合は薄い黄色
            planItem.style.backgroundColor = '#fef9c3';
        } else if (actualTotal < monthlyPlanQuantity) {
            // 実際の生産数の方が少ない場合は薄い赤色
            planItem.style.backgroundColor = '#fee2e2';
        } else {
            // 同じ場合は白色（デフォルト）
            planItem.style.backgroundColor = 'white';
        }
    });
}

// 行の合計値を計算して表示
function updateRowTotals() {
    // 日勤の月間合計
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

    // 夜勤の月間合計
    calculateSectionTotal(
        document.querySelectorAll('[data-section="production"][data-shift="night"]'),
        'production-input'
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
}

// ========================================
// 定時・休出チェック機能
// ========================================
const debouncedUpdateWorkingDayStatus = debounce(function (dateIndex) {
    updateWorkingDayStatus(dateIndex);
}, 100);

function toggleCheck(element) {
    const isWeekend = element.getAttribute('data-weekend') === 'true';
    const currentText = element.textContent;

    const newText = currentText === '' ? (isWeekend ? '休出' : '定時') : '';
    element.textContent = newText;

    // data-regular-hours属性を更新
    element.setAttribute('data-regular-hours', newText === '定時' ? 'true' : 'false');

    const dateIndex = Array.from(element.parentElement.children).indexOf(element) - 1;
    debouncedUpdateWorkingDayStatus(dateIndex);

    // 合計を更新（表示状態が変更された後に実行）
    setTimeout(() => updateRowTotals(), 150);
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
            if (max === 0) input.value = '0';
        } else {
            input.removeAttribute('max');
        }
    }
}

// 週末の休出状態を初期化
function initializeWeekendWorkingStatus() {
    document.querySelectorAll('.check-cell').forEach((checkCell, index) => {
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        if (!isWeekend) return;

        const hasWeekendWork = checkCell.getAttribute('data-has-weekend-work') === 'true';

        if (hasWeekendWork) {
            checkCell.textContent = '休出';
            checkCell.setAttribute('data-regular-hours', 'false');
        } else {
            checkCell.textContent = '';
            checkCell.setAttribute('data-regular-hours', 'false');
            const dateIndex = index;

            // 稼働率の入力フィールドを非表示
            const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
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
        const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
        if (occupancyRateInput) {
            occupancyRateInput.style.display = isWorking ? '' : 'none';
        }

        toggleInputs(dateIndex, 'day', isWorking);
        toggleInputs(dateIndex, 'night', false); // 夜勤は週末は常に非表示

        // 残業計画の上限値を設定
        setOvertimeLimit(dateIndex, 'day', isWorking ? null : 0);
        setOvertimeLimit(dateIndex, 'night', isWorking ? null : 0);

        // 休出の場合、生産数の初期値を計算
        if (isWorking) {
            updateAllItemsProduction(dateIndex, ['day'], false);
        }
    } else {
        // 平日の場合
        const isWorking = checkText === '定時';

        if (isWorking) {
            // 定時の場合：日勤は残業0、夜勤は通常通り60
            setOvertimeLimit(dateIndex, 'day', 0);
            setOvertimeLimit(dateIndex, 'night', OVERTIME_MAX_NIGHT);

            // 定時時に日勤の生産数を再計算（残業0で）
            updateAllItemsProduction(dateIndex, ['day'], true);
        } else {
            // 定時でない場合は上限を元に戻す
            setOvertimeLimit(dateIndex, 'day', OVERTIME_MAX_DAY);
            setOvertimeLimit(dateIndex, 'night', OVERTIME_MAX_NIGHT);
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

    for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
        const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
        const checkCell = document.querySelector(`.check-cell[data-date-index="${dateIndex}"]`);
        const checkText = checkCell ? checkCell.textContent.trim() : '';
        const isWeekend = checkCell ? checkCell.getAttribute('data-weekend') === 'true' : false;

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
                if (productionInput && productionInput.style.display !== 'none') {
                    shiftData.items[itemName] = parseInt(productionInput.value) || 0;
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
// 微調整関数
// ========================================
function adjustOvertimeForTarget(productionCapacity, diff, totalMonthlyTarget, itemNames) {
    const tact = itemData.tact || 0;
    if (tact === 0) return;

    const needIncrease = diff > 0;
    let remaining = Math.abs(diff);

    // 各スロットの情報と効果を計算
    const slots = [];

    productionCapacity.forEach(cap => {
        const overtimeInput = getInputElement(`.overtime-input[data-shift="${cap.shift}"][data-date-index="${cap.dateIndex}"]`);
        if (!overtimeInput) return;

        const currentOvertime = parseInt(overtimeInput.value) || 0;

        // 調整可能かチェック
        const canIncrease = currentOvertime < cap.maxOvertime;
        const canDecrease = currentOvertime > 0;

        if ((needIncrease && !canIncrease) || (!needIncrease && !canDecrease)) return;

        const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${cap.dateIndex}"]`);
        const occupancyRate = occupancyRateInput ? (parseFloat(occupancyRateInput.value) || 0) / 100 : 0;
        if (occupancyRate === 0) return;

        // 5分の残業時間での生産数増減
        const baseQuantity = Math.ceil(5 / tact * occupancyRate);
        let effect = 0;
        itemNames.forEach(itemName => {
            const ratio = monthlyPlanRatios[itemName] || 0;
            effect += Math.round(baseQuantity * ratio);
        });

        if (effect > 0) {
            slots.push({
                cap,
                overtimeInput,
                currentOvertime,
                effect,
                adjustCount: 0
            });
        }
    });

    if (slots.length === 0) return;

    const nightShiftMaxForUniform = 60; // 夜勤が60分までなら全体で5分以内制約

    // 全スロットの最大残業時間をチェック
    const maxCurrentOvertime = Math.max(...slots.map(s => s.currentOvertime));
    const useUniformConstraint = maxCurrentOvertime <= nightShiftMaxForUniform;

    if (useUniformConstraint) {
        // 夜勤が60分以内の場合: 全スロット共通で5分以内制約
        let round = 0;
        const maxRounds = 100;

        while (remaining > 0 && round < maxRounds) {
            let adjusted = false;

            for (const slot of slots) {
                if (remaining <= 0) break;

                // 他のすべてのスロットとの差が5分を超えないようにチェック
                const currentOvertimeAfterAdjust = slot.currentOvertime + (needIncrease ? 5 : -5) * (slot.adjustCount + 1);
                const otherOvertimes = slots
                    .filter(s => s !== slot)
                    .map(s => s.currentOvertime + (needIncrease ? 5 : -5) * s.adjustCount);

                const maxOtherOvertime = Math.max(...otherOvertimes, 0);
                const minOtherOvertime = Math.min(...otherOvertimes, Infinity);

                // 調整後の差が5分を超える場合はスキップ
                if (needIncrease) {
                    if (currentOvertimeAfterAdjust - minOtherOvertime > 5) {
                        continue;
                    }
                } else {
                    if (maxOtherOvertime - currentOvertimeAfterAdjust > 5) {
                        continue;
                    }
                }

                // 夜勤の場合は60分を超えないようにチェック
                if (slot.cap.shift === 'night' && currentOvertimeAfterAdjust > nightShiftMaxForUniform) {
                    continue;
                }

                // 上限チェック
                const maxAdjustments = needIncrease
                    ? Math.floor((slot.cap.maxOvertime - slot.currentOvertime) / 5)
                    : Math.floor(slot.currentOvertime / 5);

                if (slot.adjustCount < maxAdjustments) {
                    slot.adjustCount++;
                    remaining -= slot.effect;
                    adjusted = true;
                }
            }

            if (!adjusted) break;
            round++;
        }
    } else {
        // 夜勤が60分を超えている場合: シフトごとに5分以内制約
        const daySlots = slots.filter(slot => slot.cap.shift === 'day');
        const nightSlots = slots.filter(slot => slot.cap.shift === 'night');

        const adjustShiftSlots = (shiftSlots) => {
            if (shiftSlots.length === 0) return;

            let round = 0;
            const maxRounds = 100;

            while (remaining > 0 && round < maxRounds) {
                let adjusted = false;

                for (const slot of shiftSlots) {
                    if (remaining <= 0) break;

                    const currentOvertimeAfterAdjust = slot.currentOvertime + (needIncrease ? 5 : -5) * (slot.adjustCount + 1);
                    const otherOvertimes = shiftSlots
                        .filter(s => s !== slot)
                        .map(s => s.currentOvertime + (needIncrease ? 5 : -5) * s.adjustCount);

                    const maxOtherOvertime = Math.max(...otherOvertimes, 0);
                    const minOtherOvertime = Math.min(...otherOvertimes, Infinity);

                    if (needIncrease) {
                        if (currentOvertimeAfterAdjust - minOtherOvertime > 5) {
                            continue;
                        }
                    } else {
                        if (maxOtherOvertime - currentOvertimeAfterAdjust > 5) {
                            continue;
                        }
                    }

                    const maxAdjustments = needIncrease
                        ? Math.floor((slot.cap.maxOvertime - slot.currentOvertime) / 5)
                        : Math.floor(slot.currentOvertime / 5);

                    if (slot.adjustCount < maxAdjustments) {
                        slot.adjustCount++;
                        remaining -= slot.effect;
                        adjusted = true;
                    }
                }

                if (!adjusted) break;
                round++;
            }
        };

        adjustShiftSlots(daySlots);
        adjustShiftSlots(nightSlots);
    }

    // 実際に残業時間を適用
    slots.forEach(slot => {
        if (slot.adjustCount > 0) {
            const adjustment = slot.adjustCount * 5;
            const newOvertime = needIncrease
                ? slot.currentOvertime + adjustment
                : slot.currentOvertime - adjustment;
            slot.overtimeInput.value = newOvertime;
            // currentOvertimeを更新
            slot.currentOvertime = newOvertime;
        }
    });

    // 生産数を再計算
    const dateCount = document.querySelectorAll('.operation-rate-input').length;
    for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
        ['day', 'night'].forEach(shift => {
            itemNames.forEach(itemName => {
                updateProductionQuantity(dateIndex, shift, itemName, true);
            });
        });
    }

    // 合計を更新
    updateRowTotals();

    // 2回目の微調整（さらに精度を上げる）- 最大3回まで反復
    let adjustmentRound = 1;
    const maxAdjustmentRounds = 3;

    const performFineTune = () => {
        setTimeout(() => {
            let actualTotal = 0;
            document.querySelectorAll('[data-section="production"][data-shift="day"]').forEach(row => {
                const itemName = row.getAttribute('data-item');
                if (!itemName) return;

                const dailyTotalCell = row.querySelector('.daily-total');
                if (dailyTotalCell && dailyTotalCell.textContent) {
                    actualTotal += parseInt(dailyTotalCell.textContent) || 0;
                }
            });

            const newDiff = totalMonthlyTarget - actualTotal;

            // まだ差分がある場合、もう一度調整（最大3回まで）
            if (Math.abs(newDiff) > 0 && adjustmentRound < maxAdjustmentRounds) {
                adjustmentRound++;
                const improved = fineTuneOvertime(slots, newDiff, itemNames, totalMonthlyTarget);
                // 改善があった場合は次の調整を試みる
                if (improved) {
                    performFineTune();
                }
            }
        }, 50);
    };

    performFineTune();
}

// 細かい微調整（複数スロットを調整可能）
function fineTuneOvertime(slots, diff, itemNames, totalMonthlyTarget) {
    const tact = itemData.tact || 0;
    if (tact === 0) return false;

    const needIncrease = diff > 0;
    let remaining = Math.abs(diff);

    // 調整前の合計を記録
    let beforeTotal = 0;
    document.querySelectorAll('[data-section="production"][data-shift="day"]').forEach(row => {
        const itemName = row.getAttribute('data-item');
        if (!itemName) return;
        const dailyTotalCell = row.querySelector('.daily-total');
        if (dailyTotalCell && dailyTotalCell.textContent) {
            beforeTotal += parseInt(dailyTotalCell.textContent) || 0;
        }
    });

    // 各スロットの現在の残業時間を更新
    slots.forEach(slot => {
        slot.currentOvertime = parseInt(slot.overtimeInput.value) || 0;
    });

    const nightShiftMaxForUniform = 60;
    const maxCurrentOvertime = Math.max(...slots.map(s => s.currentOvertime));
    const useUniformConstraint = maxCurrentOvertime <= nightShiftMaxForUniform;

    let adjustedCount = 0;

    if (useUniformConstraint) {
        // 夜勤が60分以内の場合: 全スロット共通で5分以内制約
        const adjustableSlots = [];

        for (const slot of slots) {
            const canAdjust = needIncrease
                ? (slot.currentOvertime + 5 <= slot.cap.maxOvertime)
                : (slot.currentOvertime - 5 >= 0);

            // 夜勤の場合は60分を超えないかチェック
            if (slot.cap.shift === 'night' && needIncrease && slot.currentOvertime + 5 > nightShiftMaxForUniform) {
                continue;
            }

            if (canAdjust) {
                adjustableSlots.push({
                    slot,
                    effectDiff: Math.abs(slot.effect - remaining)
                });
            }
        }

        adjustableSlots.sort((a, b) => a.effectDiff - b.effectDiff);

        const maxAdjustmentsPerRound = Math.min(Math.ceil(remaining / 5), adjustableSlots.length);

        for (let i = 0; i < maxAdjustmentsPerRound && i < adjustableSlots.length; i++) {
            const { slot } = adjustableSlots[i];

            if (remaining <= 0) break;

            const currentValue = parseInt(slot.overtimeInput.value) || 0;
            const newValue = needIncrease ? currentValue + 5 : currentValue - 5;

            // 他のすべてのスロットとの差が5分を超えないかチェック
            const otherOvertimes = slots
                .filter(s => s !== slot)
                .map(s => parseInt(s.overtimeInput.value) || 0);

            const maxOtherOvertime = Math.max(...otherOvertimes, 0);
            const minOtherOvertime = Math.min(...otherOvertimes, Infinity);

            if (needIncrease) {
                if (newValue - minOtherOvertime > 5) {
                    continue;
                }
            } else {
                if (maxOtherOvertime - newValue > 5) {
                    continue;
                }
            }

            slot.overtimeInput.value = newValue;
            slot.currentOvertime = newValue;
            remaining -= slot.effect;
            adjustedCount++;
        }
    } else {
        // 夜勤が60分を超えている場合: シフトごとに5分以内制約
        const daySlots = slots.filter(slot => slot.cap.shift === 'day');
        const nightSlots = slots.filter(slot => slot.cap.shift === 'night');

        const adjustShiftSlots = (shiftSlots) => {
            if (shiftSlots.length === 0) return;

            const adjustableSlots = [];

            for (const slot of shiftSlots) {
                const canAdjust = needIncrease
                    ? (slot.currentOvertime + 5 <= slot.cap.maxOvertime)
                    : (slot.currentOvertime - 5 >= 0);

                if (canAdjust) {
                    adjustableSlots.push({
                        slot,
                        effectDiff: Math.abs(slot.effect - remaining)
                    });
                }
            }

            adjustableSlots.sort((a, b) => a.effectDiff - b.effectDiff);

            const maxAdjustmentsPerRound = Math.min(Math.ceil(remaining / 5), adjustableSlots.length);

            for (let i = 0; i < maxAdjustmentsPerRound && i < adjustableSlots.length; i++) {
                const { slot } = adjustableSlots[i];

                if (remaining <= 0) break;

                const currentValue = parseInt(slot.overtimeInput.value) || 0;
                const newValue = needIncrease ? currentValue + 5 : currentValue - 5;

                const otherOvertimes = shiftSlots
                    .filter(s => s !== slot)
                    .map(s => parseInt(s.overtimeInput.value) || 0);

                const maxOtherOvertime = Math.max(...otherOvertimes, 0);
                const minOtherOvertime = Math.min(...otherOvertimes, Infinity);

                if (needIncrease) {
                    if (newValue - minOtherOvertime > 5) {
                        continue;
                    }
                } else {
                    if (maxOtherOvertime - newValue > 5) {
                        continue;
                    }
                }

                slot.overtimeInput.value = newValue;
                slot.currentOvertime = newValue;
                remaining -= slot.effect;
                adjustedCount++;
            }
        };

        adjustShiftSlots(daySlots);
        adjustShiftSlots(nightSlots);
    }

    if (adjustedCount === 0) {
        return false; // 調整できなかった
    }

    // 生産数を再計算
    const dateCount = document.querySelectorAll('.operation-rate-input').length;
    for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
        ['day', 'night'].forEach(shift => {
            itemNames.forEach(itemName => {
                updateProductionQuantity(dateIndex, shift, itemName, true);
            });
        });
    }

    updateRowTotals();

    // 調整後の合計を確認
    let afterTotal = 0;
    document.querySelectorAll('[data-section="production"][data-shift="day"]').forEach(row => {
        const itemName = row.getAttribute('data-item');
        if (!itemName) return;
        const dailyTotalCell = row.querySelector('.daily-total');
        if (dailyTotalCell && dailyTotalCell.textContent) {
            afterTotal += parseInt(dailyTotalCell.textContent) || 0;
        }
    });

    // 改善があったかどうかを返す
    const beforeDiff = Math.abs(totalMonthlyTarget - beforeTotal);
    const afterDiff = Math.abs(totalMonthlyTarget - afterTotal);

    return afterDiff < beforeDiff;
}

// ========================================
// 自動計算機能
// ========================================
function autoCalculateOvertime() {
    // 月別合計目標を取得
    const monthlyTargets = {};
    let totalMonthlyTarget = 0;

    getItemNames().forEach(itemName => {
        const quantity = monthlyPlanQuantities[itemName] || 0;
        monthlyTargets[itemName] = quantity;
        totalMonthlyTarget += quantity;
    });

    if (totalMonthlyTarget === 0) {
        showToast('error', '月別生産計画が設定されていません');
        return;
    }

    const dateCount = document.querySelectorAll('.operation-rate-input').length;
    const itemNames = getItemNames();

    // 稼働可能日をカウントして初期残業時間を設定
    const workingDays = [];
    const specialDays = []; // 定時日・休出日

    for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
        const checkCells = document.querySelectorAll('.check-cell');
        const checkCell = checkCells[dateIndex];
        if (!checkCell) continue;

        const checkText = checkCell.textContent.trim();
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';

        if (checkText === '定時') {
            // 定時日: 日勤は残業0、夜勤は残業可能
            const dayOvertimeInput = getInputElement(`.overtime-input[data-shift="day"][data-date-index="${dateIndex}"]`);
            if (dayOvertimeInput && dayOvertimeInput.style.display !== 'none') {
                dayOvertimeInput.value = 0;
            }
            specialDays.push({ dateIndex, type: 'teiji' });
            workingDays.push({ dateIndex, shifts: ['night'] }); // 夜勤のみ残業調整可能
        } else if (checkText === '休出') {
            // 休出日: 日勤のみ定時分（残業0）
            ['day', 'night'].forEach(shift => {
                const overtimeInput = getInputElement(`.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`);
                if (overtimeInput && overtimeInput.style.display !== 'none') {
                    overtimeInput.value = 0;
                }
            });
            specialDays.push({ dateIndex, type: 'kyushutsu' });
        } else if (isWeekend && checkText === '') {
            // 週末の非稼働日は残業0
            ['day', 'night'].forEach(shift => {
                const overtimeInput = getInputElement(`.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`);
                if (overtimeInput && overtimeInput.style.display !== 'none') {
                    overtimeInput.value = 0;
                }
            });
        } else if (!isWeekend) {
            // 通常稼働日（平日）
            workingDays.push({ dateIndex, shifts: ['day', 'night'] });
        }
    }

    // タクトを取得
    const tact = itemData.tact || 0;
    if (tact === 0) {
        showToast('error', 'タクトが設定されていません');
        return;
    }

    // まず全ての稼働日の残業を最大値に設定
    workingDays.forEach(({ dateIndex, shifts }) => {
        shifts.forEach(shift => {
            const overtimeInput = getInputElement(`.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`);
            if (overtimeInput && overtimeInput.style.display !== 'none') {
                const maxOvertime = shift === 'day' ? OVERTIME_MAX_DAY : OVERTIME_MAX_NIGHT;
                overtimeInput.value = maxOvertime;
            }
        });
    });

    // 定時間の合計生産数を計算（全稼働日の定時間 - 計画停止）
    let totalRegularProduction = 0;

    // 通常稼働日の定時間分を計算
    workingDays.forEach(({ dateIndex, shifts }) => {
        shifts.forEach(shift => {
            const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
            if (!occupancyRateInput || occupancyRateInput.style.display === 'none') return;

            const occupancyRate = (parseFloat(occupancyRateInput.value) || 0) / 100;
            if (occupancyRate === 0) return;

            const stopTimeInput = getInputElement(`.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`);
            const stopTime = getInputValue(stopTimeInput);

            const regularTime = shift === 'day' ? REGULAR_TIME_DAY : REGULAR_TIME_NIGHT;
            const productionTime = regularTime - stopTime;

            if (productionTime > 0) {
                const baseQuantity = Math.ceil(productionTime / tact * occupancyRate);
                itemNames.forEach(itemName => {
                    const ratio = monthlyPlanRatios[itemName] || 0;
                    totalRegularProduction += Math.round(baseQuantity * ratio);
                });
            }
        });
    });

    // 定時日・休出日の定時間分を計算
    specialDays.forEach(({ dateIndex, type }) => {
        const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
        if (!occupancyRateInput || occupancyRateInput.style.display === 'none') return;

        const occupancyRate = (parseFloat(occupancyRateInput.value) || 0) / 100;
        if (occupancyRate === 0) return;

        if (type === 'teiji') {
            // 定時日: 日勤の定時分(455分 - 停止時間)のみ
            // 夜勤は残業調整可能なので定時間生産には含めない
            const dayStopTimeInput = getInputElement(`.stop-time-input[data-shift="day"][data-date-index="${dateIndex}"]`);
            const dayStopTime = getInputValue(dayStopTimeInput);
            const productionTime = REGULAR_TIME_DAY - dayStopTime;

            if (productionTime > 0) {
                const baseQuantity = Math.ceil(productionTime / tact * occupancyRate);
                itemNames.forEach(itemName => {
                    const ratio = monthlyPlanRatios[itemName] || 0;
                    totalRegularProduction += Math.round(baseQuantity * ratio);
                });
            }
        } else if (type === 'kyushutsu') {
            // 休出日: 日勤の定時分(455分 - 停止時間)のみ
            const dayStopTimeInput = getInputElement(`.stop-time-input[data-shift="day"][data-date-index="${dateIndex}"]`);
            const dayStopTime = getInputValue(dayStopTimeInput);
            const productionTime = REGULAR_TIME_DAY - dayStopTime;

            if (productionTime > 0) {
                const baseQuantity = Math.ceil(productionTime / tact * occupancyRate);
                itemNames.forEach(itemName => {
                    const ratio = monthlyPlanRatios[itemName] || 0;
                    totalRegularProduction += Math.round(baseQuantity * ratio);
                });
            }
        }
    });

    // 各日・シフトごとの生産能力を計算（残業可能なスロット）
    const productionCapacity = [];

    workingDays.forEach(({ dateIndex, shifts }) => {
        shifts.forEach(shift => {
            const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
            if (!occupancyRateInput || occupancyRateInput.style.display === 'none') return;

            const overtimeInput = getInputElement(`.overtime-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`);
            if (!overtimeInput || overtimeInput.style.display === 'none') return;

            const stopTimeInput = getInputElement(`.stop-time-input[data-shift="${shift}"][data-date-index="${dateIndex}"]`);
            const stopTime = getInputValue(stopTimeInput);

            const occupancyRate = (parseFloat(occupancyRateInput.value) || 0) / 100;
            if (occupancyRate === 0) return;

            const regularTime = shift === 'day' ? REGULAR_TIME_DAY : REGULAR_TIME_NIGHT;
            const maxOvertime = shift === 'day' ? OVERTIME_MAX_DAY : OVERTIME_MAX_NIGHT;

            // 残業時間のみの生産数を計算する関数
            const calcProduction = (overtime) => {
                if (overtime <= 0) return 0;
                // 残業時間のみの生産数を計算
                const overtimeProductionTime = overtime;
                const baseQuantity = Math.ceil(overtimeProductionTime / tact * occupancyRate);
                let total = 0;
                itemNames.forEach(itemName => {
                    const ratio = monthlyPlanRatios[itemName] || 0;
                    total += Math.round(baseQuantity * ratio);
                });
                return total;
            };

            productionCapacity.push({
                dateIndex,
                shift,
                maxOvertime,
                calcProduction,
                stopTime,
                occupancyRate,
                regularTime
            });
        });
    });

    // 定時日の夜勤も残業可能スロットに追加（定時間分も含めて計算）
    specialDays.forEach(({ dateIndex, type }) => {
        if (type === 'teiji') {
            const occupancyRateInput = getInputElement(`.operation-rate-input[data-date-index="${dateIndex}"]`);
            if (!occupancyRateInput || occupancyRateInput.style.display === 'none') return;

            const nightOvertimeInput = getInputElement(`.overtime-input[data-shift="night"][data-date-index="${dateIndex}"]`);
            if (!nightOvertimeInput || nightOvertimeInput.style.display === 'none') return;

            const nightStopTimeInput = getInputElement(`.stop-time-input[data-shift="night"][data-date-index="${dateIndex}"]`);
            const nightStopTime = getInputValue(nightStopTimeInput);

            const occupancyRate = (parseFloat(occupancyRateInput.value) || 0) / 100;
            if (occupancyRate === 0) return;

            // 定時日の夜勤：定時間 + 残業時間の生産数を計算
            const calcProduction = (overtime) => {
                // 定時間 + 残業時間の合計生産数
                const totalTime = REGULAR_TIME_NIGHT - nightStopTime + overtime;
                if (totalTime <= 0) return 0;

                const baseQuantity = Math.ceil(totalTime / tact * occupancyRate);
                let total = 0;
                itemNames.forEach(itemName => {
                    const ratio = monthlyPlanRatios[itemName] || 0;
                    total += Math.round(baseQuantity * ratio);
                });

                // 定時間分の生産数を引いて、残業分のみを返す
                const regularProduction = Math.ceil((REGULAR_TIME_NIGHT - nightStopTime) / tact * occupancyRate);
                let regularTotal = 0;
                itemNames.forEach(itemName => {
                    const ratio = monthlyPlanRatios[itemName] || 0;
                    regularTotal += Math.round(regularProduction * ratio);
                });

                return total - regularTotal;
            };

            productionCapacity.push({
                dateIndex,
                shift: 'night',
                maxOvertime: OVERTIME_MAX_NIGHT,
                calcProduction,
                stopTime: nightStopTime,
                occupancyRate,
                regularTime: REGULAR_TIME_NIGHT
            });
        }
    });

    // 残りの目標を計算（定時間生産分を差し引く）
    const remainingTarget = totalMonthlyTarget - totalRegularProduction;

    if (remainingTarget <= 0) {
        showToast('success', '定時間で生産が完了します');
        // 残業は全て0に設定
        productionCapacity.forEach(cap => {
            const overtimeInput = getInputElement(`.overtime-input[data-shift="${cap.shift}"][data-date-index="${cap.dateIndex}"]`);
            if (overtimeInput) {
                overtimeInput.value = 0;
            }
        });
    } else {
        // 残業での生産可能数を計算
        let maxOvertimeProduction = 0;
        productionCapacity.forEach(cap => {
            maxOvertimeProduction += cap.calcProduction(cap.maxOvertime);
        });

        // 最大残業でも目標達成不可の場合
        if (maxOvertimeProduction < remainingTarget) {
            showToast('error', '最大残業でも計画数を達成できないため、休出などで調整してください');
            // それでも最大値で設定
            productionCapacity.forEach(cap => {
                const overtimeInput = getInputElement(`.overtime-input[data-shift="${cap.shift}"][data-date-index="${cap.dateIndex}"]`);
                if (overtimeInput) {
                    overtimeInput.value = cap.maxOvertime;
                }
            });
            return;
        } else {
            // 全スロット共通で残業時間を均等に割り振る（夜勤が60分を超えない限り）
            const targetPerSlot = remainingTarget / productionCapacity.length;

            // 各スロットの基準残業時間を計算
            const baseOvertimes = [];
            productionCapacity.forEach(cap => {
                let bestOvertime = 0;
                let bestDiff = Infinity;

                for (let overtime = 0; overtime <= cap.maxOvertime; overtime += 5) {
                    const production = cap.calcProduction(overtime);
                    const diff = Math.abs(production - targetPerSlot);
                    if (diff < bestDiff) {
                        bestDiff = diff;
                        bestOvertime = overtime;
                    }
                }
                baseOvertimes.push(bestOvertime);
            });

            // 基準残業時間の平均を計算
            const avgOvertime = baseOvertimes.reduce((sum, ot) => sum + ot, 0) / baseOvertimes.length;
            let baseOvertime = Math.round(avgOvertime / 5) * 5; // 5分刻みに丸める

            // 夜勤の上限を考慮（60分まで）
            const nightShiftMaxForUniform = 60; // 夜勤が60分までなら日勤と同じ扱い

            // すべてのスロットを基準値に設定（差は最大5分以内）
            productionCapacity.forEach(cap => {
                // 夜勤で基準値が60分を超える場合は、夜勤は別扱い
                if (cap.shift === 'night' && baseOvertime > nightShiftMaxForUniform) {
                    // 夜勤は60分を上限として設定
                    const nightBaseOvertime = Math.min(baseOvertime, cap.maxOvertime);
                    let bestOvertime = nightBaseOvertime;
                    let bestDiff = Infinity;

                    for (let overtime = Math.max(0, nightBaseOvertime - 5); overtime <= Math.min(cap.maxOvertime, nightBaseOvertime + 5); overtime += 5) {
                        const production = cap.calcProduction(overtime);
                        const diff = Math.abs(production - targetPerSlot);
                        if (diff < bestDiff) {
                            bestDiff = diff;
                            bestOvertime = overtime;
                        }
                    }

                    const overtimeInput = getInputElement(`.overtime-input[data-shift="${cap.shift}"][data-date-index="${cap.dateIndex}"]`);
                    if (overtimeInput) {
                        overtimeInput.value = bestOvertime;
                    }
                } else {
                    // 日勤、または夜勤でも60分以内の場合は共通基準値で設定
                    let bestOvertime = baseOvertime;
                    let bestDiff = Infinity;

                    const maxAllowedOvertime = cap.shift === 'night' ? Math.min(cap.maxOvertime, nightShiftMaxForUniform) : cap.maxOvertime;

                    for (let overtime = Math.max(0, baseOvertime - 5); overtime <= Math.min(maxAllowedOvertime, baseOvertime + 5); overtime += 5) {
                        const production = cap.calcProduction(overtime);
                        const diff = Math.abs(production - targetPerSlot);
                        if (diff < bestDiff) {
                            bestDiff = diff;
                            bestOvertime = overtime;
                        }
                    }

                    const overtimeInput = getInputElement(`.overtime-input[data-shift="${cap.shift}"][data-date-index="${cap.dateIndex}"]`);
                    if (overtimeInput) {
                        overtimeInput.value = bestOvertime;
                    }
                }
            });
        }
    }

    // 生産数を再計算（強制更新）
    for (let dateIndex = 0; dateIndex < dateCount; dateIndex++) {
        ['day', 'night'].forEach(shift => {
            itemNames.forEach(itemName => {
                updateProductionQuantity(dateIndex, shift, itemName, true);
            });
        });
    }

    // 合計を更新
    updateRowTotals();

    // 微調整：実際の生産合計が目標に近づくように残業時間を調整
    setTimeout(() => {
        let actualTotal = 0;
        document.querySelectorAll('[data-section="production"][data-shift="day"]').forEach(row => {
            const itemName = row.getAttribute('data-item');
            if (!itemName) return;

            const dailyTotalCell = row.querySelector('.daily-total');
            if (dailyTotalCell && dailyTotalCell.textContent) {
                actualTotal += parseInt(dailyTotalCell.textContent) || 0;
            }
        });

        const diff = totalMonthlyTarget - actualTotal;

        if (Math.abs(diff) > 0) {
            // 差分がある場合、残業時間を微調整
            adjustOvertimeForTarget(productionCapacity, diff, totalMonthlyTarget, itemNames);
        }
    }, 100);

    // 結果を確認（微調整後）
    setTimeout(() => {
        let actualTotal = 0;
        document.querySelectorAll('[data-section="production"][data-shift="day"]').forEach(row => {
            const itemName = row.getAttribute('data-item');
            if (!itemName) return;

            const dailyTotalCell = row.querySelector('.daily-total');
            if (dailyTotalCell && dailyTotalCell.textContent) {
                actualTotal += parseInt(dailyTotalCell.textContent) || 0;
            }
        });

        showToast('success', '残業時間を自動計算しました');
    }, 300);
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
    // 計算式: 定時間の台数 = (定時間 - 計画停止) / タクト × 稼働率
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
    // 計算式: 残業時間 = 追加生産数 × タクト / 稼働率
    let calculatedOvertime = (additionalProduction * tact) / occupancyRate;
    calculatedOvertime = Math.max(0, calculatedOvertime);

    const maxOvertime = shift === 'day' ? OVERTIME_MAX_DAY : OVERTIME_MAX_NIGHT;

    // 残業上限を超える場合
    if (calculatedOvertime > maxOvertime) {
        const shiftName = shift === 'day' ? '日勤' : '夜勤';
        const date = document.querySelector(`.check-cell[data-date-index="${dateIndex}"]`)?.getAttribute('data-date');
        showToast('error', `${date} ${shiftName}：残業時間が上限に達しています。`);
        return false; // 入力を拒否
    }

    // 5分刻みに丸める
    calculatedOvertime = Math.round(calculatedOvertime / 5) * 5;
    overtimeInput.value = calculatedOvertime;
    return true; // 入力を許可
}

// ========================================
// イベントリスナー設定
// ========================================
function setupEventListeners() {
    // 残業時間と停止時間の変更時に生産数を再計算
    document.querySelectorAll('.overtime-input, .stop-time-input').forEach(input => {
        input.addEventListener('input', function () {
            const dateIndex = parseInt(this.getAttribute('data-date-index'));
            const shift = this.getAttribute('data-shift');

            updateAllItemsProduction(dateIndex, [shift], true);
            updateRowTotals();
        });
    });

    // 稼働率の変更時に生産数を再計算
    document.querySelectorAll('.operation-rate-input').forEach(input => {
        input.addEventListener('input', function () {
            const dateIndex = parseInt(this.getAttribute('data-date-index'));
            updateAllItemsProduction(dateIndex, ['day', 'night'], true);
        });
    });

    // 生産数の変更時に合計を更新し、残業時間を逆算
    let isRecalculating = false; // 無限ループ防止フラグ

    document.querySelectorAll('.production-input').forEach(input => {
        // 前回の値を保存
        let previousValue = input.value;

        input.addEventListener('focus', function () {
            previousValue = this.value;
        });

        input.addEventListener('input', function () {
            // 無限ループ防止
            if (isRecalculating) return;

            const dateIndex = parseInt(this.getAttribute('data-date-index'));
            const shift = this.getAttribute('data-shift');
            const itemName = this.getAttribute('data-item');

            // 既に再計算中の場合はスキップ（無限ループ防止）
            if (isRecalculating) return;

            isRecalculating = true;

            // 残業時間を逆算して、上限チェック
            const isValid = recalculateOvertimeFromProduction(dateIndex, shift, itemName);

            // 上限を超える場合は元の値に戻す
            if (!isValid) {
                this.value = previousValue;
                isRecalculating = false;
                return; // 合計更新をスキップ
            } else {
                previousValue = this.value;
            }

            // 合計を更新
            updateRowTotals();

            isRecalculating = false;
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
    $('#auto-btn').on('click', autoCalculateOvertime);

    // 週末の休出状態を初期化
    initializeWeekendWorkingStatus();

    // イベントリスナーを設定
    setupEventListeners();

    // 初期表示時にすべての生産数を計算
    updateAllProductionQuantities();
});
