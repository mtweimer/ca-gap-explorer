# Authentication Guide

This guide covers the different authentication methods supported by the CA Gap Analyzer.

## Authentication Methods

### 1. Device Code Flow (Recommended)

Best for: Interactive use, first-time setup, testing

```powershell
Connect-CAGapGraph -UseDeviceCode
```

**Process:**
1. A device code is displayed
2. Open https://microsoft.com/devicelogin in your browser
3. Enter the code and sign in
4. Approve the permissions
5. Return to PowerShell - connection is established

**Pros:**
- Works on headless systems
- No app registration required
- Uses your user context

**Cons:**
- Requires user interaction
- Session expires (typically 1 hour)

### 2. Interactive Browser

Best for: Desktop use with a browser

```powershell
Connect-CAGapGraph -Interactive
```

**Process:**
1. A browser window opens
2. Sign in and approve permissions
3. Browser closes automatically
4. Connection is established

**Pros:**
- Familiar sign-in experience
- No code to copy/paste

**Cons:**
- Requires a GUI environment
- Not suitable for servers

### 3. Client Credentials (Service Principal)

Best for: Automation, scheduled runs, CI/CD

```powershell
Connect-CAGapGraph -ClientId "app-id" -ClientSecret "secret" -TenantId "tenant-id"
```

**Setup Required:**
1. Create an App Registration in Azure AD
2. Add API permissions (see below)
3. Create a client secret
4. Grant admin consent

**Pros:**
- No user interaction needed
- Suitable for automation
- Long-lived credentials

**Cons:**
- Requires app registration setup
- Secret management needed

### 4. Certificate-Based

Best for: High-security automation

```powershell
Connect-CAGapGraph -ClientId "app-id" -CertificateThumbprint "thumbprint" -TenantId "tenant-id"
```

**Pros:**
- More secure than client secrets
- Certificates can be stored in key vaults

**Cons:**
- More complex setup
- Certificate management overhead

### 5. Managed Identity

Best for: Azure-hosted scenarios (VMs, Functions, etc.)

```powershell
Connect-CAGapGraph -ManagedIdentity
```

**Pros:**
- No credentials in code
- Automatic token refresh
- Azure-managed security

**Cons:**
- Only works in Azure environments

## App Registration Setup

### Step 1: Create App Registration

1. Go to Azure Portal > Azure Active Directory > App registrations
2. Click "New registration"
3. Name: "CA Gap Analyzer" (or your preference)
4. Supported account types: "Single tenant"
5. Click "Register"

### Step 2: Configure API Permissions

1. Go to "API permissions"
2. Click "Add a permission"
3. Select "Microsoft Graph"
4. Choose "Application permissions" (for automation) or "Delegated permissions"
5. Add these permissions:

| Permission | Type | Description |
|------------|------|-------------|
| `Policy.Read.All` | Application | Read all policies |
| `Directory.Read.All` | Application | Read directory data |
| `Group.Read.All` | Application | Read all groups |
| `Application.Read.All` | Application | Read all apps |
| `RoleManagement.Read.Directory` | Application | Read role data |

6. Click "Grant admin consent"

### Step 3: Create Client Secret (for client credentials)

1. Go to "Certificates & secrets"
2. Click "New client secret"
3. Set description and expiry
4. Copy the secret value immediately (it won't be shown again)

### Step 4: Note Your IDs

Record these values for connection:
- Application (client) ID: Found on the Overview page
- Directory (tenant) ID: Found on the Overview page
- Client Secret: From step 3

## Environment Variables

For automation, you can use environment variables:

```bash
# Set environment variables
export CA_GAP_CLIENT_ID="your-app-id"
export CA_GAP_CLIENT_SECRET="your-secret"
export CA_GAP_TENANT_ID="your-tenant-id"
```

```powershell
# PowerShell will pick these up automatically
Connect-CAGapGraph -UseEnvironmentVariables
```

## Docker Authentication

When using Docker, pass credentials via environment variables:

```yaml
# docker-compose.override.yml
services:
  collector:
    environment:
      - CA_GAP_CLIENT_ID=${CA_GAP_CLIENT_ID}
      - CA_GAP_CLIENT_SECRET=${CA_GAP_CLIENT_SECRET}
      - CA_GAP_TENANT_ID=${CA_GAP_TENANT_ID}
```

Or use a `.env` file:

```env
# .env
CA_GAP_CLIENT_ID=your-app-id
CA_GAP_CLIENT_SECRET=your-secret
CA_GAP_TENANT_ID=your-tenant-id
```

## Security Best Practices

1. **Use least privilege**: Only grant required permissions
2. **Rotate secrets**: Set short expiry on client secrets
3. **Use certificates**: Prefer certificates over secrets for production
4. **Audit access**: Monitor app sign-in logs
5. **Use Managed Identity**: When running in Azure
6. **Secure storage**: Never commit secrets to source control

## Troubleshooting

### "Insufficient privileges"

- Ensure admin consent was granted
- Verify all required permissions are added
- Check if Conditional Access policies block the app

### "Invalid client secret"

- Secrets may have expired
- Ensure you're using the correct secret value
- Check for extra whitespace when copying

### "Tenant not found"

- Verify the tenant ID is correct
- Ensure the app registration is in the correct tenant

### "User account is disabled"

- The user account may be disabled
- Check for Conditional Access policies blocking access

