# Sansursuz Lokal AI Studyosu - DD:YZ - Microsoft Visual C++ runtime check
# The prebuilt llama.cpp / stable-diffusion.cpp / whisper.cpp binaries link against the
# Visual C++ 2015-2022 x64 runtime (msvcp140.dll, vcruntime140.dll, vcruntime140_1.dll).
# Without it they exit with 0xC0000135; with a runtime older than 14.40 they crash in std::mutex
# (binaries built with VS 2022 17.10+ require the matching runtime). Returns within a second when
# the runtime is fine. A declined or failed install is recorded and not retried on every launch;
# run this script with -Force to try again.
param(
    [switch]$Force = $false
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$MinMajor = 14
$MinMinor = 40
$RedistUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe"

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir    = Split-Path -Parent (Split-Path -Parent $scriptDir)
$toolsDir   = Join-Path $rootDir "app\tools"
$failedFile = Join-Path $toolsDir "vcredist.failed.txt"

function Info { param([string]$m); Write-Host "   >>  $m" -ForegroundColor Cyan }
function Ok   { param([string]$m); Write-Host "   OK  $m" -ForegroundColor Green }
function Warn { param([string]$m); Write-Host "   !!  $m" -ForegroundColor Yellow }

function Get-VcRuntimeProblem {
    # A 32-bit PowerShell sees SysWOW64 through System32; Sysnative is the real 64-bit folder.
    $sysDir = if ([Environment]::Is64BitProcess) { "System32" } else { "Sysnative" }
    foreach ($dll in @("msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll")) {
        $path = Join-Path $env:SystemRoot "$sysDir\$dll"
        if (-not (Test-Path $path)) { return "$dll eksik" }
        $info = (Get-Item $path).VersionInfo
        if ($info.FileMajorPart -lt $MinMajor -or ($info.FileMajorPart -eq $MinMajor -and $info.FileMinorPart -lt $MinMinor)) {
            return "$dll surumu $($info.FileMajorPart).$($info.FileMinorPart) eski (en az $MinMajor.$MinMinor gerekli)"
        }
    }
    return $null
}

function Write-FailedMarker {
    param([string]$reason)
    New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
    "$(Get-Date -Format s) $reason" | Out-File -FilePath $failedFile -Encoding utf8
}

function Write-ManualHint {
    Warn "Yapay zeka motorlari (llama.cpp, stable-diffusion.cpp, whisper.cpp) bu paket olmadan model yukleyemez."
    Warn "Elle kurmak icin: $RedistUrl"
    Warn "Kurduktan sonra bu pencereyi kapatip windows.bat dosyasini yeniden calistirin."
}

$problem = Get-VcRuntimeProblem
if (-not $problem) {
    Remove-Item $failedFile -Force -ErrorAction SilentlyContinue
    exit 0
}

if ((Test-Path $failedFile) -and -not $Force) {
    Warn "Microsoft Visual C++ calisma zamani hala eksik: $problem."
    Write-ManualHint
    exit 1
}

Info "Microsoft Visual C++ 2015-2022 x64 calisma zamani gerekli: $problem."
Info "Microsoft'tan indirilip kuruluyor. Windows yonetici izni (UAC) isterse 'Evet' deyin."

$installer = Join-Path $env:TEMP "ddyz_vc_redist.x64.exe"
try {
    $tls12 = [Enum]::ToObject([Net.SecurityProtocolType], 3072)
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor $tls12
    Invoke-WebRequest -Uri $RedistUrl -OutFile $installer -UseBasicParsing

    $proc = Start-Process -FilePath $installer -ArgumentList "/install", "/quiet", "/norestart" -Verb RunAs -Wait -PassThru
    # 0 = installed, 3010 = installed but a restart is pending, 1638 = a newer version is already present.
    if (@(0, 3010, 1638) -notcontains $proc.ExitCode) {
        throw "VC_redist.x64.exe cikis kodu $($proc.ExitCode)"
    }

    $problem = Get-VcRuntimeProblem
    if ($problem) {
        if ($proc.ExitCode -eq 3010) {
            Warn "Kurulum tamamlandi ancak Windows yeniden baslatilmadan dosyalar guncellenmiyor."
            Warn "Bilgisayari yeniden baslatip windows.bat dosyasini tekrar calistirin."
            Write-FailedMarker "restart pending: $problem"
            exit 1
        }
        throw "kurulumdan sonra da sorun suruyor: $problem"
    }

    Remove-Item $failedFile -Force -ErrorAction SilentlyContinue
    Ok "Microsoft Visual C++ calisma zamani kuruldu."
    exit 0
} catch {
    Warn "Microsoft Visual C++ calisma zamani kurulamadi: $($_.Exception.Message)"
    Write-ManualHint
    Write-FailedMarker $_.Exception.Message
    exit 1
} finally {
    Remove-Item $installer -Force -ErrorAction SilentlyContinue
}
