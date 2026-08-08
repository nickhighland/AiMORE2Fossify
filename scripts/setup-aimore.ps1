$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "setup_aimore.py"
$python = Get-Command py -ErrorAction SilentlyContinue
if (-not $python) {
    $python = Get-Command python -ErrorAction SilentlyContinue
}
if (-not $python) {
    throw "Python 3 was not found. Install Python and rerun this script."
}
& $python.Source $script @args
exit $LASTEXITCODE

