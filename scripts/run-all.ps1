[CmdletBinding()]
param(
    [switch]$SkipConnect,
    [switch]$SkipDisconnect,
    [string]$TenantId,
    [switch]$UseDeviceCode = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Status {
    param([string]$Message, [string]$Type = 'Info')
    $timestamp = Get-Date -Format 'HH:mm:ss'
    switch ($Type) {
        'Success' { Write-Host "[$timestamp] ✓ $Message" -ForegroundColor Green }
        'Error'   { Write-Host "[$timestamp] ✗ $Message" -ForegroundColor Red }
        'Info'    { Write-Host "[$timestamp] ℹ $Message" -ForegroundColor Cyan }
        'Step'    { Write-Host "[$timestamp] → $Message" -ForegroundColor Yellow }
    }
}

$scriptDir = $PSScriptRoot
$projectRoot = Split-Path -Parent $scriptDir
$outputDir = Join-Path -Path $projectRoot -ChildPath 'output'
$webPublicDir = Join-Path -Path $projectRoot -ChildPath 'web/public'
$webPublicEntitiesDir = Join-Path -Path $webPublicDir -ChildPath 'entities'

Write-Status "Conditional Access Gap Analysis Tool" -Type Info
Write-Status "================================================================" -Type Info

# Step 1: Collect Conditional Access Policies
Write-Status "Step 1: Collecting Conditional Access Policies..." -Type Step
Write-Status "(This may take several minutes for large tenants - progress will be shown below)" -Type Info
Write-Host ""
try {
    $collectParams = @{
        OutputDir = $outputDir
        SkipDisconnect = $true
    }
    
    if ($SkipConnect) {
        $collectParams['SkipConnect'] = $true
    } else {
        if ($TenantId) {
            $collectParams['TenantId'] = $TenantId
        }
        if ($UseDeviceCode) {
            $collectParams['UseDeviceCode'] = $true
        }
    }
    
    $collectScript = Join-Path -Path $scriptDir -ChildPath 'collect-conditional-access.ps1'
    # Call script and ensure all output is visible to the user
    & $collectScript @collectParams | Out-Default
    
    Write-Host ""
    Write-Status "Conditional Access policies collected successfully" -Type Success
} catch {
    Write-Status "Failed to collect Conditional Access policies: $($_.Exception.Message)" -Type Error
    throw
}

# Step 2: Collect Directory Objects
Write-Status "Step 2: Collecting Directory Objects (Users, Groups, Roles, etc.)..." -Type Step
Write-Host ""
try {
    $objectsScript = Join-Path -Path $scriptDir -ChildPath 'collect-directory-objects.ps1'
    # Call script and ensure all output is visible to the user
    & $objectsScript -SkipConnect | Out-Default
    
    Write-Host ""
    Write-Status "Directory objects collected successfully" -Type Success
} catch {
    Write-Status "Failed to collect directory objects: $($_.Exception.Message)" -Type Error
    throw
}

# Step 3: Build Graph JSON
Write-Status "Step 3: Building graph visualization data..." -Type Step
Write-Host ""
try {
    $inputJson = Join-Path -Path $outputDir -ChildPath 'conditional_access_policies.json'
    $outputJson = Join-Path -Path $outputDir -ChildPath 'conditional_access_graph.json'
    
    $graphScript = Join-Path -Path $scriptDir -ChildPath 'build-graph-json.ps1'
    # Call script and ensure all output is visible to the user
    & $graphScript -InputJsonPath $inputJson -OutputJsonPath $outputJson | Out-Default
    
    Write-Host ""
    Write-Status "Graph visualization data built successfully" -Type Success
} catch {
    Write-Status "Failed to build graph JSON: $($_.Exception.Message)" -Type Error
    throw
}

# Step 4: Copy outputs to web public directory
Write-Status "Step 4: Copying outputs to web application..." -Type Step
try {
    # Ensure web/public directories exist
    if (-not (Test-Path -LiteralPath $webPublicDir)) {
        New-Item -ItemType Directory -Path $webPublicDir -Force | Out-Null
    }
    if (-not (Test-Path -LiteralPath $webPublicEntitiesDir)) {
        New-Item -ItemType Directory -Path $webPublicEntitiesDir -Force | Out-Null
    }
    
    # Copy main graph and policies files
    $graphJson = Join-Path -Path $outputDir -ChildPath 'conditional_access_graph.json'
    $policiesJson = Join-Path -Path $outputDir -ChildPath 'conditional_access_policies.json'
    
    if (Test-Path -LiteralPath $graphJson) {
        Copy-Item -LiteralPath $graphJson -Destination $webPublicDir -Force
        Write-Status "  ✓ Copied conditional_access_graph.json" -Type Info
    }
    
    if (Test-Path -LiteralPath $policiesJson) {
        Copy-Item -LiteralPath $policiesJson -Destination $webPublicDir -Force
        Write-Status "  ✓ Copied conditional_access_policies.json" -Type Info
    }
    
    # Copy entity files
    $entitiesSourceDir = Join-Path -Path $outputDir -ChildPath 'entities'
    if (Test-Path -LiteralPath $entitiesSourceDir) {
        Get-ChildItem -LiteralPath $entitiesSourceDir -File -Filter '*.json' | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $webPublicEntitiesDir -Force
            Write-Status "  ✓ Copied entities/$($_.Name)" -Type Info
        }
    }
    
    Write-Status "All outputs copied to web/public directory" -Type Success
} catch {
    Write-Status "Failed to copy outputs: $($_.Exception.Message)" -Type Error
    throw
}

# Disconnect from Graph if needed
if (-not $SkipDisconnect) {
    try {
        Write-Status "Disconnecting from Microsoft Graph..." -Type Info
        Disconnect-MgGraph | Out-Null
        Write-Status "Disconnected successfully" -Type Success
    } catch {
        Write-Status "Failed to disconnect: $($_.Exception.Message)" -Type Error
    }
}

Write-Status "================================================================" -Type Info
Write-Status "Pipeline completed successfully!" -Type Success
Write-Status "" -Type Info
Write-Status "Next steps:" -Type Info
Write-Status "  1. Navigate to the web directory: cd web" -Type Info
Write-Status "  2. Install dependencies (first time): npm install" -Type Info
Write-Status "  3. Start the dev server: npm run dev" -Type Info
Write-Status "  4. Or build for production: npm run build && npm run preview" -Type Info

