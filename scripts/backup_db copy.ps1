$BACKUP_DIR = "C:\Users\dkc15588\Desktop\backups"
$DB_NAME = "daihatsu_kyushu_db"
$DB_USER = "hogehoge"
$PG_BIN = "C:\Program Files\PostgreSQL\17\bin"
$DATE = Get-Date -Format "yyyyMMdd_HHmmss"
$BACKUP_FILE = "$BACKUP_DIR\${DB_NAME}_${DATE}.backup"
$LOG_FILE = "$BACKUP_DIR\backup.log"
$RETENTION_DAYS = 90

if (!(Test-Path $BACKUP_DIR)) {
    New-Item -ItemType Directory -Path $BACKUP_DIR
}

$env:PGPASSWORD = "hugahuga"
& "$PG_BIN\pg_dump.exe" -U $DB_USER -F c -b -v -f $BACKUP_FILE $DB_NAME

if ($LASTEXITCODE -eq 0) {
    $message = "$(Get-Date): Backup successful - $BACKUP_FILE"
    Add-Content -Path $LOG_FILE -Value $message
    Write-Host $message -ForegroundColor Green
} else {
    $message = "$(Get-Date): Backup failed"
    Add-Content -Path $LOG_FILE -Value $message
    Write-Host $message -ForegroundColor Red
    exit 1
}

Get-ChildItem -Path $BACKUP_DIR -Filter *.backup | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RETENTION_DAYS) } | Remove-Item -Force

Write-Host "Backup completed successfully"
