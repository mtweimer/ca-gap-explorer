# BloodHound Integration Guide

This guide explains how to export CA Gap Analyzer data to BloodHound CE's OpenGraph format.

## Overview

BloodHound Community Edition (CE) uses the OpenGraph format for importing external data. The CA Gap Analyzer can export its graph data in this format, allowing you to:

- Visualize CA policy relationships in BloodHound
- Correlate CA policies with attack paths
- Identify high-risk principals with policy exclusions
- Combine with AD/Azure enumeration data

## OpenGraph Format

The OpenGraph format uses a specific JSON structure:

```json
{
  "meta": {
    "type": "azure",
    "version": 6,
    "collected": "2024-01-01T00:00:00Z"
  },
  "data": [
    {
      "kind": "AZUser",
      "id": "user-object-id",
      "props": {
        "displayname": "John Doe",
        "userprincipalname": "john@contoso.com"
      }
    },
    {
      "kind": "Relationship",
      "source": "policy-id",
      "target": "user-id",
      "type": "CAPolicyIncludes"
    }
  ]
}
```

## Exporting to OpenGraph

### Using PowerShell

```powershell
# After collecting CA policies
Export-OpenGraph -InputPath ./output/conditional_access_graph.json -OutputPath ./output/opengraph

# This creates:
# - output/opengraph/ca_policies.json
# - output/opengraph/ca_relationships.json
```

### Export Options

```powershell
# Export with specific node types only
Export-OpenGraph -InputPath ./output/conditional_access_graph.json `
                 -OutputPath ./output/opengraph `
                 -IncludeTypes User,Group,Role,ServicePrincipal

# Export excluding policies (just entities)
Export-OpenGraph -InputPath ./output/conditional_access_graph.json `
                 -OutputPath ./output/opengraph `
                 -ExcludeTypes Policy

# Combine with existing BloodHound data
Export-OpenGraph -InputPath ./output/conditional_access_graph.json `
                 -OutputPath ./output/opengraph `
                 -MergeWith ./existing-bloodhound-data.json
```

## Node Type Mappings

| CA Gap Type | OpenGraph Kind | Description |
|-------------|----------------|-------------|
| `user` | `AZUser` | Azure AD users |
| `group` | `AZGroup` | Azure AD groups |
| `role` | `AZRole` | Directory roles |
| `servicePrincipal` | `AZServicePrincipal` | Enterprise apps |
| `policy` | `CAPolicy` | CA policies (custom) |
| `namedLocation` | `CANamedLocation` | Named locations (custom) |

## Relationship Type Mappings

| CA Gap Relationship | OpenGraph Type | Description |
|--------------------|----------------|-------------|
| `include:user` | `CAPolicyIncludes` | Policy includes user |
| `exclude:user` | `CAPolicyExcludes` | Policy excludes user |
| `include:group` | `CAPolicyIncludesGroup` | Policy includes group |
| `exclude:group` | `CAPolicyExcludesGroup` | Policy excludes group |
| `include:role` | `CAPolicyIncludesRole` | Policy includes role |
| `exclude:role` | `CAPolicyExcludesRole` | Policy excludes role |

## Importing into BloodHound CE

### Step 1: Start BloodHound CE

```bash
# Using Docker
docker-compose -f bloodhound-docker-compose.yml up
```

### Step 2: Access the API

BloodHound CE provides an API for data ingestion:

```bash
# Upload the OpenGraph file
curl -X POST "http://localhost:8080/api/v2/ingest" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d @./output/opengraph/ca_policies.json
```

### Step 3: Verify Import

1. Open BloodHound CE web interface
2. Navigate to the graph view
3. Search for a CA policy by name
4. Verify relationships are visible

## Custom Queries

After importing, you can use these Cypher queries:

### Find Users Excluded from All Policies

```cypher
MATCH (u:AZUser)
WHERE NOT EXISTS {
  MATCH (p:CAPolicy)-[:CAPolicyIncludes]->(u)
}
RETURN u.displayname, u.userprincipalname
```

### Find Policies with High-Privilege Exclusions

```cypher
MATCH (p:CAPolicy)-[:CAPolicyExcludes]->(r:AZRole)
WHERE r.displayname CONTAINS "Admin"
RETURN p.displayname, r.displayname
```

### Find Attack Paths Through CA Exclusions

```cypher
MATCH path = (u:AZUser)-[:MemberOf*1..3]->(g:AZGroup)<-[:CAPolicyExcludes]-(p:CAPolicy)
WHERE p.grantcontrols CONTAINS "mfa"
RETURN path
```

### Identify MFA Bypass Opportunities

```cypher
MATCH (p:CAPolicy)-[:CAPolicyExcludes]->(target)
WHERE p.grantcontrols CONTAINS "mfa"
RETURN p.displayname AS Policy, 
       labels(target)[0] AS TargetType, 
       target.displayname AS ExcludedEntity
```

## Combining with Azure Enumeration

For comprehensive analysis, combine CA policy data with AzureHound enumeration:

```powershell
# 1. Run AzureHound for Azure enumeration
azurehound -o azure_data.json

# 2. Collect and export CA policies
Get-CAPolicies -OutputPath ./output
Export-OpenGraph -InputPath ./output/conditional_access_graph.json -OutputPath ./output/opengraph

# 3. Merge the data
Merge-OpenGraph -Primary ./azure_data.json `
                -Secondary ./output/opengraph/ca_policies.json `
                -OutputPath ./combined_data.json

# 4. Import combined data into BloodHound
```

## Troubleshooting

### "Unknown node kind"

BloodHound may not recognize custom kinds like `CAPolicy`. Options:
- Use the CA Gap Analyzer UI for policy visualization
- Extend BloodHound's schema (advanced)
- Map to existing kinds where possible

### "Relationship not found"

Ensure both source and target nodes exist:
```powershell
# Export with all related entities
Export-OpenGraph -InputPath ./output/conditional_access_graph.json `
                 -OutputPath ./output/opengraph `
                 -IncludeRelatedEntities
```

### Large File Issues

For large tenants:
```powershell
# Split into multiple files
Export-OpenGraph -InputPath ./output/conditional_access_graph.json `
                 -OutputPath ./output/opengraph `
                 -SplitByType

# This creates separate files:
# - opengraph/users.json
# - opengraph/groups.json
# - opengraph/policies.json
# - opengraph/relationships.json
```

## Best Practices

1. **Regular Updates**: Re-run collection periodically to keep data fresh
2. **Timestamp Data**: Include collection timestamps for audit trails
3. **Incremental Updates**: Only update changed policies when possible
4. **Secure Storage**: Treat exported data as sensitive
5. **Validation**: Verify imports with known policies

