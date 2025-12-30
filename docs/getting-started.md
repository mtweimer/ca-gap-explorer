# Getting Started

This guide walks you through setting up and running the Conditional Access Gap Analyzer for the first time.

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| PowerShell | 7.x or 5.1 | Running collection scripts |
| Node.js | 18+ | Web UI development |
| Git | Latest | Clone repository |

### Azure AD Permissions

You'll need an account with sufficient permissions or an app registration with the following Microsoft Graph permissions:

| Permission | Type | Purpose |
|------------|------|---------|
| `Policy.Read.All` | Delegated or Application | Read CA policies |
| `Directory.Read.All` | Delegated or Application | Read users, groups |
| `Group.Read.All` | Delegated or Application | Read group memberships |
| `Application.Read.All` | Delegated or Application | Read applications |
| `RoleManagement.Read.Directory` | Delegated or Application | Read role assignments |

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/hoplite-industries/conditional-access-gap-analyzer.git
cd conditional-access-gap-analyzer
```

### 2. Install Microsoft Graph PowerShell SDK

```powershell
# Install the Microsoft Graph modules
Install-Module Microsoft.Graph.Authentication -Scope CurrentUser
Install-Module Microsoft.Graph.Identity.SignIns -Scope CurrentUser
Install-Module Microsoft.Graph.Identity.DirectoryManagement -Scope CurrentUser
Install-Module Microsoft.Graph.Groups -Scope CurrentUser
Install-Module Microsoft.Graph.Applications -Scope CurrentUser
```

### 3. Import the CA Gap Collector Module

```powershell
Import-Module ./module/CAGapCollector/CAGapCollector.psd1
```

### 4. Install Web UI Dependencies

```bash
cd web
npm install
```

## First Run

### Step 1: Connect to Microsoft Graph

```powershell
# Using device code flow (recommended for interactive use)
Connect-CAGapGraph -UseDeviceCode

# Or using interactive browser
Connect-CAGapGraph -Interactive

# Or using client credentials (for automation)
Connect-CAGapGraph -ClientId "your-app-id" -ClientSecret "your-secret" -TenantId "your-tenant-id"
```

When using device code flow, you'll see a message like:
```
To sign in, use a web browser to open the page https://microsoft.com/devicelogin 
and enter the code XXXXXXXX to authenticate.
```

### Step 2: Collect Conditional Access Policies

```powershell
# Collect all policies and expand relationships
Get-CAPolicies -OutputPath ./output -Verbose

# This will create:
# - output/conditional_access_policies.json
# - output/conditional_access_policies.csv
# - output/entities/*.json
```

### Step 3: Build the Graph Data

```powershell
# Generate the graph visualization data
Export-CAGraph -InputPath ./output/conditional_access_policies.json -OutputPath ./output

# This creates:
# - output/conditional_access_graph.json
```

### Step 4: Copy Data to Web UI

```powershell
# Copy the generated files to the web public directory
Copy-Item ./output/conditional_access_graph.json ./web/public/
Copy-Item ./output/conditional_access_policies.json ./web/public/
Copy-Item ./output/entities/* ./web/public/entities/ -Recurse
```

### Step 5: Start the Web UI

```bash
cd web
npm run dev
```

Open your browser to `http://localhost:5173` to view the analysis.

### Step 6: Disconnect

```powershell
Disconnect-CAGapGraph
```

## Quick Run Script

For convenience, you can use the all-in-one script:

```powershell
# Run the complete pipeline
./scripts/run-all.ps1

# With specific tenant
./scripts/run-all.ps1 -TenantId "your-tenant-id"

# Skip connection (reuse existing session)
./scripts/run-all.ps1 -SkipConnect
```

## Using Docker

### Complete Pipeline

```bash
# Build and run everything
docker-compose up

# Follow the device code prompt in the logs to authenticate
```

### Collection Only

```bash
docker-compose --profile collector up
```

### Web UI Only (with existing data)

```bash
# Place your output files in ./output first
docker-compose --profile web up

# Access at http://localhost:5173
```

## Troubleshooting

### "No policies returned"

- Ensure your account has `Policy.Read.All` permission
- Check if you completed the device code authentication
- Verify you're connected to the correct tenant

### "Failed to resolve user/group"

- The account may not have `Directory.Read.All` permission
- Some objects may have been deleted but are still referenced

### Web UI shows "No graph data available"

- Check that `conditional_access_graph.json` exists in `web/public/`
- Verify the JSON is valid (no syntax errors)
- Try refreshing the page

### PowerShell module not found

```powershell
# Ensure you're in the correct directory
Get-Location

# Import with full path
Import-Module /full/path/to/module/CAGapCollector/CAGapCollector.psd1
```

## Next Steps

- [Authentication Guide](authentication.md) - Learn about different auth methods
- [BloodHound Integration](bloodhound-integration.md) - Export to OpenGraph format
- [API Reference](api-reference.md) - Full command documentation

