# Conditional Access Policy Examples

This document provides examples of how different CAP configurations are captured and visualized by this tool.

---

## Authentication Contexts

Authentication contexts allow you to require stepped-up authentication for sensitive resources.

### Example Policy Configuration

```json
{
  "displayName": "Require MFA for Sensitive SharePoint",
  "targetResources": {
    "applications": {
      "includeAuthenticationContextClassReferences": ["c1"]
    }
  },
  "grantControls": {
    "builtInControls": ["mfa"]
  }
}
```

### How It's Captured

**JSON Output (`conditional_access_policies.json`):**
```json
{
  "targetResources": {
    "applications": {
      "includeAuthenticationContextClassReferences": ["c1"]
    }
  }
}
```

**CSV Columns:**
- `IncludeAuthenticationContexts`: "c1"
- `ExcludeAuthenticationContexts`: ""

**Graph Visualization:**
- Node: "Auth Context: c1" (type: `authenticationContext`)
- Edge: Policy → Auth Context (relationship: `requires:authContext`)

---

## Insider Risk Levels

Insider risk integration with Microsoft Purview allows you to apply CAP based on user risk scores.

### Example Policy Configuration

```json
{
  "displayName": "Block Elevated Insider Risk Users",
  "conditions": {
    "insiderRiskLevels": {
      "configured": true,
      "levels": ["elevated"]
    }
  },
  "grantControls": {
    "builtInControls": ["block"]
  }
}
```

### How It's Captured

**JSON Output:**
```json
{
  "conditions": {
    "insiderRiskLevels": {
      "configured": true,
      "levels": ["elevated"]
    }
  }
}
```

**CSV Columns:**
- `InsiderRisk_Configured`: true
- `InsiderRiskLevels`: "elevated"

**Graph Visualization:**
- Node: "Insider Risk: elevated" (type: `condition`)
- Edge: Policy → Insider Risk Node (relationship: `condition:insiderRisk`)
- Policy node includes: `conditionsSummary: ["InsiderRisk: elevated"]`

---

## Authentication Flows

Restrict or allow specific authentication transfer methods.

### Example Policy Configuration

```json
{
  "displayName": "Block Device Code Flow",
  "conditions": {
    "authenticationFlows": {
      "configured": true,
      "transferMethods": ["deviceCodeFlow"]
    }
  },
  "grantControls": {
    "builtInControls": ["block"]
  }
}
```

### How It's Captured

**JSON Output:**
```json
{
  "conditions": {
    "authenticationFlows": {
      "configured": true,
      "transferMethods": ["deviceCodeFlow"]
    }
  }
}
```

**CSV Columns:**
- `AuthenticationFlows_Configured`: true
- `AuthenticationFlows`: "deviceCodeFlow"

**Graph Visualization:**
- Node: "Auth Flow: deviceCodeFlow" (type: `condition`)
- Edge: Policy → Auth Flow Node (relationship: `condition:authFlow`)

---

## Device Filter

Apply policies based on device properties using OData filter expressions.

### Example Policy Configuration

```json
{
  "displayName": "Require MFA for Non-Windows Devices",
  "conditions": {
    "deviceFilter": {
      "configured": true,
      "mode": "include",
      "rule": "device.operatingSystem ne \"Windows\""
    }
  },
  "grantControls": {
    "builtInControls": ["mfa"]
  }
}
```

### How It's Captured

**JSON Output:**
```json
{
  "conditions": {
    "deviceFilter": {
      "configured": true,
      "mode": "include",
      "rule": "device.operatingSystem ne \"Windows\""
    }
  }
}
```

**CSV Columns:**
- `DeviceFilter_Configured`: true
- `DeviceFilter_Mode`: "include"
- `DeviceFilter_Rule`: "device.operatingSystem ne \"Windows\""

**Graph Visualization:**
- Node: "Device Filter (include)" (type: `condition`)
- Node properties include full OData rule
- Edge: Policy → Device Filter Node (relationship: `condition:deviceFilter`)

---

## Session Controls

