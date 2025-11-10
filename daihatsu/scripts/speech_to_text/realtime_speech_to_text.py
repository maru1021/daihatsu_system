#!/usr/bin/env python3
"""
リアルタイム音声文字起こしスクリプト
マイクからの音声をリアルタイムでWhisperを使って文字起こしします
"""

import os
import sys
import argparse
import threading
import time
import queue
from pathlib import Path
from typing import Optional, Dict, Any
import numpy as np

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

try:
    import pyaudio
except ImportError:
    print("PyAudio パッケージがインストールされていません。")
    print("インストールコマンド: pip install pyaudio")
    sys.exit(1)

try:
    import webrtcvad
except ImportError:
    print("WebRTC VAD パッケージがインストールされていません。")
    print("インストールコマンド: pip install webrtcvad")
    sys.exit(1)


class RealtimeSpeechToText:
    """リアルタイム音声文字起こしクラス"""

    def __init__(self, model_size: str = 'base', language: str = 'ja'):
        """
        初期化
        Args:
            model_size: Whisperモデルのサイズ
            language: 言語コード
        """
        self.model_size = model_size
        self.language = language
        self.model = None

        # 音声設定
        self.sample_rate = 16000
        self.chunk_size = 1024
        self.channels = 1
        self.format = pyaudio.paFloat32

        # バッファ設定
        self.audio_buffer = queue.Queue()
        self.recording = False

        # VAD (Voice Activity Detection) 設定
        self.vad = webrtcvad.Vad()
        self.vad.set_mode(2)  # 0-3, 3が最も厳格

        # GPU使用可否チェック
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"使用デバイス: {self.device}")

        # PyAudio初期化
        self.audio = pyaudio.PyAudio()

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
                raise

    def list_audio_devices(self):
        """利用可能な音声デバイス一覧を表示"""
        print("利用可能な音声デバイス:")
        for i in range(self.audio.get_device_count()):
            info = self.audio.get_device_info_by_index(i)
            if info['maxInputChannels'] > 0:
                print(f"  {i}: {info['name']} (入力チャンネル: {info['maxInputChannels']})")

    def is_speech(self, audio_chunk: bytes) -> bool:
        """音声活動検出 (VAD)"""
        try:
            # 16kHz, 16bit PCMに変換してVADに渡す
            audio_int16 = (np.frombuffer(audio_chunk, dtype=np.float32) * 32767).astype(np.int16)
            audio_bytes = audio_int16.tobytes()

            # 20ms, 30ms チャンクに分割してVAD判定
            frame_duration = 30  # ms
            frame_size = int(self.sample_rate * frame_duration / 1000)

            for i in range(0, len(audio_int16), frame_size):
                frame = audio_int16[i:i+frame_size]
                if len(frame) == frame_size:
                    frame_bytes = frame.tobytes()
                    if self.vad.is_speech(frame_bytes, self.sample_rate):
                        return True
            return False
        except:
            # VADエラーの場合は音声ありと判定
            return True

    def audio_callback(self, in_data, frame_count, time_info, status):
        """音声入力コールバック"""
        if self.recording:
            # 音声活動検出
            if self.is_speech(in_data):
                self.audio_buffer.put(in_data)

        return (None, pyaudio.paContinue)

    def start_recording(self, device_index: Optional[int] = None):
        """録音開始"""
        self.recording = True

        try:
            self.stream = self.audio.open(
                format=self.format,
                channels=self.channels,
                rate=self.sample_rate,
                input=True,
                input_device_index=device_index,
                frames_per_buffer=self.chunk_size,
                stream_callback=self.audio_callback
            )

            self.stream.start_stream()
            print(f"録音開始... (デバイス: {device_index if device_index else 'デフォルト'})")

        except Exception as e:
            print(f"録音開始エラー: {e}")
            self.recording = False
            raise

    def stop_recording(self):
        """録音停止"""
        self.recording = False

        if hasattr(self, 'stream'):
            self.stream.stop_stream()
            self.stream.close()

        print("録音停止")

    def process_audio_chunks(self, chunk_duration: float = 3.0) -> str:
        """音声チャンクを処理して文字起こし"""
        audio_data = []
        chunk_samples = int(self.sample_rate * chunk_duration)

        # 指定時間分の音声データを収集
        while len(audio_data) < chunk_samples:
            try:
                chunk = self.audio_buffer.get(timeout=0.1)
                audio_array = np.frombuffer(chunk, dtype=np.float32)
                audio_data.extend(audio_array)
            except queue.Empty:
                if not self.recording:
                    break
                continue

        if len(audio_data) < self.sample_rate:  # 1秒未満の場合はスキップ
            return ""

        # Whisperで文字起こし
        try:
            audio_np = np.array(audio_data, dtype=np.float32)

            # Whisperが期待する形式に変換
            if len(audio_np) > 0:
                result = self.model.transcribe(
                    audio_np,
                    language=self.language if self.language != 'auto' else None,
                    fp16=self.device == "cuda"
                )
                return result["text"].strip()

        except Exception as e:
            print(f"文字起こしエラー: {e}")

        return ""

    def run_realtime_transcription(self, device_index: Optional[int] = None,
                                  chunk_duration: float = 3.0,
                                  save_file: Optional[str] = None):
        """リアルタイム文字起こしを実行"""

        # モデルを読み込み
        self.load_model()

        # 録音開始
        self.start_recording(device_index)

        # 結果保存用
        transcription_results = []
        save_path = None
        if save_file:
            save_path = Path(save_file)
            save_path.parent.mkdir(parents=True, exist_ok=True)

        print(f"\n{'='*50}")
        print("リアルタイム音声文字起こし開始")
        print("終了するには Ctrl+C を押してください")
        print(f"{'='*50}\n")

        try:
            while self.recording:
                # 音声チャンクを処理
                text = self.process_audio_chunks(chunk_duration)

                if text:
                    timestamp = time.strftime("%H:%M:%S")
                    result_line = f"[{timestamp}] {text}"

                    print(result_line)
                    transcription_results.append(result_line)

                    # ファイル保存
                    if save_path:
                        with open(save_path, 'a', encoding='utf-8') as f:
                            f.write(result_line + "\n")

                time.sleep(0.1)

        except KeyboardInterrupt:
            print(f"\n{'='*50}")
            print("文字起こしを終了します...")

        finally:
            self.stop_recording()
            self.audio.terminate()

            if transcription_results:
                print(f"\n{'='*50}")
                print("文字起こし結果:")
                print(f"{'='*50}")
                for result in transcription_results:
                    print(result)

                if save_path:
                    print(f"\n結果を保存しました: {save_path}")


