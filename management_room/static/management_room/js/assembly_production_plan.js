// ========================================
// グローバル変数
// ========================================
// itemData - 品番データ（HTMLから渡される）

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

// ========================================
// 定時チェック機能
// ========================================
const debouncedUpdateWorkingDayStatus = debounce(function(dateIndex) {
    updateWorkingDayStatus(dateIndex);
}, 100);

function toggleCheck(element) {
    const isWeekend = element.getAttribute('data-weekend') === 'true';
    const currentText = element.textContent;

    if (currentText === '') {
        element.textContent = isWeekend ? '休出' : '定時';
    } else {
        element.textContent = '';
    }

    const dateIndex = Array.from(element.parentElement.children).indexOf(element) - 1;
    debouncedUpdateWorkingDayStatus(dateIndex);
}

// ========================================
// 週末の休出状態を初期化
// ========================================
function initializeWeekendWorkingStatus() {
    document.querySelectorAll('.check-cell').forEach((checkCell, index) => {
        const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
        if (!isWeekend) return;

        const hasWeekendWork = checkCell.getAttribute('data-has-weekend-work') === 'true';

        if (hasWeekendWork) {
            checkCell.textContent = '休出';
        } else {
            checkCell.textContent = '';
            // 休出がない場合は、その日の入力フィールドを非表示にする
            const dateIndex = index;
            const dayInputs = document.querySelectorAll(
                `[data-shift="day"][data-date-index="${dateIndex}"] input`
            );
            dayInputs.forEach(input => {
                input.style.display = 'none';
            });

            const nightInputs = document.querySelectorAll(
                `[data-shift="night"][data-date-index="${dateIndex}"] input`
            );
            nightInputs.forEach(input => {
                input.style.display = 'none';
            });
        }
    });
}

// ========================================
// 稼働日状態の更新
// ========================================
function updateWorkingDayStatus(dateIndex) {
    const checkCells = document.querySelectorAll('.check-cell');
    const checkCell = checkCells[dateIndex];

    if (!checkCell) return;

    const isWeekend = checkCell.getAttribute('data-weekend') === 'true';
    const checkText = checkCell.textContent.trim();

    if (isWeekend) {
        // 週末の場合
        const isWorking = checkText === '休出';

        // 日勤の入力フィールドを制御
        const dayInputs = document.querySelectorAll(
            `[data-shift="day"][data-date-index="${dateIndex}"] input`
        );
        dayInputs.forEach(input => {
            input.style.display = isWorking ? '' : 'none';
        });

        // 夜勤は週末は常に非表示
        const nightInputs = document.querySelectorAll(
            `[data-shift="night"][data-date-index="${dateIndex}"] input`
        );
        nightInputs.forEach(input => {
            input.style.display = 'none';
        });

        // 残業計画の上限値を設定（休出の場合は制限なし、それ以外は0）
        const overtimeInputs = document.querySelectorAll(
            `.overtime-input[data-date-index="${dateIndex}"]`
        );
        overtimeInputs.forEach(input => {
            if (isWorking) {
                input.removeAttribute('max');
            } else {
                input.setAttribute('max', '0');
                input.value = '0';
            }
        });
    } else {
        // 平日の場合
        const isWorking = checkText === '定時';

        // 定時日の残業計画の上限値を0に設定、それ以外は制限なし
        const dayOvertimeInput = document.querySelector(
            `.overtime-input[data-shift="day"][data-date-index="${dateIndex}"]`
        );
        const nightOvertimeInput = document.querySelector(
            `.overtime-input[data-shift="night"][data-date-index="${dateIndex}"]`
        );

        if (isWorking) {
            // 定時の場合は残業計画の上限を0に設定
            if (dayOvertimeInput) {
                dayOvertimeInput.setAttribute('max', '0');
                dayOvertimeInput.value = '0';
            }
            if (nightOvertimeInput) {
                nightOvertimeInput.setAttribute('max', '0');
                nightOvertimeInput.value = '0';
            }
        } else {
            // 定時でない場合（空白の場合）は上限を元に戻す
            if (dayOvertimeInput) {
                dayOvertimeInput.setAttribute('max', '120');
            }
            if (nightOvertimeInput) {
                nightOvertimeInput.setAttribute('max', '60');
            }
        }
    }
}

// ========================================
// ライン選択変更時の処理
// ========================================
function handleLineChange() {
    const lineId = $('#line-select').val();
    const targetMonth = $('#target-month').val();
    if (lineId && targetMonth) {
        const [year, month] = targetMonth.split('-');
        window.location.href = `?line=${lineId}&year=${year}&month=${month}`;
    }
}

// ========================================
// 月選択変更時の処理
// ========================================
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

    const planData = [];

    // 生産数データを収集
    document.querySelectorAll('[data-section="production"]').forEach(row => {
        const shift = row.getAttribute('data-shift');
        const itemName = row.querySelector('.vehicle-label').textContent;

        row.querySelectorAll('.production-input').forEach(input => {
            if (input.style.display === 'none') return;

            const dateIndex = parseInt(input.getAttribute('data-date-index'));
            const value = parseInt(input.value) || 0;

            planData.push({
                item_name: itemName,
                date_index: dateIndex,
                shift: shift,
                production_quantity: value
            });
        });
    });

    // 残業データを収集
    document.querySelectorAll('[data-section="overtime"]').forEach(row => {
        const shift = row.getAttribute('data-shift');

        row.querySelectorAll('.overtime-input').forEach(input => {
            if (input.style.display === 'none') return;

            const dateIndex = parseInt(input.getAttribute('data-date-index'));
            const value = parseInt(input.value) || 0;

            // この日付・シフトのすべての品番データに残業時間を追加
            planData.forEach(data => {
                if (data.date_index === dateIndex && data.shift === shift) {
                    data.overtime = value;
                }
            });
        });
    });

    // 計画停止データを収集
    document.querySelectorAll('[data-section="stop_time"]').forEach(row => {
        const shift = row.getAttribute('data-shift');

        row.querySelectorAll('.stop-time-input').forEach(input => {
            if (input.style.display === 'none') return;

            const dateIndex = parseInt(input.getAttribute('data-date-index'));
            const value = parseInt(input.value) || 0;

            // この日付・シフトのすべての品番データに計画停止時間を追加
            planData.forEach(data => {
                if (data.date_index === dateIndex && data.shift === shift) {
                    data.stop_time = value;
                }
            });
        });
    });

    // 稼働率データを収集
    const occupancyRates = [];
    document.querySelectorAll('.operation-rate-input').forEach(input => {
        const dateIndex = parseInt(input.getAttribute('data-date-index'));
        const value = parseFloat(input.value) || 0;

        occupancyRates.push({
            date_index: dateIndex,
            occupancy_rate: value
        });
    });

    // CSRFトークンを取得
    const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;

    // 保存リクエスト送信
    const lineId = $('#line-select').val();
    const targetMonth = $('#target-month').val();
    const [year, month] = targetMonth.split('-');

    fetch(`?line=${lineId}&year=${year}&month=${month}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken
        },
        body: JSON.stringify({
            plan_data: planData,
            occupancy_rates: occupancyRates
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            alert('保存しました');
            location.reload();
        } else {
            alert('保存に失敗しました: ' + data.message);
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('保存中にエラーが発生しました');
    })
    .finally(() => {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';
    });
}

// ========================================
// 初期化処理
// ========================================
$(document).ready(function() {
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
});