### Continuous Access Evaluation (CAE)

```json
{
  "displayName": "Strict CAE for Admins",
  "assignments": {
    "include": {
      "roles": ["62e90394-69f5-4237-9190-012177145e10"]
    }
  },
  "sessionControls": {
    "continuousAccessEvaluation": {
      "mode": "strictEnforcement"
    }
  }
}
```

**CSV Columns:**
- `Session_ContinuousAccessEvaluation`: "strictEnforcement"

**Policy Node:**
- `sessionControlsSummary`: ["CAE"]

### Token Protection

```json
{
  "displayName": "Token Protection for Sensitive Apps",
  "targetResources": {
    "applications": {
      "include": ["00000003-0000-0000-c000-000000000000"]
    }
  },
  "sessionControls": {
    "tokenProtection": {
      "isEnabled": true
    }
  }
}
```

**CSV Columns:**
- `Session_TokenProtection`: true

**Policy Node:**
- `sessionControlsSummary`: ["TokenProtection"]

### Secure Sign-in Session

```json
{
  "displayName": "Secure Sign-in for External Access",
  "conditions": {
    "locations": {
      "exclude": ["AllTrusted"]
    }
  },
  "sessionControls": {
    "secureSignInSession": {
      "isEnabled": true
    }
  }
}
```

**CSV Columns:**
- `Session_SecureSignIn`: true

**Policy Node:**
- `sessionControlsSummary`: ["SecureSignIn"]

---

## Complete Policy Example

Here's a comprehensive policy using multiple new features:

```json
{
  "displayName": "Comprehensive Protection for Finance Team",
  "assignments": {
    "include": {
      "groups": ["finance-group-id"],
      "guestOrExternalUsers": {
        "guestOrExternalUserTypes": ["b2bCollaborationGuest"],
        "externalTenants": {
          "membershipKind": "enumerated",
          "members": ["partner-tenant-id"]
        }
      }
    }
  },
  "targetResources": {
    "applications": {
      "include": ["00000003-0000-0ff1-ce00-000000000000"],
      "includeAuthenticationContextClassReferences": ["c3"]
    }
  },
  "conditions": {
    "insiderRiskLevels": {
      "configured": true,
      "levels": ["elevated"]
    },
    "deviceFilter": {
      "configured": true,
      "mode": "include",
      "rule": "device.isCompliant -eq true"
    },
    "locations": {
      "exclude": ["AllTrusted"]
    }
  },
  "grantControls": {
    "operator": "AND",
    "builtInControls": ["mfa", "compliantDevice"],
    "authenticationStrength": {
      "id": "strength-id",
      "displayName": "Phishing-resistant MFA"
    }
  },
  "sessionControls": {
    "tokenProtection": {
      "isEnabled": true
    },
    "continuousAccessEvaluation": {
      "mode": "strictEnforcement"
    },
    "signInFrequency": {
      "value": 1,
      "type": "hours"
    }
  }
}
```

### What Gets Captured

**Assignments:**
- Finance group with full member expansion
- Guest users (specific types)
- External tenant relationship

**Target Resources:**
- SharePoint Online (Office 365)
- Authentication context "c3" for high-value sites

**Conditions:**
- Insider risk: elevated level
- Device filter: compliant devices only
- Location: excludes trusted networks

**Grant Controls:**
- Require MFA AND compliant device
- Phishing-resistant authentication strength

**Session Controls:**
- Token protection enabled
- Strict CAE enforcement
- Sign-in frequency: 1 hour

**CSV Export Includes:**
- All assignment details with member counts
- `IncludeAuthenticationContexts`: "c3"
- `InsiderRiskLevels`: "elevated"
- `DeviceFilter_Rule`: "device.isCompliant -eq true"
- `Session_TokenProtection`: true
- `Session_ContinuousAccessEvaluation`: "strictEnforcement"

**Graph Visualization:**
- Policy node (central)
- Finance group node + all member nodes
- Guest/External user type node
- External tenant node
- SharePoint app node
- Auth Context node: "c3"
- Insider Risk condition node: "elevated"
- Device Filter condition node
- Multiple edges showing relationships and scopes

