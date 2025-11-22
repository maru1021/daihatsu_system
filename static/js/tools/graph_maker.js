/**
 * グラフツクール君2号
 * CSV/Excelファイルを読み込み、グラフを作成・操作するツール
 */

// ===========================
// 定数定義
// ===========================

// 色系統ごとの配色（各系統に4色）- 隣接する色が最大限異なるように配置
const COLOR_FAMILIES = [
    ['rgb(220, 38, 38)', 'rgb(239, 68, 68)', 'rgb(185, 28, 28)', 'rgb(248, 113, 113)'],
    ['rgb(8, 145, 178)', 'rgb(6, 182, 212)', 'rgb(14, 116, 144)', 'rgb(34, 211, 238)'],
    ['rgb(234, 88, 12)', 'rgb(249, 115, 22)', 'rgb(194, 65, 12)', 'rgb(251, 146, 60)'],
    ['rgb(37, 99, 235)', 'rgb(59, 130, 246)', 'rgb(29, 78, 216)', 'rgb(96, 165, 250)'],
    ['rgb(22, 163, 74)', 'rgb(34, 197, 94)', 'rgb(21, 128, 61)', 'rgb(74, 222, 128)'],
    ['rgb(147, 51, 234)', 'rgb(168, 85, 247)', 'rgb(126, 34, 206)', 'rgb(192, 132, 252)'],
    ['rgb(234, 179, 8)', 'rgb(250, 204, 21)', 'rgb(202, 138, 4)', 'rgb(253, 224, 71)'],
    ['rgb(219, 39, 119)', 'rgb(236, 72, 153)', 'rgb(190, 24, 93)', 'rgb(244, 114, 182)']
];

const BLINK_INTERVAL = 1200; // 点滅間隔(ms)
let PAN_SPEED_X = 5; // X軸パン速度（デフォルト値）
let PAN_SPEED_Y = 0.05; // Y軸パン速度（デフォルト値）

// ===========================
// グローバル変数
// ===========================

let chart = null;
let uploadedFiles = [];
let fileOffsets = new Map();
let preserveZoom = false;
let savedZoomState = null;
let datasetVisibility = new Map();
let blinkTimer = null;
let blinkState = true;

// 閾値設定
let upperThresholdValue = null;
let lowerThresholdValue = null;

// UI設定
let tooltipEnabled = false;
let tooltipSingleMode = false; // 凡例(単体)モード
let smoothColumnName = ''; // 移動平均を適用する列名
let smoothWindow = 1; // 移動平均ウィンドウサイズ
let xAxisPattern = '';
let excludedColumns = [];
let excludedFiles = [];
let chartType = 'line';

// 第2軸設定（最大3つ）
let yAxisConfigs = [
    { enabled: false, pattern: '', axis: 'y2', chartType: 'line' },
    { enabled: false, pattern: '', axis: 'y2', chartType: 'line' },
    { enabled: false, pattern: '', axis: 'y2', chartType: 'line' }
];

// キーボード操作用
const keysPressed = {
    ArrowRight: false,
    ArrowLeft: false,
    ArrowUp: false,
    ArrowDown: false
};
let animationFrameId = null;

// スクロールバー用
let isScrollbarUpdating = false; // スクロールバー更新中フラグ（無限ループ防止）

// ===========================
// DOM要素の取得
// ===========================

const elements = {
    csvInput: document.getElementById('csvInput'),
    resetZoomBtn: document.getElementById('resetZoomBtn'),
    exportCsvBtn: document.getElementById('exportCsvBtn'),
    fileListContainer: document.getElementById('fileListContainer'),
    controlsContainer: document.getElementById('controlsContainer'),
    legendCheckbox: document.getElementById('legendCheckbox'),
    tooltipSingleCheckbox: document.getElementById('tooltipSingleCheckbox'),
    smoothColumnSelect: document.getElementById('smoothColumnSelect'),
    smoothWindowInput: document.getElementById('smoothWindow'),
    xAxisSelect: document.getElementById('xAxisSelect'),
    chartTypeSelect: document.getElementById('chartTypeSelect'),
    excludeContainer: document.getElementById('excludeContainer'),
    upperThresholdInput: document.getElementById('upperThreshold'),
    lowerThresholdInput: document.getElementById('lowerThreshold'),
    panSpeedXInput: document.getElementById('panSpeedX'),
    panSpeedYInput: document.getElementById('panSpeedY'),
    xScrollbar: document.getElementById('xScrollbar'),
    yScrollbar: document.getElementById('yScrollbar'),
    yAxisElements: [
        {
            select: document.getElementById('yAxis1Select'),
            check: document.getElementById('yAxis1Check'),
            input: document.getElementById('yAxis1Input'),
            columnSelect: document.getElementById('yAxis1ColumnSelect'),
            typeSelect: document.getElementById('yAxis1TypeSelect')
        },
        {
            select: document.getElementById('yAxis2Select'),
            check: document.getElementById('yAxis2Check'),
            input: document.getElementById('yAxis2Input'),
            columnSelect: document.getElementById('yAxis2ColumnSelect'),
            typeSelect: document.getElementById('yAxis2TypeSelect')
        },
        {
            select: document.getElementById('yAxis3Select'),
            check: document.getElementById('yAxis3Check'),
            input: document.getElementById('yAxis3Input'),
            columnSelect: document.getElementById('yAxis3ColumnSelect'),
            typeSelect: document.getElementById('yAxis3TypeSelect')
        }
    ]
};

// ===========================
// ユーティリティ関数
// ===========================

/**
 * RGB文字列をRGBAに変換
 */
function rgbToRgba(rgb, alpha) {
    return rgb.replace('rgb', 'rgba').replace(')', `, ${alpha})`);
}

/**
 * 移動平均でスムージング
 */
