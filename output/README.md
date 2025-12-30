# Output Directory

This directory contains generated output files from Conditional Access policy analysis runs.

## ⚠️ Important

**All files in this directory contain tenant-specific data and should NOT be committed to version control.**

The `.gitignore` file automatically excludes:
- `*.json` files (policies, entities, graphs)
- `*.csv` files (policy exports)
- `checkpoint_*.json` files

## Generated Files

After running the collection scripts, you'll find:

### Policy Data
- `conditional_access_policies.json` - Complete policy analysis with expanded assignments
- `conditional_access_policies.csv` - Flat CSV export for spreadsheet tools
- `conditional_access_graph.json` - Graph structure for visualization

### Entity Data (entities/ subdirectory)
- `users.json` - All tenant users
- `groups.json` - All groups
- `roles.json` - Directory roles
- `service_principals.json` - Service principals and applications
- `named_locations.json` - Named locations (IP ranges, countries)
- `applications.json` - Application registrations
- `counts.json` - Summary counts

### Temporary Files
- `checkpoint_*.json` - Progress checkpoints (created during long-running collections)
- `raw_*.json` - Raw API responses (for debugging)

## Data Freshness

These files represent a point-in-time snapshot. For updated analysis:

```powershell
./scripts/run-all.ps1 -SkipConnect
```

Files are automatically copied to `../web/public/` for visualization.

