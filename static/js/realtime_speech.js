class VoiceInputSystem {
    constructor() {
        this.isRecording = false;
        this.recognition = null;
        this.currentFormIndex = 0;
        this.voiceInputs = [];
        
        // 要素を直接取得して保存
        this.startButton = document.getElementById('startRecording');
        this.stopButton = document.getElementById('stopRecording');
        this.clearButton = document.getElementById('clearForms');
        this.prevButton = document.getElementById('prevForm');
        this.nextButton = document.getElementById('nextForm');
        
        // input_numberクラスを持つ要素のみを取得
        this.voiceInputs = Array.from(document.querySelectorAll('.input_number'));
        
        // 音声認識の初期化
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('このブラウザは音声認識に対応していません。手入力のみ利用できます。');
            this.startButton.style.display = 'none';
            this.stopButton.style.display = 'none';
            return;
        }
        this.SpeechRecognition = SpeechRecognition;
        
        // イベントバインド
        this.startButton?.addEventListener('click', () => this.startRecording());
        this.stopButton?.addEventListener('click', () => this.stopRecording());
        this.clearButton?.addEventListener('click', () => this.clearAllForms());
        this.prevButton?.addEventListener('click', () => this.prevForm());
        this.nextButton?.addEventListener('click', () => this.nextForm());
        this.voiceInputs.forEach((input, index) => {
            input?.addEventListener('focus', () => this.setActiveForm(index));
        });
        
        this.updateActiveForm();
    }

    updateActiveForm() {
        this.voiceInputs.forEach(input => input?.classList.remove('active-input'));
        this.voiceInputs[this.currentFormIndex]?.classList.add('active-input');
    }

    setActiveForm(index) {
        if (index >= 0 && index < this.voiceInputs.length) {
            this.currentFormIndex = index;
            this.updateActiveForm();
        }
    }

    startRecording() {
        this.stopRecording(); // 完全に停止してから開始
        
        this.recognition = new this.SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = false;
        this.recognition.lang = 'ja-JP';
        
        // 現在のフォームインデックスを固定して保存
        const targetFormIndex = this.currentFormIndex;
        
        this.recognition.onresult = (event) => {
            if (event.results.length > 0) {
                const result = event.results[0];
                if (result.isFinal) {
                    const transcript = result[0].transcript.trim();
                    if (transcript) {
                        this.handleVoiceResult(transcript, targetFormIndex);
                    }
                }
            }
        };
        
        this.recognition.onend = () => {
            if (this.isRecording && targetFormIndex === this.currentFormIndex) {
                setTimeout(() => {
                    if (this.isRecording && this.currentFormIndex === targetFormIndex) {
                        this.startRecording();
                    }
                }, 100);
            }
        };
        
        this.isRecording = true;
        this.updateRecordingUI(true);
        this.recognition.start();
    }

    stopRecording() {
        this.isRecording = false;
        if (this.recognition) this.recognition.stop();
        this.updateRecordingUI(false);
    }


    handleVoiceResult(transcript, targetFormIndex) {
        const words = transcript.split(/\s+/);
        for (const word of words) {
            if (word.trim()) {
                const number = this.convertToNumber(word);
                if (number) {
                    this.addNumberToForm(number, targetFormIndex);
                }
            }
        }
    }

    addNumberToForm(number, targetFormIndex) {
        if (targetFormIndex >= 0 && targetFormIndex < this.voiceInputs.length) {
            const input = this.voiceInputs[targetFormIndex];
            if (input) {
                // 既に値がある場合は置換、空の場合は新規入力
                input.value = number;
                input.style.backgroundColor = '#d4edda';
                setTimeout(() => input.style.backgroundColor = '', 150);
            }
        }
    }

    convertToNumber(text) {
        if (!text) return null;
        
        let result = text.trim();
        
        // ノイズ除去
        result = result.replace(/音楽|ミュージック|Music/gi, '');
        
        // 日本語数字変換（より多くのパターンを含む）
        const digitMap = {
            // 0
            'ゼロ': '0', 'れい': '0', 'ゼロー': '0', 'れいー': '0',
            // 1  
            'いち': '1', 'ワン': '1', 'いっ': '1', 'いちー': '1', 'one': '1',
            // 2
            'に': '2', 'ニー': '2', 'ツー': '2', 'にー': '2', 'two': '2',
            // 3
            'さん': '3', 'サン': '3', 'スリー': '3', 'さんー': '3', 'three': '3',
            // 4
            'よん': '4', 'し': '4', 'フォー': '4', 'よーん': '4', 'four': '4',
            // 5
            'ご': '5', 'ごー': '5', 'ファイブ': '5', 'five': '5',
            // 6
            'ろく': '6', 'ロク': '6', 'ろっく': '6', 'ロック': '6', 'ろーく': '6', 'six': '6',
            // 7
            'なな': '7', 'しち': '7', 'ナナ': '7', 'セブン': '7', 'ななー': '7', 'seven': '7',
            // 8
            'はち': '8', 'ハチ': '8', 'エイト': '8', 'はちー': '8', 'eight': '8',
            // 9
            'きゅう': '9', 'く': '9', 'きゅー': '9', 'ナイン': '9', 'nine': '9',
            // 小数点
            'てん': '.', 'テン': '.', 'ポイント': '.', 'point': '.'
        };
        
        // 数字変換
        for (const [japanese, digit] of Object.entries(digitMap)) {
            result = result.replace(new RegExp(japanese, 'gi'), digit);
        }
        
        // 数字と小数点のみ抽出
        result = result.replace(/[^\d.]/g, '');
        
        if (!result) return null;
        
        // 小数点は1つまで
        const dotCount = (result.match(/\./g) || []).length;
        if (dotCount > 1) {
            const parts = result.split('.');
            result = parts[0] + '.' + parts.slice(1).join('');
        }
        
        // 先頭末尾の小数点除去
        result = result.replace(/^\.+|\.+$/g, '');
        
        return result && /^[\d]*\.?[\d]*$/.test(result) ? result : null;
    }

    prevForm() {
        if (this.currentFormIndex > 0) {
            this.currentFormIndex--;
            this.updateActiveForm();
            this.startRecording();
        }
    }

    nextForm() {
        if (this.currentFormIndex < this.voiceInputs.length - 1) {
            this.currentFormIndex++;
            this.updateActiveForm();
            this.startRecording();
        }
    }

    clearAllForms() {
        if (this.isRecording) this.stopRecording();
        this.voiceInputs.forEach(input => input && (input.value = ''));
        this.currentFormIndex = 0;
        this.updateActiveForm();
    }


    updateRecordingUI(isRecording) {
        if (this.startButton) this.startButton.disabled = isRecording;
        if (this.stopButton) this.stopButton.disabled = !isRecording;

        if (isRecording) {
            if (this.stopButton) this.stopButton.classList.add('recording-pulse');
        } else {
            if (this.stopButton) this.stopButton.classList.remove('recording-pulse');
        }
    }

}

// ページ読み込み完了時に初期化
document.addEventListener('DOMContentLoaded', function() {
    window.voiceInputSystem = new VoiceInputSystem();
});
