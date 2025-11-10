$BACKUP_DIR = "C:\Users\dkc15588\Desktop\backups"
$DB_NAME = "daihatsu_kyushu_db"
$DB_USER = "hogehoge"
$PG_BIN = "C:\Program Files\PostgreSQL\17\bin"
$DATE = Get-Date -Format "yyyyMMdd_HHmmss"
$BACKUP_FILE = "$BACKUP_DIR\${DB_NAME}_${DATE}.backup"
$LOG_FILE = "$BACKUP_DIR\backup.log"
$RETENTION_DAYS = 90
$PUBLIC_KEY_FILE = "C:\Users\dkc15588\public_key.xml"

# バックアップディレクトリ作成
if (!(Test-Path $BACKUP_DIR)) {
    New-Item -ItemType Directory -Path $BACKUP_DIR
}

# PostgreSQLバックアップ実行
$env:PGPASSWORD = "hugahuga"
& "$PG_BIN\pg_dump.exe" -U $DB_USER -F c -b -v --no-owner --no-acl -f $BACKUP_FILE $DB_NAME

if ($LASTEXITCODE -eq 0) {
    $message = "$(Get-Date): Backup successful - $BACKUP_FILE"
    Add-Content -Path $LOG_FILE -Value $message
    Write-Host $message -ForegroundColor Green

    try {
        # === RSA公開鍵暗号化処理 ===
        $EncryptedFile = "$BACKUP_FILE.enc"

        # ランダムなAES鍵とIVを生成
        $AES = New-Object System.Security.Cryptography.AesManaged
        $AES.KeySize = 256
        $AES.GenerateKey()
        $AES.GenerateIV()

        # バックアップファイルをAESで暗号化
        $Bytes = [System.IO.File]::ReadAllBytes($BACKUP_FILE)
        $Encryptor = $AES.CreateEncryptor()
        $EncryptedBytes = $Encryptor.TransformFinalBlock($Bytes, 0, $Bytes.Length)

        # RSA公開鍵を読み込み
        $PublicKeyXML = [System.IO.File]::ReadAllText($PUBLIC_KEY_FILE)
        $RSA = New-Object System.Security.Cryptography.RSACryptoServiceProvider(4096)
        $RSA.FromXmlString($PublicKeyXML)

        # AES鍵とIVをRSA公開鍵で暗号化
        $EncryptedAESKey = $RSA.Encrypt($AES.Key, $true)
        $EncryptedAESIV = $RSA.Encrypt($AES.IV, $true)

        # 暗号化データを結合して保存
        # フォーマット: [鍵長(4byte)][暗号化AES鍵][IV長(4byte)][暗号化IV][暗号化データ]
        $OutputBytes = New-Object System.Collections.Generic.List[byte]

        # AES鍵の長さ (4バイト)
        $OutputBytes.AddRange([System.BitConverter]::GetBytes($EncryptedAESKey.Length))
        # 暗号化されたAES鍵
        $OutputBytes.AddRange($EncryptedAESKey)
        # IVの長さ (4バイト)
        $OutputBytes.AddRange([System.BitConverter]::GetBytes($EncryptedAESIV.Length))
        # 暗号化されたIV
        $OutputBytes.AddRange($EncryptedAESIV)
        # 暗号化されたデータ本体
        $OutputBytes.AddRange($EncryptedBytes)

        [System.IO.File]::WriteAllBytes($EncryptedFile, $OutputBytes.ToArray())

        # クリーンアップ
        $AES.Dispose()
        $RSA.Dispose()

        # 元ファイルを削除
        Remove-Item $BACKUP_FILE -Force

        $message = "$(Get-Date): Encrypted backup saved as $EncryptedFile"
        Add-Content -Path $LOG_FILE -Value $message
        Write-Host $message -ForegroundColor Cyan
    }
    catch {
        $message = "$(Get-Date): Encryption failed - $($_.Exception.Message)"
        Add-Content -Path $LOG_FILE -Value $message
        Write-Host $message -ForegroundColor Red
        exit 1
    }
}
else {
    $message = "$(Get-Date): Backup failed"
    Add-Content -Path $LOG_FILE -Value $message
    Write-Host $message -ForegroundColor Red
    exit 1
}

# 古いバックアップの削除
$CutoffDate = (Get-Date).AddDays(-$RETENTION_DAYS)
Get-ChildItem -Path $BACKUP_DIR -Filter "*.enc" | Where-Object {
    $_.LastWriteTime -lt $CutoffDate
} | ForEach-Object {
    Remove-Item $_.FullName -Force
    $message = "$(Get-Date): Deleted old backup - $($_.Name)"
    Add-Content -Path $LOG_FILE -Value $message
    Write-Host $message -ForegroundColor Yellow
}
