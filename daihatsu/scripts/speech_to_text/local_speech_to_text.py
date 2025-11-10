#!/usr/bin/env python3
"""
ローカル音声文字起こしスクリプト
OpenAI Whisperをローカルで実行して音声ファイルを文字起こしします
"""

import os
import sys
import argparse
import json
from pathlib import Path
from typing import Optional, Dict, Any
import time

# Django設定は必要な場合のみ有効化
try:
    current_dir = Path(__file__).parent.parent.parent
    sys.path.append(str(current_dir))
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'daihatsu.settings')
    
    import django
    django.setup()
    print("Django環境を初期化しました")
except Exception as e:
    print(f"Django初期化をスキップ（スタンドアロン実行）: {e}")
    pass

try:
    import whisper
except ImportError:
    print("Whisper パッケージがインストールされていません。")
    print("インストールコマンド: pip install openai-whisper")
    sys.exit(1)

try:
    import torch
except ImportError:
    print("PyTorch パッケージがインストールされていません。")
    print("インストールコマンド: pip install torch")
    sys.exit(1)


class LocalSpeechToText:
    """ローカル音声文字起こしクラス"""

    # サポートされる音声ファイル形式
    SUPPORTED_FORMATS = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.flac']

    # Whisperモデルサイズ
    MODEL_SIZES = {
        'tiny': 'tiny (39 MB, ~32x速度)',
        'base': 'base (74 MB, ~16x速度)',
        'small': 'small (244 MB, ~6x速度)',
        'medium': 'medium (769 MB, ~2x速度)',
        'large': 'large (1550 MB, 1x速度)',
        'large-v2': 'large-v2 (1550 MB, 最新)',
        'large-v3': 'large-v3 (1550 MB, 最新)'
    }

    # サポート言語
    SUPPORTED_LANGUAGES = {
        'ja': 'Japanese',
        'en': 'English',
        'zh': 'Chinese',
        'ko': 'Korean',
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German',
        'auto': 'Auto-detect'
    }

    def __init__(self, model_size: str = 'base'):
        """
        初期化
        Args:
            model_size: Whisperモデルのサイズ
        """
        self.model_size = model_size
        self.model = None

        # GPU使用可否チェック
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"使用デバイス: {self.device}")

    def load_model(self):
        """Whisperモデルを読み込み"""
        if self.model is None:
            print(f"Whisperモデルを読み込み中: {self.model_size}")
            start_time = time.time()

            try:
                self.model = whisper.load_model(self.model_size, device=self.device)
                load_time = time.time() - start_time
                print(f"モデル読み込み完了: {load_time:.2f}秒")

            except Exception as e:
                print(f"モデル読み込みエラー: {e}")
                print("より小さなモデル(tiny, base)を試してください")
                raise

    def validate_audio_file(self, file_path: Path) -> bool:
        """
        音声ファイルの検証
        Args:
            file_path: 音声ファイルのパス
        Returns:
            bool: 有効な音声ファイルかどうか
        """
        if not file_path.exists():
            print(f"エラー: ファイルが存在しません: {file_path}")
            return False

        if file_path.suffix.lower() not in self.SUPPORTED_FORMATS:
            print(f"エラー: サポートされていない形式です: {file_path.suffix}")
            print(f"サポート形式: {', '.join(self.SUPPORTED_FORMATS)}")
            return False

        return True

    def transcribe_audio(self, file_path: Path, language: Optional[str] = None,
                        task: str = "transcribe") -> Dict[str, Any]:
        """
        音声を文字起こし
        Args:
            file_path: 音声ファイルのパス
            language: 言語コード（None=自動検出）
            task: タスク ("transcribe" または "translate")
        Returns:
            Dict: 文字起こし結果
        """
        if not self.validate_audio_file(file_path):
            return {"success": False, "error": "Invalid audio file"}

        try:
            # モデルを読み込み
            self.load_model()

            print(f"文字起こし中: {file_path.name}")
            start_time = time.time()

            # Whisperで文字起こし実行
            options = {
                "task": task,
                "fp16": self.device == "cuda",  # GPU使用時はfp16を有効
            }

            if language and language != 'auto':
                options["language"] = language

            result = self.model.transcribe(str(file_path), **options)

            process_time = time.time() - start_time

            return {
                "success": True,
                "text": result["text"],
                "language": result.get("language", language),
                "segments": result.get("segments", []),
                "model_size": self.model_size,
                "device": self.device,
                "process_time": process_time
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    def save_result(self, result: Dict[str, Any], output_path: Path,
                   format_type: str = 'txt') -> bool:
        """
        結果を保存
        Args:
            result: 文字起こし結果
            output_path: 出力ファイルパス
            format_type: 出力形式（'txt', 'json', 'srt'）
        Returns:
            bool: 保存成功可否
        """
        try:
            if not result.get('success'):
                print(f"エラー: {result.get('error', '不明なエラー')}")
                return False

            output_path.parent.mkdir(parents=True, exist_ok=True)

            if format_type == 'json':
                # JSON形式で保存
                with open(output_path, 'w', encoding='utf-8') as f:
                    json.dump(result, f, ensure_ascii=False, indent=2)

            elif format_type == 'srt':
                # SRT字幕形式で保存
                with open(output_path, 'w', encoding='utf-8') as f:
                    if 'segments' in result:
                        for i, segment in enumerate(result['segments'], 1):
                            start = self._format_timestamp(segment['start'])
                            end = self._format_timestamp(segment['end'])
                            text = segment['text'].strip()

                            f.write(f"{i}\n")
                            f.write(f"{start} --> {end}\n")
                            f.write(f"{text}\n\n")
                    else:
                        f.write("1\n00:00:00,000 --> 00:00:10,000\n")
                        f.write(result['text'])

            else:
                # テキスト形式で保存
                with open(output_path, 'w', encoding='utf-8') as f:
                    f.write(result['text'])

            print(f"結果を保存しました: {output_path}")

            # 処理時間を表示
            if 'process_time' in result:
                print(f"処理時間: {result['process_time']:.2f}秒")

            return True

        except Exception as e:
            print(f"保存エラー: {e}")
            return False

    def _format_timestamp(self, seconds: float) -> str:
        """秒数をSRT形式のタイムスタンプに変換"""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millisecs = int((seconds % 1) * 1000)

        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millisecs:03d}"

    @classmethod
    def list_available_models(cls):
        """利用可能なモデル一覧を表示"""
        print("利用可能なWhisperモデル:")
        for model, description in cls.MODEL_SIZES.items():
            print(f"  {model}: {description}")


