$EncryptedFile = "C:\Users\dkc15588\Desktop\backups\daihatsu_kyushu_db_20251028_123456.backup.enc"
$DecryptedFile = "C:\temp\restore.backup"
$Password = "YourStrongPasswordHere"

$EncryptedBytes = [System.IO.File]::ReadAllBytes($EncryptedFile)
$AES = New-Object System.Security.Cryptography.AesManaged
$AES.Key = [System.Text.Encoding]::UTF8.GetBytes(($Password.PadRight(32, 'X').Substring(0,32)))
$AES.IV = New-Object byte[] ($AES.BlockSize / 8)
$Decryptor = $AES.CreateDecryptor()
$DecryptedBytes = $Decryptor.TransformFinalBlock($EncryptedBytes, 0, $EncryptedBytes.Length)
[System.IO.File]::WriteAllBytes($DecryptedFile, $DecryptedBytes)
