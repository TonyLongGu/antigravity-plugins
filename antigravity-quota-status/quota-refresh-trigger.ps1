$sentinel = Join-Path $env:USERPROFILE '.gemini\antigravity-ide\quota-refresh.trigger'
[System.IO.File]::WriteAllText($sentinel, [System.DateTime]::UtcNow.ToString('o'))
