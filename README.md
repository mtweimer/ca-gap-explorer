# Conditional Access Gap Analyzer

[![CI](https://github.com/hoplite-industries/conditional-access-gap-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/hoplite-industries/conditional-access-gap-analyzer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A comprehensive tool for analyzing Microsoft Entra ID (Azure AD) Conditional Access Policies to identify security gaps, visualize policy relationships, and understand coverage across your organization.  This tool is meant to be a playground where you can analyze the control layers that are implemented via conditional access.  You can stack and analyze different policies on top of one another to see what gaps exist across control layers. 

## Features

- **Policy Collection**: Automated collection of Conditional Access Policies via Microsoft Graph API
- **Gap Analysis**: Identify coverage gaps, risky exclusions, and missing controls
- **Graph Visualization**: Interactive D3.js-based graph showing policy relationships
- **Deep Policy Exploration**: Drill down into policies with expandable group memberships and role assignments
- **Exposure Matrix**: Cross-policy analysis to find users/apps not covered by policies
- **BloodHound Integration**: Export to OpenGraph format for BloodHound CE visualization
- **Cross-Platform**: PowerShell module works on Windows, macOS, and Linux
- **Docker Support**: Containerized deployment for easy setup

## Quick Start

### Prerequisites

- PowerShell 7.x or Windows PowerShell 5.1
- Microsoft Graph PowerShell SDK
- Node.js 18+ (for web UI development)
- Entra ID permissions: `Policy.Read.All`, `Directory.Read.All`, `Group.Read.All`, `Application.Read.All`, `RoleManagement.Read.Directory`

### Installation

```bash
# Clone the repository
git clone https://github.com/hoplite-industries/conditional-access-gap-analyzer.git
cd conditional-access-gap-analyzer

# Install PowerShell module
Import-Module ./module/CAGapCollector/CAGapCollector.psd1

# Install web dependencies
cd web && npm install
```

### Collect Data

```powershell
# Connect and collect CA policies
Connect-CAGapGraph -UseDeviceCode
Get-CAPolicies -OutputPath ./output
Export-CAGraph -InputPath ./output/conditional_access_policies.json -OutputPath ./output

# Copy results to web UI
Copy-Item ./output/conditional_access_*.json ./web/public/
Copy-Item -Recurse -Force ./output/entities/ ./web/public/entities/

# Disconnect when done
Disconnect-CAGapGraph
```

> **Tip:** Use `./scripts/run-all.ps1` to run the complete pipeline, which handles all collection, graph building, and file copying automatically.

### View Results

```bash
# Start the web UI
cd web
npm run dev

# Open http://localhost:5173 in your browser
```

### Clearing Old Results and Re-running Collection

To refresh your data with a new collection, clear the output directories and re-run:

```bash
# Clear all output data
rm -rf output/*.json output/*.csv output/entities/
rm -rf web/public/conditional_access_*.json web/public/entities/
```

**Option 1: Use the pipeline script (recommended)**

```powershell
./scripts/run-all.ps1 -SkipConnect   # If already connected to MS Graph
# OR
./scripts/run-all.ps1                 # To connect via device code flow
```

The `run-all.ps1` script handles collection, graph building, and copying files to `web/public/` automatically.

**Option 2: Run individual commands**

```powershell
Get-CAPolicies -OutputPath ./output
Export-CAGraph -InputPath ./output/conditional_access_policies.json -OutputPath ./output

# Don't forget to copy results to web/public/
Copy-Item ./output/conditional_access_*.json ./web/public/
Copy-Item -Recurse -Force ./output/entities/ ./web/public/entities/
```

After either option, refresh your browser to see the new data.

## Docker Quick Start

```bash
# Run the complete pipeline
docker-compose up

# Or run collection only
docker-compose --profile collector up

# Or serve existing data
docker-compose --profile web up
```

## Documentation

For detailed authentication options including app registration, service principals, and managed identity, see [Authentication Guide](docs/authentication.md).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     CA Gap Analyzer                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │  PowerShell  │    │    Graph     │    │   React UI   │       │
│  │   Module     │───▶│    JSON      │───▶│  Dashboard   │       │
│  │              │    │              │    │              │       │
│  └──────┬───────┘    └──────────────┘    └──────────────┘       │
│         │                    │                                  │
│         ▼                    ▼                                  │
│  ┌──────────────┐    ┌──────────────┐                           │
│  │  MS Graph    │    │  OpenGraph   │                           │
│  │    API       │    │   Export     │                           │
│  └──────────────┘    └──────────────┘                           │
│                              │                                  │
│                              ▼                                  │
│                      ┌──────────────┐                           │
│                      │  BloodHound  │                           │
│                      │     CE       │                           │
│                      └──────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

## Supported Conditions and Controls

### User Conditions
- Users, Groups, Directory Roles
- Guest/External Users
- Service Principals (Workload Identities)

### Application Conditions
- Cloud Applications
- User Actions
- Authentication Contexts

### Other Conditions
- User Risk Levels
- Sign-in Risk Levels
- Insider Risk Levels
- Device Platforms
- Locations (Named Locations, Countries)
- Client Applications
- Device Filters
- Authentication Flows

### Grant Controls
- Block Access
- Require MFA
- Require Compliant Device
- Require Hybrid Azure AD Join
- Require Approved Client App
- Require App Protection Policy
- Require Password Change
- Terms of Use
- Authentication Strength

### Session Controls
- Sign-in Frequency
- Persistent Browser Session
- Continuous Access Evaluation (CAE)
- Cloud App Security
- Token Protection
- Global Secure Access

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

```bash
# Fork and clone the repository
git clone https://github.com/YOUR_USERNAME/conditional-access-gap-analyzer.git

# Install dependencies
cd web && npm install

# Start development server with hot reload
npm run dev

# Run linting
npm run lint

# Build for production
npm run build
```

## Security

This tool requires read-only access to your Azure AD tenant. It does not modify any policies or settings.

**Required Permissions:**
- `Policy.Read.All` - Read Conditional Access policies
- `Directory.Read.All` - Read directory objects (users, groups)
- `Group.Read.All` - Read group memberships
- `Application.Read.All` - Read application registrations
- `RoleManagement.Read.Directory` - Read role assignments

For security concerns, please see [SECURITY.md](SECURITY.md) or contact the maintainers directly.

## Roadmap

- [ ] Export to CSV/Excel reports
- [ ] Policy comparison between tenants
- [ ] What-if analysis for policy changes
- [ ] Integration with Microsoft Sentinel
- [ ] Automated gap remediation suggestions
- [ ] Multi-tenant support

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Microsoft Graph PowerShell SDK](https://github.com/microsoftgraph/msgraph-sdk-powershell)
- [BloodHound CE](https://github.com/SpecterOps/BloodHound) for OpenGraph inspiration
- [D3.js](https://d3js.org/) and [Dagre](https://github.com/dagrejs/dagre) for graph visualization
- [Vite](https://vitejs.dev/) and [React](https://react.dev/) for the web UI

---

**Disclaimer:** This tool is provided as-is for security analysis purposes. Always verify findings manually and test changes in a non-production environment first.
