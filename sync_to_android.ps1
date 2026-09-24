$source = "c:\Users\Khushi\Desktop\A.I. Leads Agent"
$destination = "$source\AndroidApp\app\src\main\assets"

Write-Host "Syncing web files to Android Assets folder..."
Copy-Item "$source\index.html" -Destination $destination -Force
Copy-Item "$source\styles.css" -Destination $destination -Force
Copy-Item "$source\app.js" -Destination $destination -Force
Copy-Item "$source\agent.js" -Destination $destination -Force
Copy-Item "$source\chat.js" -Destination $destination -Force
Copy-Item "$source\memory.js" -Destination $destination -Force
Copy-Item "$source\config.js" -Destination $destination -Force

Write-Host "Sync Complete! The Android App now has your latest code." -ForegroundColor Green
