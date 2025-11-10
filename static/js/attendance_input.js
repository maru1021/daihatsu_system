/**
 * 勤怠入力フォーム用JavaScript
 */
class AttendanceInputForm {
    constructor() {
        this.form = document.getElementById('attendance-form');
        this.validationError = document.getElementById('validation-error');
        this.config = {
            workTime: {
                maxHours: 24,
                breakTimeNormal: 0.75, // 45分
                breakTimeOvertime: 1,   // 1時間
                tolerance: 0
            }
        };
        this.init();
    }

    init() {
        $(document).ready(() => {
            this.initializeComponents();
        });
    }

    // コンポーネントの初期化
    initializeComponents() {
        this.initializeSelect2();
        this.initializeDatepickers();
        this.initializeEmployeeNumberLookup();
        this.initializeShiftTypeChange();
        this.initializeTimeCalculation();
        this.initializeKeyboardShortcuts();
        this.calculateOwnLineOperationHours();
        this.focusEmployeeNumber();
    }

    // Select2の初期化
    initializeSelect2() {
        $('.task-attendance-select').select2({
            width: '100%',
            placeholder: '選択してください'
        });
        $('.support-line-select').select2({
            width: '100%',
            placeholder: 'ラインを選択してください'
        });
    }

    // Datepickerの初期化
    initializeDatepickers() {
        initializeDatepickers();
    }

    // 社員番号入力時の従業員名取得機能
    initializeEmployeeNumberLookup() {
        const employeeNumberInput = document.getElementById('employee_number');
        const employeeNameText = document.getElementById('employee_name_text');
        const employeeNameDisplay = document.getElementById('employee_name_display');

        if (!employeeNumberInput || !employeeNameText || !employeeNameDisplay) {
            return;
        }

        let lookupTimeout = null;

        employeeNumberInput.addEventListener('input', (e) => {
            const employeeNumber = e.target.value.trim();

            // 入力が空の場合または5桁でない場合はリセット
            if (!employeeNumber || employeeNumber.length !== 5 || !/^\d{5}$/.test(employeeNumber)) {
                employeeNameText.textContent = '';
                employeeNameDisplay.style.borderColor = '#e8ecf0';
                return;
            }

            // 前回のタイマーをクリア
            if (lookupTimeout) {
                clearTimeout(lookupTimeout);
            }

            // 5桁の数字の場合のみ検索実行
            this.lookupEmployee(employeeNumber);
        });
    }

    // 従業員情報を取得
    async lookupEmployee(employeeNumber) {
        const employeeNameText = document.getElementById('employee_name_text');
        const employeeNameDisplay = document.getElementById('employee_name_display');

        try {
            // ローディング表示
            employeeNameText.textContent = '検索中...';
            employeeNameText.style.color = '#666';
            employeeNameDisplay.style.borderColor = '#667eea';

            const response = await fetch(`${window.base_url}/actual_production/attendance-input/get-employee/?employee_number=${encodeURIComponent(employeeNumber)}`);
            const data = await response.json();

            if (data.status === 'success') {
                // 成功時
                employeeNameText.textContent = data.employee_name;
                employeeNameText.style.color = '#34495e';
                employeeNameDisplay.style.borderColor = '#27ae60';
            } else {
                // エラー時
                employeeNameText.textContent = '社員番号が登録されていません';
                employeeNameText.style.color = '#e74c3c';
                employeeNameDisplay.style.borderColor = '#e74c3c';
            }
        } catch (error) {
            // ネットワークエラー等
            employeeNameText.textContent = '検索エラーが発生しました';
            employeeNameText.style.color = '#e74c3c';
            employeeNameDisplay.style.borderColor = '#e74c3c';
            console.error('Employee lookup error:', error);
        }
    }