function applyMovingAverage(data, windowSize) {
    if (windowSize <= 1) return data;

    const smoothed = [];
    for (let i = 0; i < data.length; i++) {
        let sum = 0;
        let count = 0;
        const halfWindow = Math.floor(windowSize / 2);

        for (let j = Math.max(0, i - halfWindow); j <= Math.min(data.length - 1, i + halfWindow); j++) {
            sum += data[j].y;
            count++;
        }

        smoothed.push({
            x: data[i].x,
            y: sum / count
        });
    }
    return smoothed;
}

/**
 * 現在のズーム状態を保存
 */
function saveCurrentZoomState() {
    if (!chart) return;

    savedZoomState = {
        x: { min: chart.scales.x.min, max: chart.scales.x.max },
        y: { min: chart.scales.y.min, max: chart.scales.y.max },
        y2: chart.scales.y2 ? { min: chart.scales.y2.min, max: chart.scales.y2.max } : undefined,
        y3: chart.scales.y3 ? { min: chart.scales.y3.min, max: chart.scales.y3.max } : undefined,
        y4: chart.scales.y4 ? { min: chart.scales.y4.min, max: chart.scales.y4.max } : undefined
    };
    preserveZoom = true;

    // スクロールバーを更新
    updateScrollbarsFromChart();
}

/**
 * グラフの現在位置に基づいてスクロールバーを更新
 */
function updateScrollbarsFromChart() {
    if (!chart || isScrollbarUpdating) return;

    isScrollbarUpdating = true;

    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    const xLimits = chart.options.plugins.zoom.limits.x;
    const yLimits = chart.options.plugins.zoom.limits.y;

    const xScrollbarContainer = document.querySelector('.chart-x-scrollbar-container');
    const yScrollbarContainer = document.querySelector('.chart-y-scrollbar-container');

    if (xScale && xLimits) {
        // X軸のスクロールバー位置を計算（0-100の範囲）
        const xViewRange = xScale.max - xScale.min;
        const xScrollableRange = (xLimits.max - xLimits.min) - xViewRange;

        if (xScrollableRange > 0.001) { // 微小な差は無視（浮動小数点誤差対策）
            // スクロール可能 → スクロールバーを表示
            xScrollbarContainer.style.display = 'flex';
            const xPosition = ((xScale.min - xLimits.min) / xScrollableRange) * 100;
            elements.xScrollbar.value = Math.max(0, Math.min(100, xPosition));
        } else {
            // スクロール不要 → スクロールバーを非表示
            xScrollbarContainer.style.display = 'none';
            elements.xScrollbar.value = 0;
        }
    }

    if (yScale && yLimits) {
        // Y軸のスクロールバー位置を計算（0-100の範囲）
        const yViewRange = yScale.max - yScale.min;
        const yScrollableRange = (yLimits.max - yLimits.min) - yViewRange;

        if (yScrollableRange > 0.001) { // 微小な差は無視（浮動小数点誤差対策）
            // スクロール可能 → スクロールバーを表示
            yScrollbarContainer.style.display = 'flex';
            const yPosition = ((yScale.min - yLimits.min) / yScrollableRange) * 100;
            elements.yScrollbar.value = Math.max(0, Math.min(100, yPosition));
        } else {
            // スクロール不要 → スクロールバーを非表示
            yScrollbarContainer.style.display = 'none';
            elements.yScrollbar.value = 0;
        }
    }

    isScrollbarUpdating = false;
}

/**
 * スクロールバーの位置からグラフをパン
 */
function panFromScrollbar(axis, scrollValue) {
    if (!chart || isScrollbarUpdating) return;

    const scale = chart.scales[axis];
    const limits = chart.options.plugins.zoom.limits[axis];

    if (!scale || !limits) return;

    // スクロールバーの値（0-100）をグラフの位置に変換
    const viewRange = scale.max - scale.min;
    const scrollableRange = (limits.max - limits.min) - viewRange;

    // スクロール位置からminを計算
    // scrollValue = 0 → min = limits.min（左端/下端）
    // scrollValue = 100 → min = limits.max - viewRange（右端/上端）
    const newMin = limits.min + (scrollableRange * scrollValue / 100);

    // 範囲を制限内に収める
    const clampedMin = Math.max(limits.min, Math.min(limits.max - viewRange, newMin));
    const clampedMax = clampedMin + viewRange;

    // チャートを更新
    chart.scales[axis].options.min = clampedMin;
    chart.scales[axis].options.max = clampedMax;

    // Y軸の場合は第2～第4軸も一緒に移動
    if (axis === 'y') {
        ['y2', 'y3', 'y4'].forEach(yAxis => {
            if (chart.scales[yAxis]) {
                const yScale = chart.scales[yAxis];
                const yLimits = chart.options.plugins.zoom.limits[yAxis];

                if (yLimits) {
                    const yViewRange = yScale.max - yScale.min;
                    const yScrollableRange = (yLimits.max - yLimits.min) - yViewRange;

                    const yNewMin = yLimits.min + (yScrollableRange * scrollValue / 100);

                    const yClampedMin = Math.max(yLimits.min, Math.min(yLimits.max - yViewRange, yNewMin));
                    const yClampedMax = yClampedMin + yViewRange;

                    chart.scales[yAxis].options.min = yClampedMin;
                    chart.scales[yAxis].options.max = yClampedMax;
                }
            }
        });
    }

    chart.update('none');

    saveCurrentZoomState();
}

/**
 * 軸をパン（移動）する
 */