---

## Gap Detection Examples

The tool automatically identifies potential gaps:

### Missing MFA on Auth Context
```
⚠️ Policy "Sensitive Data Access" requires auth context c2 but does not require MFA
```

### Weak Controls for High-Value Contexts
```
⚠️ Policy targeting auth context c3 (high-value) does not require device compliance
```

### Insider Risk Without Strong Controls
```
⚠️ Policy blocking elevated insider risk users but allows access for moderate/minor
```

### Device Filter Without Platform Restriction
```
⚠️ Policy uses device filter but does not restrict device platforms
```

---

## JSON Structure Reference

### Full Policy Structure (Output)

```json
{
  "id": "policy-guid",
  "displayName": "Policy Name",
  "state": "enabled",
  "assignments": {
    "include": {
      "users": { "keywords": [], "entities": [] },
      "groups": { "keywords": [], "entities": [] },
      "roles": { "keywords": [], "entities": [] },
      "servicePrincipals": { "keywords": [], "entities": [] }
    },
    "exclude": { /* same structure */ }
  },
  "targetResources": {
    "applications": {
      "include": { "keywords": [], "entities": [] },
      "exclude": { "keywords": [], "entities": [] },
      "includeUserActions": [],
      "includeAuthenticationContextClassReferences": []
    }
  },
  "conditions": {
    "clientAppTypes": [],
    "platforms": { "include": [], "exclude": [] },
    "deviceStates": { "include": [], "exclude": [], "filter": {} },
    "deviceFilter": {
      "configured": true,
      "mode": "include|exclude",
      "rule": "OData expression"
    },
    "signInRiskLevels": [],
    "userRiskLevels": [],
    "insiderRiskLevels": {
      "configured": true,
      "levels": ["minor", "moderate", "elevated"]
    },
    "authenticationFlows": {
      "configured": true,
      "transferMethods": ["deviceCodeFlow", "authenticationTransfer"]
    },
    "locations": {
      "include": { "keywords": [], "entities": [] },
      "exclude": { "keywords": [], "entities": [] }
    },
    "users": {
      "includeGuestsOrExternalUsers": {},
      "excludeGuestsOrExternalUsers": {}
    }
  },
  "accessControls": {
    "grant": {
      "operator": "AND|OR",
      "builtInControls": [],
      "authenticationStrength": {}
    },
    "session": {
      "signInFrequency": {},
      "persistentBrowser": {},
      "continuousAccessEvaluation": { "mode": "..." },
      "tokenProtection": { "isEnabled": true },
      "secureSignInSession": { "isEnabled": true },
      "globalSecureAccessSecurityProfile": {},
      "cloudAppSecurity": {},
      "applicationEnforcedRestrictions": {}
    }
  }
}
```

---

## Querying Examples

### PowerShell: Find Policies with Insider Risk

```powershell
$data = Get-Content output/conditional_access_policies.json | ConvertFrom-Json
$insiderRiskPolicies = $data.policies | Where-Object { 
    $_.conditions.insiderRiskLevels.configured -eq $true 
}
```

### PowerShell: Find Policies Using Auth Contexts

```powershell
$authContextPolicies = $data.policies | Where-Object {
    $_.targetResources.applications.includeAuthenticationContextClassReferences.Count -gt 0
}
```

### PowerShell: Find Policies with Token Protection

```powershell
$tokenProtectionPolicies = $data.policies | Where-Object {
    $_.accessControls.session.tokenProtection.isEnabled -eq $true
}
```

---

## Best Practices Validation

Use these examples to validate your CAP implementation:

1. **Authentication Contexts** - Should always require MFA or stronger
2. **Insider Risk** - Elevated risk should trigger block or very strong controls
3. **Device Filters** - Should align with platform restrictions
4. **Token Protection** - Should be enabled for all admin/privileged access
5. **CAE** - Should be enforced for high-value resources

The tool's gap detection will automatically flag many of these issues.

