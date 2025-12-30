# 📜 PowerShell Scripts

Collection and processing scripts for Conditional Access policy analysis.

## Scripts Overview

### 🔄 `run-all.ps1` (Recommended)
**Complete pipeline orchestrator** - runs all steps in sequence:
1. Collect Conditional Access policies
2. Collect directory objects (users, groups, roles, etc.)
3. Build graph JSON for visualization
4. Copy outputs to web/public directory

**Usage:**
```powershell
# With existing Graph connection (fastest)
./run-all.ps1 -SkipConnect

# With automatic device code authentication
./run-all.ps1

# Specify tenant
./run-all.ps1 -TenantId "your-tenant-id"
```

---

### 📥 `collect-conditional-access.ps1`
Collects Conditional Access policies and expands all assignments (users, groups, roles, applications, locations).

**Usage:**
```powershell
# Standalone with device code auth
./collect-conditional-access.ps1

# Reuse existing connection
./collect-conditional-access.ps1 -SkipConnect -SkipDisconnect

# Custom output directory
./collect-conditional-access.ps1 -OutputDir "/custom/path"
```

**Outputs:**
- `conditional_access_policies.json` - Full policy analysis
- `conditional_access_policies.csv` - Flat export

---

### 👥 `collect-directory-objects.ps1`
Collects directory entities referenced by policies (users, groups, roles, service principals, named locations).

**Usage:**
```powershell
# Must have active Graph connection
./collect-directory-objects.ps1 -SkipConnect
```

**Outputs:** All files in `../output/entities/`

---

### 🗺️ `build-graph-json.ps1`
Transforms policy JSON into graph structure (nodes + edges) for visualization.

**Usage:**
```powershell
# Default paths
./build-graph-json.ps1

# Custom paths
./build-graph-json.ps1 -InputJsonPath "./custom-policies.json" -OutputJsonPath "./custom-graph.json"
```

**Outputs:** `conditional_access_graph.json`

---

## Quick Reference

**First time setup:**
```powershell
# Install modules (if needed)
Install-Module Microsoft.Graph -Scope CurrentUser

# Connect
Connect-MgGraph -Scopes 'Policy.Read.All','Directory.Read.All'

# Run everything
./run-all.ps1 -SkipConnect
```

**Subsequent runs:**
```powershell
./run-all.ps1 -SkipConnect
```

See the main [README](../README.md) for detailed setup instructions.