function panAxis(axis, delta) {
    if (!chart || !chart.scales[axis]) return;

    const scale = chart.scales[axis];
    const currentRange = scale.max - scale.min;
    const chartArea = chart.chartArea;
    const dimension = axis === 'x'
        ? chartArea.right - chartArea.left
        : chartArea.bottom - chartArea.top;
    const pixelPerUnit = dimension / currentRange;
    const deltaInPixels = delta * pixelPerUnit;

    const panConfig = {};
    panConfig[axis] = deltaInPixels;
    chart.pan(panConfig, undefined, 'none');

    // Y軸の場合は第2～第4軸も一緒に移動
    if (axis === 'y') {
        ['y2', 'y3', 'y4'].forEach(yAxis => {
            if (chart.scales[yAxis]) {
                const yScale = chart.scales[yAxis];
                const yLimits = chart.options.plugins.zoom.limits[yAxis];

                if (yLimits) {
                    const yCurrentRange = yScale.max - yScale.min;
                    let yNewMin = yScale.min + delta;
                    let yNewMax = yScale.max + delta;

                    // 範囲を制限内に収める
                    if (yNewMin < yLimits.min) {
                        yNewMin = yLimits.min;
                        yNewMax = yLimits.min + yCurrentRange;
                    }
                    if (yNewMax > yLimits.max) {
                        yNewMax = yLimits.max;
                        yNewMin = yLimits.max - yCurrentRange;
                    }

                    chart.scales[yAxis].options.min = yNewMin;
                    chart.scales[yAxis].options.max = yNewMax;
                }
            }
        });

        // 第2軸以降を更新した場合は再描画
        chart.update('none');
    }

    saveCurrentZoomState();
}

/**
 * 第2軸のIDを取得
 */
function getYAxisID(label) {
    const columnName = label.split(' - ')[1] || '';

    for (let config of yAxisConfigs) {
        if (config.pattern && config.pattern.trim() !== '') {
            const isMatch = config.enabled
                ? columnName.includes(config.pattern.trim())
                : columnName === config.pattern.trim();

            if (isMatch) return config.axis;
        }
    }
    return 'y';
}

/**
 * グラフの種類を取得
 */
function getChartType(label) {
    const columnName = label.split(' - ')[1] || '';

    for (let config of yAxisConfigs) {
        if (config.pattern && config.pattern.trim() !== '') {
            const isMatch = config.enabled
                ? columnName.includes(config.pattern.trim())
                : columnName === config.pattern.trim();

            if (isMatch) return config.chartType;
        }
    }
    return chartType;
}

// ===========================
// ファイル解析関数
// ===========================

/**
 * CSVファイルを解析
 */
function parseCSV(text, fileName, offset = 0) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) {
        throw new Error('CSVファイルが空か、データが不足しています');
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const columnCount = headers.length;

    if (columnCount < 1) {
        throw new Error('CSVファイルには少なくとも1列が必要です');
    }

    const datasets = headers.map((header) => ({
        label: `${fileName} - ${header}`,
        data: []
    }));

    const dataRowCount = lines.length - 1;
    const minIndex = offset;
    const maxIndex = offset + dataRowCount - 1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = line.split(',');
        if (values.length >= 1) {
            const dataIndex = i - 1;
            const xValue = (dataIndex + offset).toString();

            for (let col = 0; col < Math.min(values.length, columnCount); col++) {
                const yValue = parseFloat(values[col].trim());
                if (!isNaN(yValue)) {
                    datasets[col].data.push({ x: xValue, y: yValue });
                }
            }
        }
    }

    return { datasets, minIndex, maxIndex, fileName };
}

/**
 * Excelファイルを解析（全シート対応）
 */
async function parseExcel(file, fileName, offset = 0) {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const results = [];

    for (let sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (!jsonData || jsonData.length < 2) continue;

        const headers = jsonData[0].map(h => h ? h.toString().trim() : '');
        const columnCount = headers.length;

        if (columnCount < 1) continue;

        const sheetFileName = workbook.SheetNames.length > 1
            ? `${fileName}_${sheetName}`
            : fileName;

        const datasets = headers.map((header) => ({
            label: `${sheetFileName} - ${header}`,
            data: []
        }));

        const dataRowCount = jsonData.length - 1;
        const minIndex = offset;
        const maxIndex = offset + dataRowCount - 1;

        for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || row.length === 0) continue;

            const dataIndex = i - 1;
            const xValue = (dataIndex + offset).toString();

            for (let col = 0; col < Math.min(row.length, columnCount); col++) {
                const yValue = parseFloat(row[col]);
                if (!isNaN(yValue)) {
                    datasets[col].data.push({ x: xValue, y: yValue });
                }
            }
        }

        results.push({ datasets, minIndex, maxIndex, fileName: sheetFileName });
    }

    if (results.length === 0) {
        throw new Error('Excelファイルに有効なデータシートがありません');
    }

    return results;
}

// ===========================
// UI関連関数
// ===========================

/**
 * ファイルリストを表示
 */
function displayFileList(files) {
    elements.fileListContainer.innerHTML = '';

    files.forEach((file) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item-control';

        const fileName = document.createElement('span');
        fileName.className = 'file-name';
        fileName.textContent = file.name;

        const offsetInput = document.createElement('input');
        offsetInput.type = 'number';
        offsetInput.className = 'offset-input';
        offsetInput.value = '0';
        offsetInput.step = '1';
        offsetInput.placeholder = '位置補正';
        offsetInput.dataset.fileName = file.name;

        offsetInput.addEventListener('input', async (e) => {
            const offset = parseInt(e.target.value) || 0;
            fileOffsets.set(file.name, offset);
            preserveZoom = true;
            await renderChartFromFiles();
        });

        fileItem.appendChild(fileName);
        fileItem.appendChild(offsetInput);
        elements.fileListContainer.appendChild(fileItem);
    });

    elements.controlsContainer.style.display = 'flex';
}

/**
 * 列選択UIを更新
 */