    // 時間関連のユーティリティ
    getCurrentTime() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }



    // 勤務区分変更の初期化
    initializeShiftTypeChange() {
        const shiftTypeSelect = document.getElementById('shift_type');
        if (shiftTypeSelect) {
            shiftTypeSelect.addEventListener('change', () => this.changeShiftType());
            // 初期値を設定
            this.setInitialShiftType();
        }
    }

    // 初期勤務区分を設定
    setInitialShiftType() {
        const current = new Date();
        const currentTime = current.getHours() + current.getMinutes() / 60;

        // 現在時刻から8時間45分を引いた時刻を計算
        let startTime = currentTime - 8.75; // 8時間45分 = 8.75時間

        // 負の値になった場合は前日として扱う
        if (startTime < 0) {
            startTime += 24;
        }

        const shiftTypeSelect = document.getElementById('shift_type');

        // 8:00と20:00のどちらに近いかで判別
        const distanceTo8 = Math.min(Math.abs(startTime - 8), Math.abs(startTime - 8 + 24), Math.abs(startTime - 8 - 24));
        const distanceTo20 = Math.min(Math.abs(startTime - 20), Math.abs(startTime - 20 + 24), Math.abs(startTime - 20 - 24));

        if (distanceTo8 <= distanceTo20) {
            shiftTypeSelect.value = 'day';
        } else {
            shiftTypeSelect.value = 'night';
        }

        // 開始時間も設定
        this.changeShiftType();
    }

    // 勤務区分に応じて開始時間を変更
    changeShiftType() {
        const shiftType = document.getElementById('shift_type').value;
        const startTimeInput = document.getElementById('start_time');

        if (shiftType === 'day') {
            startTimeInput.value = '08:00';
        } else {
            startTimeInput.value = '20:00';
        }

        // 開始時間が変更されたので終了時間を再計算
        this.calculateEndTime();
    }

    // 社員番号フィールドにフォーカス
    focusEmployeeNumber() {
        const employeeNumberInput = document.getElementById('employee_number');
        if (employeeNumberInput) {
            employeeNumberInput.focus();
        }
    }

    // キーボードショートカットの初期化
    initializeKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Enterキーが押された場合
            if (e.key === 'Enter') {
                // Select2のドロップダウンが開いている場合は何もしない
                if (document.querySelector('.select2-dropdown')) {
                    return;
                }

                // フォーカスがあるフィールドがSelect2の場合は何もしない
                const activeElement = document.activeElement;
                if (activeElement && activeElement.classList.contains('select2-search__field')) {
                    return;
                }

                // フォームを送信
                e.preventDefault();
                this.submitForm();
            }
        });
    }

    // 自ライン稼働時間を計算
    calculateOwnLineOperationHours() {
        let totalTaskHours = 0;
        let totalSupportHours = 0;

        // 業務内容の残業でない時間を合計
        document.querySelectorAll('[name="task_hours"]').forEach((input) => {
            const hours = parseFloat(input.value) || 0;
            if (hours > 0) {
                // 同じ行の残業チェックボックスを取得
                const taskRow = input.closest('.task-item-grid');
                const overtimeCheckbox = taskRow ? taskRow.querySelector('[name="task_overtime"]') : null;
                if (!overtimeCheckbox || !overtimeCheckbox.checked) {
                    totalTaskHours += hours;
                }
            }
        });

        // 応援の残業でない時間を合計
        document.querySelectorAll('[name="support_hours"]').forEach((input) => {
            const hours = parseFloat(input.value) || 0;
            if (hours > 0) {
                // 同じ行の残業チェックボックスを取得
                const supportRow = input.closest('.task-item-grid');
                const overtimeCheckbox = supportRow ? supportRow.querySelector('[name="support_overtime"]') : null;
                if (!overtimeCheckbox || !overtimeCheckbox.checked) {
                    totalSupportHours += hours;
                }
            }
        });

        // 8時間から業務内容と応援の残業でない時間を引いた値
        const ownLineHours = Math.max(0, 8 - totalTaskHours - totalSupportHours);

        document.getElementById('own_line_operation_hours').value = ownLineHours.toFixed(1);
    }

    // 初期終了時間を設定（16:45または4:45の近い方）
    setInitialEndTime() {
        const current = new Date();
        const currentHour = current.getHours() + current.getMinutes() / 60;

        // 現在時刻に応じて16:45または4:45に近い方を選択
        // 12時以前なら4:45、12時以降なら16:45
        const initialEndTime = currentHour < 12 ? '04:45' : '16:45';
        document.getElementById('end_time').value = initialEndTime;
    }

    // 時間計算機能の初期化
    initializeTimeCalculation() {
        // 開始時間の変更監視
        const startTimeInput = document.getElementById('start_time');
        if (startTimeInput) {
            startTimeInput.addEventListener('change', () => this.calculateEndTime());
            // 初期ロード時に計算実行
            if (startTimeInput.value) {
                this.calculateEndTime();
            } else {
                // 開始時間が無い場合は初期終了時間を設定
                this.setInitialEndTime();
            }
        }

        // 残業時間の変更監視
        const productionOvertimeInput = document.getElementById('production_overtime');
        if (productionOvertimeInput) {
            productionOvertimeInput.addEventListener('input', () => this.calculateEndTime());
        }

        // 業務時間・応援時間の変更監視（残業チェックボックスも含む）
        document.addEventListener('change', (e) => {
            if (e.target.name === 'task_overtime' ||
                e.target.name === 'support_overtime' ||
                e.target.name === 'task_hours' ||
                e.target.name === 'support_hours') {
                this.calculateEndTime();
                this.calculateOwnLineOperationHours();
            }
        });

        document.addEventListener('input', (e) => {
            if (e.target.name === 'task_hours' ||
                e.target.name === 'support_hours') {
                this.calculateOwnLineOperationHours();
            }
        });
    }

    // 終了時間を自動計算
    calculateEndTime() {
        const startTime = document.getElementById('start_time').value;
        if (!startTime) return;

        try {
            // 基本勤務時間（8時間）+ 休憩時間を計算
            const totalOvertimeHours = this.calculateTotalOvertimeHours();
            const hasOvertime = totalOvertimeHours > 0;
            const breakTime = this.calculateBreakTime(hasOvertime);

            let endTime;
            if (hasOvertime) {
                // 残業ありの場合：8時間 + 残業時間
                const workHours = 8 + totalOvertimeHours;
                endTime = this.addHoursToTime(startTime, workHours + breakTime);
            } else {
                // 残業なしの場合：開始時間から8時間45分後（8時間 + 45分休憩）
                endTime = this.addHoursToTime(startTime, 8.75);
            }

            document.getElementById('end_time').value = endTime;

        } catch (error) {
            console.error('時間計算エラー:', error);
        }
    }

    // 残業なしの場合の勤務時間を計算
    calculateNormalWorkHours(startTime) {
        const current = new Date();
        const currentHour = current.getHours() + current.getMinutes() / 60;

        // 現在時刻に応じて16:45または4:45に近い方を選択
        // 12時以前なら4:45、12時以降なら16:45に近いと判断
        const targetEndTime = currentHour < 12 ? '04:45' : '16:45';

        const start = new Date(`2000-01-01 ${startTime}`);
        let end = new Date(`2000-01-01 ${targetEndTime}`);

        // 夜勤の場合（終了時間が開始時間より前）は翌日とみなす
        if (end <= start) {
            end = new Date(`2000-01-02 ${targetEndTime}`);
        }

        return (end - start) / (1000 * 60 * 60);
    }

    // 残業時間の合計を計算
    calculateTotalOvertimeHours() {
        let totalOvertime = 0;

        // 生産残業時間
        const productionOvertime = parseFloat(document.getElementById('production_overtime').value) || 0;
        totalOvertime += productionOvertime;

        // 業務内容の残業時間
        document.querySelectorAll('[name="task_overtime"]').forEach(checkbox => {
            if (checkbox.checked) {
                const hoursInput = checkbox.closest('.task-item-grid').querySelector('[name="task_hours"]');
                const hours = parseFloat(hoursInput.value) || 0;
                totalOvertime += hours;
            }
        });

        // 応援の残業時間
        document.querySelectorAll('[name="support_overtime"]').forEach(checkbox => {
            if (checkbox.checked) {
                const hoursInput = checkbox.closest('.task-item-grid').querySelector('[name="support_hours"]');
                const hours = parseFloat(hoursInput.value) || 0;
                totalOvertime += hours;
            }
        });

        return totalOvertime;
    }

    // 時間に指定した時間数を加算
    addHoursToTime(timeString, hours) {
        const baseDate = new Date(`2000-01-01 ${timeString}`);
        const newTime = new Date(baseDate.getTime() + hours * 60 * 60 * 1000);

        const hoursStr = String(newTime.getHours()).padStart(2, '0');
        const minutesStr = String(newTime.getMinutes()).padStart(2, '0');

        return `${hoursStr}:${minutesStr}`;
    }

    // 開始時間の初期値を取得
    getDefaultStartTime() {
        const currentHour = new Date().getHours();
        if (currentHour <= 11) {
            return "20:00";
        } else if (currentHour <= 23) {
            return "08:00";
        } else {
            return "20:00";
        }
    }

    // 勤務時間を計算（夜勤対応）
    calculateWorkHours(startTime, endTime) {
        const start = new Date(`2000-01-01 ${startTime}`);
        let end = new Date(`2000-01-01 ${endTime}`);

        // 夜勤の場合：終了時間が開始時間より前なら翌日とみなす
        if (end <= start) {
            end = new Date(`2000-01-02 ${endTime}`);
        }

        return (end - start) / (1000 * 60 * 60);
    }

    // データ収集のヘルパー関数
    collectItemData(itemElement, selectors) {
        const data = {};
        for (const [key, selector] of Object.entries(selectors)) {
            const element = itemElement.querySelector(selector);
            if (!element) return null;

            if (element.type === 'checkbox') {
                data[key] = element.checked;
            } else {
                data[key] = element.value;
            }
        }
        return data;
    }

    // 業務内容データを収集
    collectTasksData() {
        const tasks = [];
        const selectors = {
            attendance_select_id: '[name="task_attendance_select"]',
            hours: '[name="task_hours"]',
            overtime: '[name="task_overtime"]'
        };

        document.querySelectorAll('.task-item-grid').forEach(item => {
            const data = this.collectItemData(item, selectors);
            if (data && data.attendance_select_id && data.hours && parseFloat(data.hours) > 0) {
                tasks.push({
                    attendance_select_id: data.attendance_select_id,
                    hours: parseFloat(data.hours),
                    overtime: data.overtime
                });
            }
        });
        return tasks;
    }

    // 応援データを収集
    collectSupportsData() {
        const supports = [];

        document.querySelectorAll('[name="support_line"]').forEach(select => {
            const item = select.closest('.task-item-grid');
            const selectors = {
                line_id: '[name="support_line"]',
                hours: '[name="support_hours"]',
                overtime: '[name="support_overtime"]'
            };

            const data = this.collectItemData(item, selectors);
            if (data && data.line_id && data.hours && parseFloat(data.hours) > 0) {
                supports.push({
                    line_id: data.line_id,
                    hours: parseFloat(data.hours),
                    overtime: data.overtime
                });
            }
        });
        return supports;
    }

    // バリデーションルール
    getValidationRules() {
        return [
            {
                field: 'employee_number',
                check: (value) => !value?.trim(),
                message: '社員番号を入力してください'
            },
            {
                field: 'attendance_date',
                check: (value) => !value,
                message: '日付を選択してください'
            },
            {
                field: 'start_time',
                check: (value) => !value,
                message: '開始時間を入力してください'
            },
            {
                field: 'end_time',
                check: (value) => !value,
                message: '終了時間を入力してください'
            }
        ];
    }

    // 基本バリデーション
    validateBasicFields(data) {
        const errors = [];
        const rules = this.getValidationRules();

        rules.forEach(rule => {
            if (rule.check(data[rule.field])) {
                errors.push(rule.message);
            }
        });

        return errors;
    }

    // 時間バリデーション
    validateTimeFields(data) {
        const errors = [];

        if (data.start_time && data.end_time) {
            const workHours = this.calculateWorkHours(data.start_time, data.end_time);

            if (workHours > this.config.workTime.maxHours) {
                errors.push('勤務時間が24時間を超えています');
            }

            const workTimeError = this.validateWorkTimeTotal(data, workHours);
            if (workTimeError) {
                errors.push(workTimeError);
            }
        }

        return errors;
    }

    // メインバリデーション
    validateForm(data) {
        const basicErrors = this.validateBasicFields(data);
        const timeErrors = this.validateTimeFields(data);

        return [...basicErrors, ...timeErrors];
    }

    // 時間合計を計算
    calculateTotalTaskHours(data) {
        let totalHours = 0;
        let normalHours = 0;
        let hasOvertime = false;

        // 自ライン稼働時間（通常時間）
        totalHours += data.own_line_operation_hours;
        normalHours += data.own_line_operation_hours;

        // 生産残業時間（残業時間）
        totalHours += data.production_overtime;
        if (data.production_overtime > 0) {
            hasOvertime = true;
        }

        // 業務内容の時間を合計
        data.tasks.forEach(task => {
            totalHours += task.hours;
            if (task.overtime) {
                hasOvertime = true;
            } else {
                normalHours += task.hours;
            }
        });

        // 応援の時間を合計
        data.supports.forEach(support => {
            totalHours += support.hours;
            if (support.overtime) {
                hasOvertime = true;
            } else {
                normalHours += support.hours;
            }
        });

        return { totalHours, normalHours, hasOvertime };
    }

    // 休憩時間を計算
    calculateBreakTime(hasOvertime) {
        return hasOvertime
            ? this.config.workTime.breakTimeOvertime
            : this.config.workTime.breakTimeNormal;
    }

    // 勤務時間合計の検証
    validateWorkTimeTotal(data, actualWorkHours) {
        const { totalHours, normalHours, hasOvertime } = this.calculateTotalTaskHours(data);
        const breakTime = this.calculateBreakTime(hasOvertime);

        // 通常時間の上限チェック（8時間）
        if (normalHours > 8) {
            return '残業以外の合計時間は8時間以内にしてください';
        }

        // 期待される勤務時間 = 業務時間合計 + 休憩時間
        const expectedTotalTime = totalHours + breakTime;
        if (Math.abs(actualWorkHours - expectedTotalTime) > this.config.workTime.tolerance) {
            return '勤務時間と業務時間が一致しません';
        }

        return null;
    }

    // ステータスメッセージを表示
    showMessage(message, isError = false) {
        if (isError) {
            // エラーメッセージは基本情報の横に表示し、消さない
            this.validationError.textContent = message;
            this.validationError.style.display = 'block';
            this.validationError.style.color = '#e74c3c';
            this.validationError.style.backgroundColor = 'rgba(231, 76, 60, 0.1)';
        } else {
            // 成功メッセージも基本情報の横に表示
            this.validationError.textContent = '進捗登録が完了しました';
            this.validationError.style.display = 'block';
            this.validationError.style.color = '#27ae60';
            this.validationError.style.backgroundColor = 'rgba(39, 174, 96, 0.1)';

            setTimeout(() => {
                this.validationError.style.display = 'none';
            }, 3000);
        }
    }

    // フォームをリセット
    resetForm() {
        this.form.reset();

        // Select2もリセット
        $('.task-attendance-select').val(null).trigger('change');
        $('.support-line-select').val(null).trigger('change');

        // 従業員情報をクリア
        this.clearEmployeeInfo();

        // 業務内容の初期値を再設定
        this.resetTaskInitialValues();

        // 勤務区分の初期値を再設定
        this.setInitialShiftType();

        // 初期値を再設定
        this.setInitialValues();

        // 自ライン稼働時間を再計算
        this.calculateOwnLineOperationHours();

        // 社員番号フィールドにフォーカス
        this.focusEmployeeNumber();
    }

    // 従業員情報をクリア
    clearEmployeeInfo() {
        const employeeNumberInput = document.getElementById('employee_number');
        const employeeNameText = document.getElementById('employee_name_text');
        const employeeNameDisplay = document.getElementById('employee_name_display');

        if (employeeNumberInput) {
            employeeNumberInput.value = '';
        }

        if (employeeNameText && employeeNameDisplay) {
            employeeNameText.textContent = '';
            employeeNameText.style.color = '#999';
            employeeNameDisplay.style.borderColor = '#e8ecf0';
        }
    }

    // 業務内容の初期値を再設定
    resetTaskInitialValues() {
        // 時間入力フィールドの初期値を空白に設定
        document.querySelectorAll('[name="task_hours"]').forEach(input => {
            input.value = '';
        });

        // Select2の初期選択値を再設定
        document.querySelectorAll('.task-attendance-select').forEach((select, index) => {
            const options = Array.from(select.querySelectorAll('option')).filter(option => option.value !== '');
            if (index < options.length) {
                // index番目のオプションを選択
                const optionValue = options[index].value;
                $(select).val(optionValue).trigger('change');
            } else {
                $(select).val(null).trigger('change');
            }
        });
    }

    // 初期値を設定
    setInitialValues() {
        // 今日の日付を設定
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('attendance_date').value = today;

        // 開始時間の初期値を設定
        document.getElementById('start_time').value = this.getDefaultStartTime();

        // 終了時間を自動計算
        this.calculateEndTime();
    }

    // フォームデータを準備
    prepareSubmitData() {
        const formData = new FormData(this.form);
        const tasks = this.collectTasksData();
        const supports = this.collectSupportsData();


        return {
            employee_number: formData.get('employee_number'),
            attendance_date: formData.get('attendance_date'),
            shift_type: formData.get('shift_type'),
            start_time: formData.get('start_time'),
            end_time: formData.get('end_time'),
            production_overtime: parseFloat(formData.get('production_overtime') || 0),
            own_line_operation_hours: parseFloat(formData.get('own_line_operation_hours') || 0),
            tasks: tasks,
            supports: supports
        };
    }

    // サーバーへデータを送信
    async sendToServer(submitData) {
        const response = await fetch(`${window.base_url}/actual_production/attendance-input/submit/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(submitData)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    }

    // 送信結果を処理
    handleSubmitResponse(data) {
        if (data.status === 'success') {
            this.showMessage(data.message, false);
            this.resetForm();
        } else {
            this.showMessage(data.message, true);
        }
    }

    // フォーム送信
    async submitForm() {
        try {
            // 送信前に自ライン稼働時間フィールドを有効化
            const ownLineInput = document.getElementById('own_line_operation_hours');
            const ownLineWasDisabled = ownLineInput.disabled;
            ownLineInput.disabled = false;

            // データ準備
            const submitData = this.prepareSubmitData();

            // フィールドを元の状態に戻す
            ownLineInput.disabled = ownLineWasDisabled;

            // バリデーション
            const validationErrors = this.validateForm(submitData);
            if (validationErrors.length > 0) {
                this.showMessage(validationErrors.join('\n'), true);
                return;
            }

            // サーバー送信
            const responseData = await this.sendToServer(submitData);

            // 結果処理
            this.handleSubmitResponse(responseData);

        } catch (error) {
            console.error('Error:', error);
            this.showMessage('送信中にエラーが発生しました: ' + error.message, true);
        }
    }
}

// グローバル関数（レガシー対応）
let attendanceForm;

document.addEventListener('DOMContentLoaded', function() {
    attendanceForm = new AttendanceInputForm();
});

function setCurrentTime() {
    if (attendanceForm) {
        attendanceForm.setCurrentTime();
    }
}

function submitForm() {
    if (attendanceForm) {
        attendanceForm.submitForm();
    }
}