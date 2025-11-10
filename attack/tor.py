import paramiko
import socks
import socket
import os
import sys

def setup_tor_proxy():
    socks.set_default_proxy(socks.SOCKS5, "127.0.0.1", 9050)
    socket.socket = socks.socksocket

def ssh_connect(host, username):
    setup_tor_proxy()

    port = 22

    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        print(f"Connecting to {host} via Tor...")
        client.connect(
            hostname=host,
            port=port,
            username=username,
            timeout=30,
            look_for_keys=True,  # ディスクから秘密鍵を探す
            allow_agent=True     # メモリ上の秘密鍵を取得
        )

        print("SSH connection established!")

        stdin, stdout, stderr = client.exec_command('whoami')
        result = stdout.read().decode().strip()
        print(f"Connected as: {result}")

        print("\nEntering interactive SSH session. Type 'exit' to quit.")

        current_dir = f"/home/{username}"  # 初期ディレクトリ

        while True:
            try:
                command = input(f"ssh:{current_dir}> ")
                if command.lower() in ['exit', 'quit']:
                    break

                if command.strip():
                    # cdコマンドの場合は特別処理
                    if command.strip().startswith('cd '):
                        target_dir = command.strip()[3:].strip()
                        if target_dir == '':
                            target_dir = f'/home/{username}'
                        elif not target_dir.startswith('/'):
                            target_dir = f"{current_dir}/{target_dir}"

                        # ディレクトリ存在チェック
                        test_cmd = f"cd {target_dir} && pwd"
                        stdin, stdout, stderr = client.exec_command(test_cmd)
                        output = stdout.read().decode().strip()
                        error = stderr.read().decode().strip()

                        if error:
                            print(f"Error: {error}")
                        else:
                            current_dir = output
                            print(f"Changed directory to: {current_dir}")
                    else:
                        # 通常のコマンドは現在のディレクトリで実行
                        full_command = f"cd {current_dir} && {command}"
                        stdin, stdout, stderr = client.exec_command(full_command)
                        output = stdout.read().decode().strip()
                        error = stderr.read().decode().strip()

                        if output:
                            print(output)
                        if error:
                            print(f"Error: {error}")

            except KeyboardInterrupt:
                print("\nExiting...")
                break
            except EOFError:
                print("\nExiting...")
                break

        client.close()
        print("\nSSH connection closed.")

    except Exception as e:
        print(f"SSH connection failed: {e}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("使い方: python tor.py <host> <username>")
        print("例: python tor.py ipアドレス ユーザー名")
        sys.exit(1)

    host = sys.argv[1]
    username = sys.argv[2]
    print(f"TorでSSH接続してるよ！")
    print(f"Host: {host}")
    print(f"User: {username}")
    ssh_connect(host, username)