function updateColumnSelects(columnNames) {
    const currentXAxisValue = elements.xAxisSelect.value;
    const currentYAxisValues = elements.yAxisElements.map(el => el.columnSelect.value);
    const currentSmoothColumnValue = elements.smoothColumnSelect.value;

    // X軸select更新
    elements.xAxisSelect.innerHTML = '<option value="">なし</option>';
    Array.from(columnNames).sort().forEach(columnName => {
        const option = document.createElement('option');
        option.value = columnName;
        option.textContent = columnName;
        elements.xAxisSelect.appendChild(option);
    });

    if (currentXAxisValue && columnNames.has(currentXAxisValue)) {
        elements.xAxisSelect.value = currentXAxisValue;
    }

    // 移動平均列select更新
    elements.smoothColumnSelect.innerHTML = '<option value="">なし</option>';
    Array.from(columnNames).sort().forEach(columnName => {
        const option = document.createElement('option');
        option.value = columnName;
        option.textContent = columnName;
        elements.smoothColumnSelect.appendChild(option);
    });

    if (currentSmoothColumnValue && columnNames.has(currentSmoothColumnValue)) {
        elements.smoothColumnSelect.value = currentSmoothColumnValue;
    }

    // Y軸select更新
    elements.yAxisElements.forEach((elems, index) => {
        elems.columnSelect.innerHTML = '<option value="">なし</option>';
        Array.from(columnNames).sort().forEach(columnName => {
            const option = document.createElement('option');
            option.value = columnName;
            option.textContent = columnName;
            elems.columnSelect.appendChild(option);
        });

        if (currentYAxisValues[index] && columnNames.has(currentYAxisValues[index])) {
            elems.columnSelect.value = currentYAxisValues[index];
        }
    });
}

/**
 * 除外チェックボックスを更新
 */
function updateExcludeCheckboxes(columnNames, columnNameToColorFamily, fileDataToOriginalName, parsedData) {
    elements.excludeContainer.innerHTML = '';

    // 列名のチェックボックス
    Array.from(columnNames).sort().forEach(columnName => {
        const label = createExcludeLabel(columnName, columnNameToColorFamily, true);
        elements.excludeContainer.appendChild(label);
    });

    // ファイル/シート名のチェックボックス
    const addedFileNames = new Set();
    parsedData.forEach(fileData => {
        const originalFileName = fileDataToOriginalName.get(fileData.fileName) || fileData.fileName;
        if (addedFileNames.has(originalFileName)) return;
        addedFileNames.add(originalFileName);

        const label = createExcludeLabel(originalFileName, null, false);
        elements.excludeContainer.appendChild(label);
    });
}

/**
 * 除外ラベルを作成
 */
function createExcludeLabel(name, columnNameToColorFamily, isColumn) {
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '3px';
    label.style.cursor = 'pointer';
    label.style.whiteSpace = 'nowrap';
    label.style.padding = '2px 6px';
    label.style.borderRadius = '4px';

    if (isColumn && columnNameToColorFamily) {
        const colorFamilyIndex = columnNameToColorFamily.get(name) || 0;
        const representativeColor = COLOR_FAMILIES[colorFamilyIndex][0];
        label.style.backgroundColor = rgbToRgba(representativeColor, 0.3);
    } else {
        label.style.backgroundColor = 'rgba(128, 128, 128, 0.3)';
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = name;
    checkbox.checked = isColumn
        ? excludedColumns.includes(name)
        : excludedFiles.includes(name);

    checkbox.addEventListener('change', async (e) => {
        const targetArray = isColumn ? excludedColumns : excludedFiles;
        if (e.target.checked) {
            if (!targetArray.includes(name)) targetArray.push(name);
        } else {
            const index = targetArray.indexOf(name);
            if (index > -1) targetArray.splice(index, 1);
        }
        if (chart) {
            preserveZoom = true;
            await renderChartFromFiles();
        }
    });

    const span = document.createElement('span');
    span.textContent = name;
    span.style.fontSize = '12px';
    span.style.fontWeight = '500';

    label.appendChild(checkbox);
    label.appendChild(span);
    return label;
}

// ===========================
// グラフ描画関連関数
// ===========================

/**
 * ファイルからグラフを描画
 */
async function renderChartFromFiles() {
    const parsedData = [];
    let minIndex = 0;
    let maxIndex = 0;

    // 全ファイルを解析
    for (let file of uploadedFiles) {
        try {
            const offset = fileOffsets.get(file.name) || 0;
            const fileName = file.name.toLowerCase();

            if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
                const cleanName = file.name.replace(/\.(xlsx|xls)$/i, '');
                const results = await parseExcel(file, cleanName, offset);

                for (const result of results) {
                    parsedData.push(result);
                    if (result.minIndex < minIndex) minIndex = result.minIndex;
                    if (result.maxIndex > maxIndex) maxIndex = result.maxIndex;
                }
            } else {
                const text = await file.text();
                const cleanName = file.name.replace('.csv', '');
                const result = parseCSV(text, cleanName, offset);

                parsedData.push(result);
                if (result.minIndex < minIndex) minIndex = result.minIndex;
                if (result.maxIndex > maxIndex) maxIndex = result.maxIndex;
            }
        } catch (error) {
            console.error(`Error parsing ${file.name}:`, error);
            alert(`${file.name}の読み込みに失敗しました: ${error.message}`);
        }
    }

    // 列名とファイル名のマッピング
    const columnNames = new Set();
    const fileDataToOriginalName = new Map();

    uploadedFiles.forEach(file => {
        const cleanName = file.name.replace(/\.(csv|xlsx|xls)$/i, '');
        fileDataToOriginalName.set(cleanName, file.name);
    });

    parsedData.forEach(fileData => {
        const originalFile = uploadedFiles.find(f => {
            const cleanName = f.name.replace(/\.(csv|xlsx|xls)$/i, '');
            return fileData.fileName === cleanName || fileData.fileName.startsWith(cleanName + '_');
        });
        if (originalFile) {
            fileDataToOriginalName.set(fileData.fileName, originalFile.name);
        }

        const originalFileName = fileDataToOriginalName.get(fileData.fileName) || fileData.fileName;
        if (!excludedFiles.includes(originalFileName)) {
            fileData.datasets.forEach(dataset => {
                const columnName = dataset.label.split(' - ')[1];
                if (columnName) columnNames.add(columnName);
            });
        }
    });

    // UI更新
    updateColumnSelects(columnNames);

    // 色系統の割り当て
    const columnNameToColorFamily = new Map();
    let nextColorFamily = 0;
    Array.from(columnNames).sort().forEach(columnName => {
        columnNameToColorFamily.set(columnName, nextColorFamily % COLOR_FAMILIES.length);
        nextColorFamily++;
    });

    updateExcludeCheckboxes(columnNames, columnNameToColorFamily, fileDataToOriginalName, parsedData);

    // データセット構築
    const datasets = buildDatasets(parsedData, fileDataToOriginalName, columnNameToColorFamily, minIndex, maxIndex);

    if (datasets.length > 0) {
        renderChart(datasets);
    }
}

