"""
Claude Code との通信を行うサービス（シンプル版）
毎回プロセスを起動するが安定性を重視
"""

import subprocess
import time
from typing import Dict, Any, Optional
from daihatsu.except_output import except_output


class ClaudeService:
    """Claude Code との通信を行うサービスクラス（シンプル版）"""

    def __init__(self):
        # Claude Code の設定
        self.claude_code_path = "/opt/homebrew/bin/claude"
        self.timeout = 180  # タイムアウト時間（秒）

    def send_message(self, message: str, system_prompt: Optional[str] = None) -> Dict[str, Any]:
        """Claude Code にメッセージを送信し、返答を取得"""
        try:
            # プロンプトを構築
            if system_prompt:
                full_prompt = f"{system_prompt}\n\n{message}"
            else:
                full_prompt = f"{message}"

            # Claude Code を実行
            result = self._execute_claude_code(full_prompt)

            if result["success"]:
                return {
                    "success": True,
                    "response": result["output"],
                    "execution_time": result.get("execution_time", 0)
                }
            else:
                return result

        except Exception as e:
            except_output("Claude Code communication error", e)
            return {
                "success": False,
                "error": f"Claude Code との通信でエラーが発生しました: {str(e)}"
            }

    def _execute_claude_code(self, prompt: str) -> Dict[str, Any]:
        """Claude Code を実行"""
        try:
            start_time = time.time()

            # Claude Code のコマンドを実行
            cmd = [self.claude_code_path]
            result = subprocess.run(
                cmd,
                input=prompt,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                encoding='utf-8'
            )

            execution_time = time.time() - start_time

            if result.returncode == 0:
                return {
                    "success": True,
                    "output": result.stdout.strip(),
                    "execution_time": execution_time
                }
            else:
                error_msg = result.stderr.strip() if result.stderr else "Unknown error"
                return {
                    "success": False,
                    "error": f"Claude Code の実行エラー: {error_msg}",
                    "execution_time": execution_time
                }

        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "error": f"Claude Code の実行がタイムアウトしました（{self.timeout}秒）"
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Claude Code の実行でエラー: {str(e)}"
            }