def main():
    parser = argparse.ArgumentParser(description='リアルタイム音声文字起こし')
    parser.add_argument('-m', '--model', default='base',
                       choices=['tiny', 'base', 'small', 'medium', 'large'],
                       help='Whisperモデルサイズ（デフォルト: base）')
    parser.add_argument('-l', '--language', default='ja',
                       help='言語コード（デフォルト: ja, autoで自動検出）')
    parser.add_argument('-d', '--device', type=int,
                       help='音声デバイスID（省略時はデフォルト）')
    parser.add_argument('-c', '--chunk-duration', type=float, default=3.0,
                       help='音声チャンクの長さ（秒、デフォルト: 3.0）')
    parser.add_argument('-o', '--output',
                       help='結果をファイルに保存（省略時は画面表示のみ）')
    parser.add_argument('--list-devices', action='store_true',
                       help='利用可能な音声デバイス一覧を表示')

    args = parser.parse_args()

    # リアルタイム文字起こし実行
    stt = RealtimeSpeechToText(
        model_size=args.model,
        language=args.language
    )

    # デバイス一覧表示
    if args.list_devices:
        stt.list_audio_devices()
        return

    print(f"モデル: {args.model}")
    print(f"言語: {args.language}")
    print(f"チャンク長: {args.chunk_duration}秒")
    if args.device is not None:
        print(f"音声デバイス: {args.device}")
    if args.output:
        print(f"保存ファイル: {args.output}")

    try:
        stt.run_realtime_transcription(
            device_index=args.device,
            chunk_duration=args.chunk_duration,
            save_file=args.output
        )

    except Exception as e:
        print(f"エラー: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