/**
 * データセットを構築
 */
function buildDatasets(parsedData, fileDataToOriginalName, columnNameToColorFamily, minIndex, maxIndex) {
    const datasets = [];
    const thresholdViolations = [];
    const fileNameToIndex = new Map();

    let colorIndex = 0;
    parsedData.forEach(fileData => {
        fileNameToIndex.set(fileData.fileName, colorIndex);
        colorIndex++;
    });

    parsedData.forEach(fileData => {
        const originalFileName = fileDataToOriginalName.get(fileData.fileName) || fileData.fileName;
        if (excludedFiles.includes(originalFileName)) return;

        // X軸データを探す
        let xAxisData = null;
        const fileOffset = fileOffsets.get(originalFileName) || 0;

        if (xAxisPattern) {
            const xAxisDataset = fileData.datasets.find(dataset => {
                const columnName = dataset.label.split(' - ')[1] || '';
                return columnName === xAxisPattern;
            });
            if (xAxisDataset) {
                xAxisData = new Map();
                xAxisDataset.data.forEach(point => {
                    xAxisData.set(point.x, point.y + fileOffset);
                });
            }
        }

        fileData.datasets.forEach(dataset => {
            const columnName = dataset.label.split(' - ')[1] || '';

            // X軸列または除外列はスキップ
            if ((xAxisPattern && columnName === xAxisPattern) || excludedColumns.includes(columnName)) {
                return;
            }

            // データ変換
            const numericData = xAxisData
                ? dataset.data.map(point => ({
                    x: xAxisData.get(point.x) || parseInt(point.x),
                    y: point.y
                }))
                : dataset.data.map(point => ({
                    x: parseInt(point.x),
                    y: point.y
                }));

            const yAxisID = getYAxisID(dataset.label);
            const datasetChartType = getChartType(dataset.label);
            const colorFamilyIndex = columnNameToColorFamily.get(columnName) || 0;
            const fileIndex = fileNameToIndex.get(fileData.fileName) || 0;
            const colorFamily = COLOR_FAMILIES[colorFamilyIndex];
            const color = colorFamily[fileIndex % colorFamily.length];

            // データセット設定
            const datasetConfig = {
                type: datasetChartType,
                label: dataset.label,
                data: numericData,
                borderColor: color,
                backgroundColor: rgbToRgba(color, 0.1),
                tension: 0,
                borderWidth: 2,
                fill: false,
                spanGaps: true,
                yAxisID: yAxisID
            };

            // 散布図の場合は点を表示
            if (datasetChartType === 'scatter') {
                Object.assign(datasetConfig, {
                    pointRadius: 4,
                    pointHoverRadius: 4,
                    pointBackgroundColor: color,
                    pointBorderColor: color,
                    pointHoverBackgroundColor: color,
                    pointHoverBorderColor: color,
                    showLine: false
                });
            } else {
                datasetConfig.pointRadius = 0;
                datasetConfig.pointHoverRadius = 0;
            }

            datasets.push(datasetConfig);

            // 移動平均データセットを追加（選択された列の場合のみ）
            if (smoothColumnName && columnName === smoothColumnName && smoothWindow > 1) {
                const smoothedData = applyMovingAverage(numericData, smoothWindow);
                const smoothDatasetConfig = {
                    type: datasetChartType,
                    label: dataset.label + ' (移動平均)',
                    data: smoothedData,
                    borderColor: color,
                    backgroundColor: rgbToRgba(color, 0.1),
                    tension: 0,
                    borderWidth: 3,
                    fill: false,
                    spanGaps: true,
                    yAxisID: yAxisID,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    borderDash: [10, 5]
                };
                datasets.push(smoothDatasetConfig);
            }

            // 閾値違反の検出
            if (upperThresholdValue !== null || lowerThresholdValue !== null) {
                const violationData = numericData.filter(point => {
                    const exceedsUpper = upperThresholdValue !== null && point.y > upperThresholdValue;
                    const exceedsLower = lowerThresholdValue !== null && point.y < lowerThresholdValue;
                    return exceedsUpper || exceedsLower;
                });

                if (violationData.length > 0) {
                    thresholdViolations.push({
                        label: dataset.label + ' (閾値超過)',
                        data: violationData,
                        originalColor: color,
                        yAxisID: yAxisID,
                        chartType: datasetChartType
                    });
                }
            }
        });
    });

    // 閾値線を追加
    addThresholdLines(datasets, minIndex, maxIndex);

    // 閾値違反線を追加
    addViolationLines(datasets, thresholdViolations);

    return datasets;
}

/**
 * 閾値線を追加
 */
function addThresholdLines(datasets, minIndex, maxIndex) {
    const thresholds = [
        { value: upperThresholdValue, label: '上限閾値' },
        { value: lowerThresholdValue, label: '下限閾値' }
    ];

    thresholds.forEach(({ value, label }) => {
        if (value !== null) {
            datasets.push({
                type: 'line',
                label: label,
                data: [
                    { x: minIndex, y: value },
                    { x: maxIndex, y: value }
                ],
                borderColor: 'rgb(255, 0, 0)',
                backgroundColor: 'rgba(255, 0, 0, 0.1)',
                borderWidth: 2,
                borderDash: [5, 5],
                pointRadius: 0,
                pointHoverRadius: 0,
                fill: false,
                tension: 0,
                yAxisID: 'y'
            });
        }
    });
}

/**
 * 閾値違反線を追加
 */
