param(
    [string]$EncryptedFile = ""
)

$BACKUP_DIR = "C:\Users\dkc15588\Desktop\backups"
$PRIVATE_KEY_FILE = "C:\Users\dkc15588\Desktop\backups\private_key.xml"

Write-Host "=== Database Decryption Script ===" -ForegroundColor Cyan

# If no encrypted file specified, use the latest backup
if ($EncryptedFile -eq "") {
    Write-Host "No file specified. Searching for the latest backup..." -ForegroundColor Yellow
    $LatestBackup = Get-ChildItem -Path $BACKUP_DIR -Filter "*.enc" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

    if ($null -eq $LatestBackup) {
        Write-Host "ERROR: No encrypted backup files found in $BACKUP_DIR" -ForegroundColor Red
        exit 1
    }

    $EncryptedFile = $LatestBackup.FullName
    Write-Host "Using latest backup: $($LatestBackup.Name)" -ForegroundColor Green
}

# Check if encrypted file exists
if (!(Test-Path $EncryptedFile)) {
    Write-Host "ERROR: Encrypted file not found - $EncryptedFile" -ForegroundColor Red
    exit 1
}

# Check if private key exists
if (!(Test-Path $PRIVATE_KEY_FILE)) {
    Write-Host "ERROR: Private key not found - $PRIVATE_KEY_FILE" -ForegroundColor Red
    Write-Host "Please place the private key in the correct location" -ForegroundColor Yellow
    exit 1
}

try {
    # === Decrypt with RSA Private Key ===
    Write-Host "Starting decryption..." -ForegroundColor Cyan

    # Read encrypted file
    $EncryptedData = [System.IO.File]::ReadAllBytes($EncryptedFile)
    $Offset = 0

    # Read AES key length (4 bytes)
    $KeyLength = [System.BitConverter]::ToInt32($EncryptedData, $Offset)
    $Offset += 4

    # Read encrypted AES key
    $EncryptedAESKey = $EncryptedData[$Offset..($Offset + $KeyLength - 1)]
    $Offset += $KeyLength

    # Read IV length (4 bytes)
    $IVLength = [System.BitConverter]::ToInt32($EncryptedData, $Offset)
    $Offset += 4

    # Read encrypted IV
    $EncryptedAESIV = $EncryptedData[$Offset..($Offset + $IVLength - 1)]
    $Offset += $IVLength

    # Read encrypted data
    $EncryptedBytes = $EncryptedData[$Offset..($EncryptedData.Length - 1)]

    # Load RSA private key
    $PrivateKeyXML = [System.IO.File]::ReadAllText($PRIVATE_KEY_FILE)
    $RSA = New-Object System.Security.Cryptography.RSACryptoServiceProvider(4096)
    $RSA.FromXmlString($PrivateKeyXML)

    # Decrypt AES key and IV
    $AESKey = $RSA.Decrypt($EncryptedAESKey, $true)
    $AESIV = $RSA.Decrypt($EncryptedAESIV, $true)
    $RSA.Dispose()

    # Decrypt data with AES
    $AES = New-Object System.Security.Cryptography.AesManaged
    $AES.Key = $AESKey
    $AES.IV = $AESIV
    $Decryptor = $AES.CreateDecryptor()
    $DecryptedBytes = $Decryptor.TransformFinalBlock($EncryptedBytes, 0, $EncryptedBytes.Length)
    $AES.Dispose()

    # Save decrypted backup file (remove .enc extension only)
    $DecryptedFile = $EncryptedFile -replace '\.enc$', ''
    [System.IO.File]::WriteAllBytes($DecryptedFile, $DecryptedBytes)

    Write-Host "`n=== Decryption Completed ===" -ForegroundColor Green
    Write-Host "Decrypted file: $DecryptedFile" -ForegroundColor Cyan
    Write-Host "File size: $([math]::Round($DecryptedBytes.Length / 1MB, 2)) MB" -ForegroundColor White
}
catch {
    Write-Host "`nERROR: Decryption failed" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "`nPossible causes:" -ForegroundColor Yellow
    Write-Host "- Incorrect private key" -ForegroundColor White
    Write-Host "- Corrupted encrypted file" -ForegroundColor White
    Write-Host "- Mismatched file format" -ForegroundColor White
    exit 1
}
