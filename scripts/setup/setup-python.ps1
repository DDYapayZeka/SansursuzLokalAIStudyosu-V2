# Sansursuz Lokal AI Studyosu - DD:YZ - Portable Python AI components
# Installs a private Python 3.12 + PyTorch + the TTS / speech / music / video packages into
# app/tools/python-env using uv. Nothing is installed system-wide.
param(
    [string]$TorchBackend = "",   # cu130 / cu128 / cu126 / cpu ; empty = detect from the NVIDIA driver
    [switch]$Force = $false
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$UvVersion     = "0.12.24"
$PythonVersion = "3.12"

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir    = Split-Path -Parent (Split-Path -Parent $scriptDir)
$toolsDir   = Join-Path $rootDir "app\tools"
$uvDir      = Join-Path $toolsDir "uv"
$uvExe      = Join-Path $uvDir "uv.exe"
$envDir     = Join-Path $toolsDir "python-env"
$envPython  = Join-Path $envDir "Scripts\python.exe"
$readyFile  = Join-Path $envDir ".ddyz-ready.json"
$failedFile = Join-Path $toolsDir "python-env.failed.txt"
$requirements = Join-Path $scriptDir "requirements-ai.txt"

function Info { param([string]$m); Write-Host "   >>  $m" -ForegroundColor Cyan }
function Ok   { param([string]$m); Write-Host "   OK  $m" -ForegroundColor Green }
function Warn { param([string]$m); Write-Host "   !!  $m" -ForegroundColor Yellow }

function Get-TorchBackend {
    # PyTorch CUDA builds need a minimum NVIDIA driver: cu130 >= 580, cu128 >= 570, cu126 >= 560.
    $smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if (-not $smi) { return "cpu" }
    try {
        $driver = (& nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>$null | Select-Object -First 1).Trim()
        $major = [int]($driver.Split(".")[0])
        if ($major -ge 580) { return "cu130" }
        if ($major -ge 570) { return "cu128" }
        if ($major -ge 560) { return "cu126" }
        Warn "NVIDIA driver $driver is too old for current CUDA builds of PyTorch; using the CPU build. Update the driver for GPU acceleration."
        return "cpu"
    } catch {
        return "cpu"
    }
}

try {
    if ((Test-Path $readyFile) -and (Test-Path $envPython) -and -not $Force) {
        Ok "Python AI components already installed (app/tools/python-env)."
        exit 0
    }
    New-Item -ItemType Directory -Force -Path $toolsDir, $uvDir | Out-Null
    Remove-Item $failedFile -Force -ErrorAction SilentlyContinue

    if (-not (Test-Path $uvExe)) {
        Info "Downloading uv $UvVersion (Python package manager)..."
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072
        $zip = Join-Path $toolsDir "uv.zip"
        Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/astral-sh/uv/releases/download/$UvVersion/uv-x86_64-pc-windows-msvc.zip" -OutFile $zip
        Expand-Archive -Path $zip -DestinationPath $uvDir -Force
        Remove-Item $zip -Force
        $found = Get-ChildItem $uvDir -Recurse -Filter uv.exe | Select-Object -First 1
        if (-not $found) { throw "uv.exe was not found in the downloaded archive." }
        if ($found.FullName -ne $uvExe) { Copy-Item $found.FullName $uvExe -Force }
    }

    # Keep Python, the package cache and the environment inside the project folder.
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $toolsDir "python"
    $env:UV_CACHE_DIR = Join-Path $toolsDir "uv-cache"
    $env:UV_PYTHON_PREFERENCE = "only-managed"

    Info "Installing private Python $PythonVersion..."
    & $uvExe python install $PythonVersion
    if ($LASTEXITCODE -ne 0) { throw "Python $PythonVersion could not be installed." }

    if (-not (Test-Path $envPython)) {
        & $uvExe venv $envDir --python $PythonVersion
        if ($LASTEXITCODE -ne 0) { throw "The Python environment could not be created." }
    }

    if (-not $TorchBackend) { $TorchBackend = Get-TorchBackend }
    Info "Installing PyTorch ($TorchBackend) and AI packages. This downloads several GB and can take a while..."
    & $uvExe pip install --python $envPython torch torchvision torchaudio -r $requirements --torch-backend $TorchBackend
    if ($LASTEXITCODE -ne 0) { throw "Package installation failed." }

    $check = "import torch, transformers, diffusers, soundfile, onnxruntime, sentencepiece, antalia_mini, ema_lightning, trnorm, supertonic, omnivoice, imageio_ffmpeg, json; print(json.dumps({'torch': torch.__version__, 'cuda': torch.cuda.is_available(), 'transformers': transformers.__version__, 'diffusers': diffusers.__version__}))"
    $result = & $envPython -c $check
    if ($LASTEXITCODE -ne 0) { throw "Installed packages could not be imported." }
    $info = $result | Select-Object -Last 1 | ConvertFrom-Json

    @{
        python = $PythonVersion
        torchBackend = $TorchBackend
        torch = $info.torch
        cuda = $info.cuda
        transformers = $info.transformers
        diffusers = $info.diffusers
        installedAt = (Get-Date).ToString("s")
    } | ConvertTo-Json | Out-File -FilePath $readyFile -Encoding utf8

    # Downloaded wheels are no longer needed once the environment is built.
    & $uvExe cache clean | Out-Null

    if ($TorchBackend -ne "cpu" -and -not $info.cuda) {
        Warn "PyTorch was installed but CUDA is not available; AI audio/video will run on the CPU."
    }
    Ok "Python AI components ready (torch $($info.torch), CUDA: $($info.cuda))."
    exit 0
} catch {
    $message = $_.Exception.Message
    "Python AI component setup failed: $message`r`nRun scripts\setup\setup-python.ps1 again to retry." | Out-File -FilePath $failedFile -Encoding utf8
    Warn "Python AI component setup failed: $message"
    Warn "Image, chat and Whisper still work. Run scripts\setup\setup-python.ps1 again later to retry."
    exit 1
}