function addViolationLines(datasets, thresholdViolations) {
    thresholdViolations.forEach(violation => {
        const violationConfig = {
            type: violation.chartType,
            label: violation.label,
            data: violation.data,
            borderColor: 'rgb(255, 0, 0)',
            backgroundColor: 'rgba(255, 0, 0, 0.1)',
            tension: 0,
            borderWidth: 3,
            fill: false,
            spanGaps: false,
            isViolation: true,
            yAxisID: violation.yAxisID
        };

        if (violation.chartType === 'scatter') {
            Object.assign(violationConfig, {
                pointRadius: 6,
                pointHoverRadius: 6,
                pointBackgroundColor: 'rgb(255, 0, 0)',
                pointBorderColor: 'rgb(255, 0, 0)',
                pointHoverBackgroundColor: 'rgb(255, 0, 0)',
                pointHoverBorderColor: 'rgb(255, 0, 0)',
                showLine: false
            });
        } else {
            violationConfig.pointRadius = 0;
            violationConfig.pointHoverRadius = 0;
        }

        datasets.push(violationConfig);
    });
}

/**
 * グラフを描画
 */
function renderChart(datasets) {
    const ctx = document.getElementById('myChart').getContext('2d');

    // 表示状態を保存
    if (chart && preserveZoom) {
        chart.data.datasets.forEach((dataset, index) => {
            const meta = chart.getDatasetMeta(index);
            datasetVisibility.set(dataset.label, !meta.hidden);
        });
    }

    // データ範囲を計算
    const ranges = calculateDataRanges(datasets);

    if (chart) {
        chart.destroy();
    }

    // 使用軸の判定
    const usedAxes = new Set();
    datasets.forEach(dataset => {
        if (dataset.yAxisID) usedAxes.add(dataset.yAxisID);
    });

    // グラフ作成
    chart = new Chart(ctx, {
        type: chartType,
        data: { datasets },
        options: createChartOptions(usedAxes)
    });

    // ズーム制限を設定
    updateZoomLimits(ranges);

    // 表示状態を復元
    restoreDatasetVisibility();

    preserveZoom = true;
    elements.resetZoomBtn.style.display = 'inline-block';
    elements.exportCsvBtn.style.display = 'inline-block';

    // スクロールバーの表示/非表示は updateScrollbarsFromChart() で自動判定される

    // 閾値違反の点滅を開始
    startBlinking(datasets);
}

/**
 * データ範囲を計算
 */
function calculateDataRanges(datasets) {
    const ranges = {
        minX: Infinity, maxX: -Infinity,
        minY: Infinity, maxY: -Infinity,
        minY2: Infinity, maxY2: -Infinity,
        minY3: Infinity, maxY3: -Infinity,
        minY4: Infinity, maxY4: -Infinity
    };

    datasets.forEach(dataset => {
        dataset.data.forEach(point => {
            if (point.x < ranges.minX) ranges.minX = point.x;
            if (point.x > ranges.maxX) ranges.maxX = point.x;

            // Y軸ごとに範囲を記録
            if (dataset.yAxisID === 'y') {
                if (point.y < ranges.minY) ranges.minY = point.y;
                if (point.y > ranges.maxY) ranges.maxY = point.y;
            } else if (dataset.yAxisID === 'y2') {
                if (point.y < ranges.minY2) ranges.minY2 = point.y;
                if (point.y > ranges.maxY2) ranges.maxY2 = point.y;
            } else if (dataset.yAxisID === 'y3') {
                if (point.y < ranges.minY3) ranges.minY3 = point.y;
                if (point.y > ranges.maxY3) ranges.maxY3 = point.y;
            } else if (dataset.yAxisID === 'y4') {
                if (point.y < ranges.minY4) ranges.minY4 = point.y;
                if (point.y > ranges.maxY4) ranges.maxY4 = point.y;
            }
        });
    });

    return ranges;
}

/**
 * Chart.jsオプションを作成
 */
function createChartOptions(usedAxes) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 200,
        animation: false,
        plugins: {
            decimation: {
                enabled: true,
                algorithm: 'lttb',
                samples: 400
            },
            legend: {
                display: true,
                position: 'top',
                labels: {
                    usePointStyle: true,
                    padding: 12,
                    font: { size: 12 }
                },
                onClick: handleLegendClick
            },
            tooltip: {
                enabled: tooltipEnabled,
                mode: tooltipSingleMode ? 'nearest' : 'index',
                intersect: false,
                axis: tooltipSingleMode ? 'xy' : 'x',
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                padding: 12,
                titleFont: { size: 14 },
                bodyFont: { size: 13 },
                callbacks: {
                    title: function(context) {
                        if (tooltipSingleMode && context.length > 0) {
                            return `時刻: ${context[0].parsed.x}`;
                        }
                        return '';
                    },
                    label: function(context) {
                        if (tooltipSingleMode) {
                            return `${context.dataset.label}: ${context.parsed.y}`;
                        }
                        return `${context.dataset.label}: ${context.parsed.y}`;
                    }
                }
            },
            zoom: {
                zoom: {
                    wheel: { enabled: true },
                    drag: {
                        enabled: true,
                        backgroundColor: 'rgba(102, 126, 234, 0.3)',
                        borderColor: 'rgba(102, 126, 234, 1)',
                        borderWidth: 2,
                        threshold: 50,
                        drawTime: 'afterDatasetsDraw'
                    },
                    mode: 'xy',
                    onZoomComplete: function() {
                        saveCurrentZoomState();
                    }
                },
                pan: {
                    enabled: true,
                    mode: 'xy',
                    modifierKey: 'shift',
                    onPanComplete: function() {
                        saveCurrentZoomState();
                    }
                },
                limits: {
                    x: {min: 'original', max: 'original'},
                    y: {min: 'original', max: 'original'}
                }
            }
        },
        scales: createScalesConfig(usedAxes),
        interaction: {
            mode: 'nearest',
            axis: 'x',
            intersect: false
        }
    };
}

/**
 * スケール設定を作成
 */
