#Requires -Version 5.1
<#
.SYNOPSIS
    Connects to Microsoft Graph for Conditional Access policy collection.

.DESCRIPTION
    Establishes a connection to Microsoft Graph using various authentication methods.
    Supports device code, interactive, client credentials, certificate, and managed identity.

.PARAMETER UseDeviceCode
    Use device code authentication flow. Displays a code to enter at microsoft.com/devicelogin.

.PARAMETER Interactive
    Use interactive browser authentication.

.PARAMETER ClientId
    Application (client) ID for app-based authentication.

.PARAMETER ClientSecret
    Client secret for client credentials authentication.

.PARAMETER TenantId
    Directory (tenant) ID for app-based authentication.

.PARAMETER CertificateThumbprint
    Certificate thumbprint for certificate-based authentication.

.PARAMETER ManagedIdentity
    Use Azure Managed Identity for authentication.

.PARAMETER Scopes
    Additional scopes to request. Default scopes are automatically included.

.EXAMPLE
    Connect-CAGapGraph -UseDeviceCode
    
    Connects using device code flow.

.EXAMPLE
    Connect-CAGapGraph -ClientId "app-id" -ClientSecret "secret" -TenantId "tenant-id"
    
    Connects using client credentials.

.EXAMPLE
    Connect-CAGapGraph -ManagedIdentity
    
    Connects using Azure Managed Identity.
#>
function Connect-CAGapGraph {
    [CmdletBinding(DefaultParameterSetName = 'DeviceCode')]
    param(
        [Parameter(ParameterSetName = 'DeviceCode')]
        [switch]$UseDeviceCode,

        [Parameter(ParameterSetName = 'Interactive')]
        [switch]$Interactive,

        [Parameter(ParameterSetName = 'ClientCredentials', Mandatory)]
        [Parameter(ParameterSetName = 'Certificate', Mandatory)]
        [string]$ClientId,

        [Parameter(ParameterSetName = 'ClientCredentials', Mandatory)]
        [string]$ClientSecret,

        [Parameter(ParameterSetName = 'ClientCredentials', Mandatory)]
        [Parameter(ParameterSetName = 'Certificate', Mandatory)]
        [Parameter(ParameterSetName = 'ManagedIdentity')]
        [string]$TenantId,

        [Parameter(ParameterSetName = 'Certificate', Mandatory)]
        [string]$CertificateThumbprint,

        [Parameter(ParameterSetName = 'ManagedIdentity')]
        [switch]$ManagedIdentity,

        [Parameter()]
        [string[]]$Scopes
    )

    # Default required scopes
    $defaultScopes = @(
        'Policy.Read.All',
        'Directory.Read.All',
        'Group.Read.All',
        'Application.Read.All',
        'RoleManagement.Read.Directory'
    )

    # Merge with additional scopes
    $allScopes = $defaultScopes
    if ($Scopes) {
        $allScopes = $defaultScopes + $Scopes | Select-Object -Unique
    }

    # Ensure Microsoft.Graph.Authentication is available
    $graphAuthModule = Get-Module -Name 'Microsoft.Graph.Authentication' -ListAvailable | Select-Object -First 1
    if (-not $graphAuthModule) {
        throw "Microsoft.Graph.Authentication module not found. Install it with: Install-Module Microsoft.Graph.Authentication -Scope CurrentUser"
    }

    Import-Module Microsoft.Graph.Authentication -Force -ErrorAction Stop

    Write-Host "[CAGapCollector] Connecting to Microsoft Graph..." -ForegroundColor Cyan

    try {
        $connectParams = @{
            ContextScope = 'Process'
            NoWelcome = $true
        }

        switch ($PSCmdlet.ParameterSetName) {
            'DeviceCode' {
                $connectParams['UseDeviceCode'] = $true
                $connectParams['Scopes'] = $allScopes
                Write-Host "[CAGapCollector] Using device code flow. Watch for the device code prompt..." -ForegroundColor Yellow
            }
            'Interactive' {
                $connectParams['Scopes'] = $allScopes
                Write-Host "[CAGapCollector] Opening browser for interactive authentication..." -ForegroundColor Yellow
            }
            'ClientCredentials' {
                $secureSecret = ConvertTo-SecureString -String $ClientSecret -AsPlainText -Force
                $credential = New-Object System.Management.Automation.PSCredential($ClientId, $secureSecret)
                $connectParams['ClientSecretCredential'] = $credential
                $connectParams['TenantId'] = $TenantId
                Write-Host "[CAGapCollector] Using client credentials authentication..." -ForegroundColor Yellow
            }
            'Certificate' {
                $connectParams['ClientId'] = $ClientId
                $connectParams['TenantId'] = $TenantId
                $connectParams['CertificateThumbprint'] = $CertificateThumbprint
                Write-Host "[CAGapCollector] Using certificate-based authentication..." -ForegroundColor Yellow
            }
            'ManagedIdentity' {
                $connectParams['Identity'] = $true
                if ($TenantId) {
                    $connectParams['TenantId'] = $TenantId
                }
                Write-Host "[CAGapCollector] Using managed identity authentication..." -ForegroundColor Yellow
            }
        }

        Connect-MgGraph @connectParams

        $context = Get-MgContext
        if (-not $context) {
            throw "Failed to establish connection - no context returned"
        }

        $script:Connected = $true
        $script:ConnectionInfo = @{
            Account = $context.Account
            TenantId = $context.TenantId
            Scopes = $context.Scopes
            AuthType = $PSCmdlet.ParameterSetName
            ConnectedAt = Get-Date
        }

        Write-Host "[CAGapCollector] Connected successfully!" -ForegroundColor Green
        Write-Host "  Account: $($context.Account)" -ForegroundColor Cyan
        Write-Host "  Tenant: $($context.TenantId)" -ForegroundColor Cyan

        return [pscustomobject]$script:ConnectionInfo
    }
    catch {
        $script:Connected = $false
        $script:ConnectionInfo = $null
        throw "Failed to connect to Microsoft Graph: $($_.Exception.Message)"
    }
}

