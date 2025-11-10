# RSA Key Pair Generation Script
# Usage: .\generate_keys.ps1

$KEY_DIR = "C:\Users\dkc15588\Desktop\backups"
$PUBLIC_KEY_FILE = "$KEY_DIR\public_key.xml"
$PRIVATE_KEY_FILE = "$KEY_DIR\private_key.xml"

Write-Host "=== RSA Key Pair Generation ===" -ForegroundColor Cyan

# Create key directory
if (!(Test-Path $KEY_DIR)) {
    New-Item -ItemType Directory -Path $KEY_DIR | Out-Null
    Write-Host "Created key directory: $KEY_DIR" -ForegroundColor Green
}

# Check for existing keys
if ((Test-Path $PUBLIC_KEY_FILE) -or (Test-Path $PRIVATE_KEY_FILE)) {
    Write-Host "Warning: Key files already exist" -ForegroundColor Yellow
    $confirm = Read-Host "Overwrite? (y/N)"
    if ($confirm -ne "y") {
        Write-Host "Key generation cancelled" -ForegroundColor Yellow
        exit 0
    }
}

try {
    # Generate RSA key pair (4096bit)
    Write-Host "Generating RSA key pair (4096bit)..." -ForegroundColor Cyan
    $RSA = New-Object System.Security.Cryptography.RSACryptoServiceProvider(4096)

    # Export public key (for encryption)
    $PublicKeyXML = $RSA.ToXmlString($false)
    [System.IO.File]::WriteAllText($PUBLIC_KEY_FILE, $PublicKeyXML)
    Write-Host "Public key saved: $PUBLIC_KEY_FILE" -ForegroundColor Green

    # Export private key (for decryption)
    $PrivateKeyXML = $RSA.ToXmlString($true)
    [System.IO.File]::WriteAllText($PRIVATE_KEY_FILE, $PrivateKeyXML)
    Write-Host "Private key saved: $PRIVATE_KEY_FILE" -ForegroundColor Green

    $RSA.Dispose()

    Write-Host "`n=== Generation Complete ===" -ForegroundColor Green
    Write-Host "Public key: $PUBLIC_KEY_FILE (Place on backup server)" -ForegroundColor White
    Write-Host "Private key: $PRIVATE_KEY_FILE (Keep in secure location)" -ForegroundColor White
    Write-Host "`nIMPORTANT: Back up the private key to a secure location and delete the original file" -ForegroundColor Yellow
}
catch {
    Write-Host "ERROR: Key pair generation failed" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