function createScalesConfig(usedAxes) {
    const scales = {
        x: {
            type: 'linear',
            display: true,
            min: savedZoomState && preserveZoom ? savedZoomState.x.min : undefined,
            max: savedZoomState && preserveZoom ? savedZoomState.x.max : undefined,
            title: { display: false },
            ticks: { display: true },
            grid: { display: true, color: 'rgba(0, 0, 0, 0.05)' }
        },
        y: {
            display: true,
            position: 'left',
            min: savedZoomState && preserveZoom ? savedZoomState.y.min : undefined,
            max: savedZoomState && preserveZoom ? savedZoomState.y.max : undefined,
            title: { display: false },
            grid: { display: true, color: 'rgba(0, 0, 0, 0.05)' }
        }
    };

    ['y2', 'y3', 'y4'].forEach(axis => {
        scales[axis] = {
            display: usedAxes.has(axis),
            position: 'right',
            min: savedZoomState && preserveZoom && savedZoomState[axis] ? savedZoomState[axis].min : undefined,
            max: savedZoomState && preserveZoom && savedZoomState[axis] ? savedZoomState[axis].max : undefined,
            title: { display: false },
            grid: { display: false }
        };
    });

    return scales;
}

/**
 * 凡例クリックハンドラ
 */
function handleLegendClick(_e, legendItem, legend) {
    const index = legendItem.datasetIndex;
    const ci = legend.chart;

    if (ci.isDatasetVisible(index)) {
        ci.hide(index);
        legendItem.hidden = true;
    } else {
        ci.show(index);
        legendItem.hidden = false;
    }

    setTimeout(() => {
        if (ci.scales && ci.scales.x && ci.scales.y) {
            saveCurrentZoomState();
        }
    }, 50);
}

/**
 * ズーム制限を更新
 */
function updateZoomLimits(ranges) {
    if (!chart.options.plugins.zoom.limits) return;

    const xMargin = (ranges.maxX - ranges.minX) * 0.1;
    chart.options.plugins.zoom.limits.x = {
        min: ranges.minX - xMargin,
        max: ranges.maxX + xMargin
    };

    const yAxes = ['y', 'y2', 'y3', 'y4'];
    yAxes.forEach(axis => {
        const minKey = `min${axis === 'y' ? 'Y' : axis.toUpperCase()}`;
        const maxKey = `max${axis === 'y' ? 'Y' : axis.toUpperCase()}`;

        if (ranges[minKey] !== Infinity && ranges[maxKey] !== -Infinity) {
            const margin = (ranges[maxKey] - ranges[minKey]) * 0.1;
            chart.options.plugins.zoom.limits[axis] = {
                min: ranges[minKey] - margin,
                max: ranges[maxKey] + margin
            };
        }
    });
}

/**
 * データセット表示状態を復元
 */
function restoreDatasetVisibility() {
    if (datasetVisibility.size === 0) return;

    chart.data.datasets.forEach((dataset, index) => {
        if (datasetVisibility.has(dataset.label)) {
            const isVisible = datasetVisibility.get(dataset.label);
            const meta = chart.getDatasetMeta(index);
            meta.hidden = !isVisible;
        }
    });
    chart.update('none');
}

/**
 * 閾値違反の点滅を開始
 */
function startBlinking() {
    if (blinkTimer) {
        clearInterval(blinkTimer);
    }

    const violationIndices = [];
    chart.data.datasets.forEach((dataset, index) => {
        if (dataset.isViolation) {
            violationIndices.push(index);
        }
    });

    if (violationIndices.length > 0) {
        blinkTimer = setInterval(() => {
            blinkState = !blinkState;
            violationIndices.forEach(index => {
                const dataset = chart.data.datasets[index];
                dataset.borderColor = blinkState
                    ? 'rgb(255, 0, 0)'
                    : 'rgba(255, 0, 0, 0.2)';
            });
            chart.update('none');
        }, BLINK_INTERVAL);
    }
}

/**
 * CSV出力
 */