def main():
    parser = argparse.ArgumentParser(description='ローカルで音声ファイルを文字起こしします')
    parser.add_argument('input_file', help='音声ファイルのパス')
    parser.add_argument('-o', '--output', help='出力ファイルのパス（省略時は自動生成）')
    parser.add_argument('-l', '--language',
                       choices=list(LocalSpeechToText.SUPPORTED_LANGUAGES.keys()),
                       help='言語コード（省略時は自動検出）')
    parser.add_argument('-m', '--model', default='base',
                       choices=list(LocalSpeechToText.MODEL_SIZES.keys()),
                       help='Whisperモデルサイズ（デフォルト: base）')
    parser.add_argument('-f', '--format', default='txt',
                       choices=['txt', 'json', 'srt'],
                       help='出力形式（デフォルト: txt）')
    parser.add_argument('-t', '--task', default='transcribe',
                       choices=['transcribe', 'translate'],
                       help='タスク: transcribe=文字起こし, translate=英語翻訳')
    parser.add_argument('--list-models', action='store_true',
                       help='利用可能なモデル一覧を表示')

    args = parser.parse_args()

    # モデル一覧表示
    if args.list_models:
        LocalSpeechToText.list_available_models()
        return

    # 入力ファイルパス
    input_path = Path(args.input_file)

    # 出力ファイルパス
    if args.output:
        output_path = Path(args.output)
    else:
        output_dir = input_path.parent / 'transcripts'
        filename = f"{input_path.stem}_transcript.{args.format}"
        output_path = output_dir / filename

    try:
        # 文字起こし実行
        stt = LocalSpeechToText(model_size=args.model)

        print(f"入力ファイル: {input_path}")
        print(f"モデル: {args.model}")
        if args.language:
            print(f"言語: {LocalSpeechToText.SUPPORTED_LANGUAGES[args.language]}")
        else:
            print("言語: 自動検出")
        print(f"出力形式: {args.format}")
        print(f"タスク: {args.task}")

        # 言語設定
        language = None if args.language == 'auto' or args.language is None else args.language

        result = stt.transcribe_audio(
            input_path,
            language=language,
            task=args.task
        )

        # 結果を保存
        if stt.save_result(result, output_path, args.format):
            if result.get('success'):
                print(f"\n=== 文字起こし結果 ===")
                print(result['text'])

                if result.get('language'):
                    print(f"\n検出言語: {result['language']}")
        else:
            sys.exit(1)

    except Exception as e:
        print(f"エラー: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
