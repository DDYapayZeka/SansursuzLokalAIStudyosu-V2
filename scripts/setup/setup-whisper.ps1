param([string]$Release = "v1.9.1")

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent (Split-Path -Parent $scriptDir)
$appDir = Join-Path $rootDir "app"
$toolsDir = Join-Path $appDir "tools"
$speechWinRoot = Join-Path $appDir "speech-backend\win"
$speechRoot = Join-Path $speechWinRoot "cpu"
$speechVulkanRoot = Join-Path $speechWinRoot "vulkan"

function Enable-Tls12 {
    try {
        $tls12 = [Enum]::ToObject([Net.SecurityProtocolType], 3072)
        [Net.ServicePointManager]::SecurityProtocol =
            [Net.ServicePointManager]::SecurityProtocol -bor $tls12
    } catch {
        throw "TLS 1.2 could not be enabled: $($_.Exception.Message)"
    }
}

function Download-File {
    param([string]$Url, [string]$DestPath, [string]$Label)
    Write-Host "   >>  Downloading $Label..."
    Enable-Tls12
    $client = New-Object System.Net.WebClient
    $client.Headers.Add("User-Agent", "Uncensored-AI-Studio")
    try {
        $client.DownloadFile($Url, $DestPath)
    } finally {
        $client.Dispose()
    }
}

function Find-FirstFile {
    param([string]$Root, [string[]]$Names)
    foreach ($name in $Names) {
        $found = Get-ChildItem $Root -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ieq $name } |
            Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

$speechCudaRoot = Join-Path $speechWinRoot "cuda"

# Official cuBLAS build of the same release; used automatically when an NVIDIA GPU is present
# (about 13x faster than the CPU build for large-v3-turbo in our tests on an RTX 50-series GPU).
function Install-CudaBackend {
    if (Test-Path (Join-Path $speechCudaRoot "whisper-cli.exe")) { return }
    if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) { return }
    $cudaAsset = "whisper-cublas-12.4.0-bin-x64.zip"
    $cudaArchive = Join-Path $toolsDir $cudaAsset
    $cudaExtract = Join-Path $toolsDir "whisper-cuda-extract"
    try {
        Remove-Item $cudaArchive, $cudaExtract -Recurse -Force -ErrorAction SilentlyContinue
        Download-File -Url "https://github.com/ggml-org/whisper.cpp/releases/download/$Release/$cudaAsset" -DestPath $cudaArchive -Label "whisper.cpp CUDA GPU backend ($Release, ~680 MB)"
        Expand-Archive -Path $cudaArchive -DestinationPath $cudaExtract -Force
        New-Item -ItemType Directory -Force -Path $speechCudaRoot | Out-Null
        Get-ChildItem $cudaExtract -Recurse -File |
            Where-Object { $_.Extension -ieq ".dll" -or $_.Name -in @("whisper-cli.exe", "whisper-server.exe") } |
            ForEach-Object { Copy-Item $_.FullName (Join-Path $speechCudaRoot $_.Name) -Force }
        Write-Host "   OK  whisper.cpp CUDA GPU backend installed: app/speech-backend/win/cuda"
    } catch {
        Write-Host "   !!  CUDA speech backend could not be installed ($($_.Exception.Message)); CPU backend will be used."
    } finally {
        Remove-Item $cudaArchive, $cudaExtract -Recurse -Force -ErrorAction SilentlyContinue
    }
}

New-Item -ItemType Directory -Force -Path $toolsDir, $speechRoot, $speechVulkanRoot | Out-Null

$cliPath = Join-Path $speechRoot "whisper-cli.exe"
if (Test-Path $cliPath) {
    Write-Host "   OK  whisper.cpp speech backend already ready."
    Install-CudaBackend
    exit 0
}

$legacyCli = Join-Path $speechWinRoot "whisper-cli.exe"
$legacyServer = Join-Path $speechWinRoot "whisper-server.exe"
if (Test-Path $legacyCli) {
    Copy-Item $legacyCli $cliPath -Force
    if (Test-Path $legacyServer) {
        Copy-Item $legacyServer (Join-Path $speechRoot "whisper-server.exe") -Force
    }
    Get-ChildItem $speechWinRoot -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notin @("whisper-cli.exe", "whisper-server.exe") } |
        ForEach-Object { Copy-Item $_.FullName (Join-Path $speechRoot $_.Name) -Force }
    Write-Host "   OK  migrated existing whisper.cpp CPU backend to app/speech-backend/win/cpu."
    Install-CudaBackend
    exit 0
}

$asset = "whisper-bin-x64.zip"
$archive = Join-Path $toolsDir $asset
$extract = Join-Path $toolsDir "whisper-extract"
$url = "https://github.com/ggml-org/whisper.cpp/releases/download/$Release/$asset"

Remove-Item $archive, $extract -Recurse -Force -ErrorAction SilentlyContinue
Download-File -Url $url -DestPath $archive -Label "whisper.cpp speech backend ($Release)"

Write-Host "   >>  Extracting whisper.cpp speech backend..."
Expand-Archive -Path $archive -DestinationPath $extract -Force

$cli = Find-FirstFile -Root $extract -Names @("whisper-cli.exe", "main.exe")
$server = Find-FirstFile -Root $extract -Names @("whisper-server.exe", "server.exe")
if (-not $cli) {
    throw "whisper-cli.exe was not found after extracting $asset"
}

Get-ChildItem $extract -Recurse -File | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $speechRoot $_.Name) -Force
}
if ((Split-Path -Leaf $cli) -ine "whisper-cli.exe") {
    Copy-Item $cli $cliPath -Force
}
if ($server -and (Split-Path -Leaf $server) -ine "whisper-server.exe") {
    Copy-Item $server (Join-Path $speechRoot "whisper-server.exe") -Force
}

Remove-Item $archive, $extract -Recurse -Force -ErrorAction SilentlyContinue
if (-not (Test-Path $cliPath)) {
    throw "whisper-cli.exe was not installed."
}
Write-Host "   OK  whisper.cpp speech backend installed."
Write-Host "   ..  CPU backend path: app/speech-backend/win/cpu"
Install-CudaBackend