function exportChartDataToCsv() {
    if (!chart || !chart.data.datasets || chart.data.datasets.length === 0) {
        alert('出力するデータがありません');
        return;
    }

    const datasets = chart.data.datasets;
    const xScale = chart.scales.x;
    const minX = Math.floor(xScale.min);
    const maxX = Math.ceil(xScale.max);

    // 表示範囲内のX座標を収集
    const xValues = new Set();
    datasets.forEach(dataset => {
        if (dataset.data && Array.isArray(dataset.data)) {
            dataset.data.forEach(point => {
                if (point && typeof point === 'object' && point.x >= minX && point.x <= maxX) {
                    xValues.add(point.x);
                }
            });
        }
    });

    const sortedX = Array.from(xValues).sort((a, b) => a - b);

    if (sortedX.length === 0) {
        alert('表示範囲内にデータがありません');
        return;
    }

    // CSVヘッダー
    let csvContent = 'index';
    datasets.forEach(dataset => {
        const columnName = dataset.label.split(' - ')[1] || dataset.label;
        csvContent += ',' + columnName;
    });
    csvContent += '\n';

    // データ行
    sortedX.forEach(x => {
        csvContent += x;
        datasets.forEach(dataset => {
            const point = dataset.data.find(p => p && p.x === x);
            const value = point ? point.y : '';
            csvContent += ',' + value;
        });
        csvContent += '\n';
    });

    // ダウンロード
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const timestamp = now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') + '_' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
    const filename = `graph_data_${timestamp}.csv`;

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ===========================
// キーボード操作
// ===========================

/**
 * 連続パンを実行
 */
function continuousPan() {
    if (!chart) return;

    // 入力フィールドから現在の速度を取得
    const speedX = parseFloat(elements.panSpeedXInput.value) || PAN_SPEED_X;
    const speedY = parseFloat(elements.panSpeedYInput.value) || PAN_SPEED_Y;

    if (keysPressed.ArrowRight) panAxis('x', -speedX);
    if (keysPressed.ArrowLeft) panAxis('x', speedX);
    if (keysPressed.ArrowUp) panAxis('y', speedY);
    if (keysPressed.ArrowDown) panAxis('y', -speedY);

    if (keysPressed.ArrowRight || keysPressed.ArrowLeft ||
        keysPressed.ArrowUp || keysPressed.ArrowDown) {
        animationFrameId = requestAnimationFrame(continuousPan);
    }
}

// ===========================
// イベントリスナー設定
// ===========================

/**
 * 初期化
 */
function init() {
    // ファイル入力
    elements.csvInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        uploadedFiles = files;
        fileOffsets.clear();
        files.forEach(file => fileOffsets.set(file.name, 0));

        displayFileList(files);

        preserveZoom = false;
        savedZoomState = null;
        datasetVisibility.clear();

        await renderChartFromFiles();
    });

    // ズームリセット
    elements.resetZoomBtn.addEventListener('click', () => {
        if (chart) {
            chart.resetZoom();
            savedZoomState = null;
            preserveZoom = false;
        }
    });

    // CSV出力
    elements.exportCsvBtn.addEventListener('click', () => {
        if (chart) exportChartDataToCsv();
    });

    // 凡例チェックボックス
    elements.legendCheckbox.addEventListener('change', async (e) => {
        if (e.target.checked) {
            tooltipEnabled = true;
            tooltipSingleMode = false;
            elements.tooltipSingleCheckbox.checked = false;
        } else {
            tooltipEnabled = false;
        }
        if (chart) {
            preserveZoom = true;
            await renderChartFromFiles();
        }
    });

    // 凡例(単体)チェックボックス
    elements.tooltipSingleCheckbox.addEventListener('change', async (e) => {
        if (e.target.checked) {
            tooltipEnabled = true;
            tooltipSingleMode = true;
            elements.legendCheckbox.checked = false;
        } else {
            tooltipEnabled = false;
            tooltipSingleMode = false;
        }
        if (chart) {
            preserveZoom = true;
            await renderChartFromFiles();
        }
    });

    // 移動平均列選択
    elements.smoothColumnSelect.addEventListener('change', async (e) => {
        smoothColumnName = e.target.value;
        if (chart) {
            preserveZoom = true;
            await renderChartFromFiles();
        }
    });

    // 移動平均ウィンドウサイズ変更
    elements.smoothWindowInput.addEventListener('input', async (e) => {
        const value = parseInt(e.target.value);
        if (!isNaN(value) && value >= 1) {
            smoothWindow = value;
            if (chart && smoothColumnName) {
                preserveZoom = true;
                await renderChartFromFiles();
            }
        }
    });

    // X軸選択
    elements.xAxisSelect.addEventListener('change', async (e) => {
        xAxisPattern = e.target.value;
        if (chart) {
            preserveZoom = true;
            await renderChartFromFiles();
        }
    });

    // グラフ種類選択
    elements.chartTypeSelect.addEventListener('change', async (e) => {
        chartType = e.target.value;
        if (chart) {
            preserveZoom = true;
            await renderChartFromFiles();
        }
    });

    // 閾値入力
    [
        { input: elements.upperThresholdInput, setValue: (val) => upperThresholdValue = val },
        { input: elements.lowerThresholdInput, setValue: (val) => lowerThresholdValue = val }
    ].forEach(({ input, setValue }) => {
        input.addEventListener('input', async (e) => {
            const value = e.target.value;
            setValue(value === '' ? null : parseFloat(value));
            if (chart) {
                preserveZoom = true;
                await renderChartFromFiles();
            }
        });
    });

    // Y軸設定
    elements.yAxisElements.forEach((elems, index) => {
        elems.select.addEventListener('change', async (e) => {
            yAxisConfigs[index].axis = e.target.value;
            if (chart && yAxisConfigs[index].pattern) {
                preserveZoom = true;
                await renderChartFromFiles();
            }
        });

        elems.check.addEventListener('change', async (e) => {
            yAxisConfigs[index].enabled = e.target.checked;
            if (e.target.checked) {
                elems.input.style.display = '';
                elems.columnSelect.style.display = 'none';
            } else {
                elems.input.style.display = 'none';
                elems.columnSelect.style.display = '';
                yAxisConfigs[index].pattern = elems.columnSelect.value;
            }
            if (chart) {
                preserveZoom = true;
                await renderChartFromFiles();
            }
        });

        elems.input.addEventListener('input', async (e) => {
            yAxisConfigs[index].pattern = e.target.value.trim();
            if (chart && elems.check.checked) {
                preserveZoom = true;
                await renderChartFromFiles();
            }
        });

        elems.columnSelect.addEventListener('change', async (e) => {
            yAxisConfigs[index].pattern = e.target.value;
            if (chart) {
                preserveZoom = true;
                await renderChartFromFiles();
            }
        });

        elems.typeSelect.addEventListener('change', async (e) => {
            yAxisConfigs[index].chartType = e.target.value;
            if (chart) {
                preserveZoom = true;
                await renderChartFromFiles();
            }
        });
    });

    // キーボード操作
    document.addEventListener('keydown', (e) => {
        if (!chart) return;

        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' ||
            e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();

            if (!keysPressed[e.key]) {
                keysPressed[e.key] = true;
                if (!animationFrameId) {
                    continuousPan();
                }
            }
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' ||
            e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            keysPressed[e.key] = false;

            if (!keysPressed.ArrowRight && !keysPressed.ArrowLeft &&
                !keysPressed.ArrowUp && !keysPressed.ArrowDown) {
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = null;
                }
            }
        }
    });

    // スクロールバー操作
    elements.xScrollbar.addEventListener('input', (e) => {
        if (!chart) return;
        panFromScrollbar('x', parseFloat(e.target.value));
    });

    elements.yScrollbar.addEventListener('input', (e) => {
        if (!chart) return;
        panFromScrollbar('y', parseFloat(e.target.value));
    });
}

// ページ読み込み時に初期化
document.addEventListener('DOMContentLoaded', init);
