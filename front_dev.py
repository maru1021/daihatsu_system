import os
import sys
import time
import subprocess
import threading
import webbrowser
import platform
import queue
import select

from daihatsu.settings import URL_BASE

class SimpleHotReloadServer:
    def __init__(self):
        self.server_process = None
        self.watching = False
        self.os_type = platform.system().lower()
        self.last_reload = 0
        self.output_queue = queue.Queue()

        # 監視対象拡張子
        self.watch_extensions = {'.py', '.js', '.css', '.html', '.json'}

        # 除外ディレクトリ
        self.exclude_dirs = {'__pycache__', '.git', 'node_modules', '.venv'}

    # シークレットモードでブラウザを開く
    def open_browser_private(self, url):
        try:
            if self.os_type == 'windows':
                # Chrome優先
                chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
                if os.path.exists(chrome_path):
                    subprocess.Popen([chrome_path, "--incognito", url])
                    return

            elif self.os_type == 'darwin':
                # macOS Chrome
                subprocess.run(["open", "-na", "Google Chrome", "--args", "--incognito", url])
                return
        except Exception:
            pass

        # フォールバック: 通常モード
        webbrowser.open(url)

    # サーバー出力を読み取るスレッド
    def read_server_output(self, pipe, output_type):
        while self.server_process and self.server_process.poll() is None:
            try:
                if self.os_type == 'windows':
                    # Windowsの場合
                    line = pipe.readline()
                    if line:
                        output = line.decode('utf-8', errors='ignore').rstrip()
                        if output:
                            print(f"[Django {output_type}] {output}")
                else:
                    # Unix系の場合
                    if select.select([pipe], [], [], 0.1)[0]:
                        line = pipe.readline()
                        if line:
                            output = line.decode('utf-8', errors='ignore').rstrip()
                            if output:
                                print(f"[Django {output_type}] {output}")
            except Exception as e:
                if self.server_process and self.server_process.poll() is None:
                    print(f"❌ 出力読み取りエラー ({output_type}): {e}")
                break

    # サーバー起動
    def start_server(self):
        # サーバープロセスを起動
        self.server_process = subprocess.Popen([
            sys.executable, 'manage.py', 'runserver', '--noreload'
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=1)

        # 出力を読み取るスレッドを開始
        stdout_thread = threading.Thread(
            target=self.read_server_output,
            args=(self.server_process.stdout, "stdout"),
            daemon=True
        )
        stderr_thread = threading.Thread(
            target=self.read_server_output,
            args=(self.server_process.stderr, "stderr"),
            daemon=True
        )

        stdout_thread.start()
        stderr_thread.start()

        # サーバーの起動を少し待つ
        time.sleep(1)

        self.open_browser_private(f'{URL_BASE}/auth/login')

    # ブラウザリロード
    def reload_browser(self):
        current_time = time.time()
        if current_time - self.last_reload < 1:  # 1秒デバウンス
            return

        self.last_reload = current_time
        try:
            if self.os_type == 'darwin':
                script = '''
                tell application "Google Chrome"
                    repeat with w in windows
                        repeat with t in tabs of w
                            if URL of t contains "127.0.0.1:8000" then
                                reload t
                                return
                            end if
                        end repeat
                    end repeat
                end tell
                '''
                subprocess.run(['osascript', '-e', script], timeout=3)
            elif self.os_type == 'windows':
                # Windows: F5キー送信
                try:
                    import win32api, win32con
                    win32api.keybd_event(win32con.VK_F5, 0, 0, 0)
                    win32api.keybd_event(win32con.VK_F5, 0, win32con.KEYEVENTF_KEYUP, 0)
                except ImportError:
                    # 新しいタブを開かない
                    pass
        except Exception:
            # フォールバック: 新しいタブを開かない
            pass

        print("リロード完了したYO!👍")

    # ファイルの更新時刻を取得
    def get_file_times(self):
        files = {}
        for root, dirs, filenames in os.walk('.'):
            # 除外ディレクトリをスキップ
            dirs[:] = [d for d in dirs if d not in self.exclude_dirs]

            for filename in filenames:
                if any(filename.endswith(ext) for ext in self.watch_extensions):
                    filepath = os.path.join(root, filename)
                    try:
                        files[filepath] = os.path.getmtime(filepath)
                    except OSError:
                        continue
        return files

    # ファイル監視
    def watch_files(self):
        print('=' * 50)
        print('サーバー起動したYO!')
        print('今日も開発FaightだYO!👊')
        print('=' * 50)

        file_times = self.get_file_times()

        while self.watching:
            try:
                current_times = self.get_file_times()

                # 変更されたファイルをチェック
                changed_files = []
                for filepath, mtime in current_times.items():
                    if filepath in file_times:
                        if mtime > file_times[filepath]:
                            changed_files.append(filepath)
                    else:
                        changed_files.append(f"{filepath} (新規)")

                if changed_files:
                    self.reload_browser()

                file_times = current_times
                time.sleep(1)  # 1秒間隔でチェック

            except Exception as e:
                print(f"❌ 監視エラー: {e}")
                time.sleep(1)

    def start(self):
        try:
            # サーバー起動
            self.start_server()

            # ファイル監視開始
            self.watching = True
            watch_thread = threading.Thread(target=self.watch_files, daemon=True)
            watch_thread.start()

            # メインループ
            while self.server_process and self.server_process.poll() is None:
                time.sleep(1)

        except KeyboardInterrupt:
            self.stop()

    def stop(self):
        self.watching = False

        if self.server_process:
            self.server_process.terminate()
            try:
                self.server_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.server_process.kill()
                self.server_process.wait()

        print('=' * 50)
        print("✅ サーバー落としたYO!")
        print('開発お疲れ様だYO!😴')
        print('=' * 50)

def main():
    server = SimpleHotReloadServer()
    try:
        server.start()
    except KeyboardInterrupt:
        server.stop()

if __name__ == "__main__":
    main()
