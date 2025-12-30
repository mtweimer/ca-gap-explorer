# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **Do NOT** create a public GitHub issue for security vulnerabilities
2. Email security concerns to: [security@example.com] (update with actual contact)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- Acknowledgment within 48 hours
- Regular updates on the status
- Credit in the security advisory (if desired)

### Scope

This security policy applies to:
- The PowerShell collection module
- The web UI application
- Docker configurations
- Documentation (for sensitive information exposure)

### Out of Scope

- Vulnerabilities in Microsoft Graph API
- Issues in third-party dependencies (report upstream)
- Social engineering attacks

## Security Considerations

### Data Sensitivity

This tool collects and displays:
- Conditional Access policy configurations
- User and group identities
- Application registrations
- Named locations (IP ranges, countries)

**Treat all output files as sensitive.**

### Best Practices

1. **Secure Storage**: Store output files securely; do not commit to public repositories
2. **Access Control**: Limit access to the tool and its outputs
3. **Regular Cleanup**: Delete output files after analysis
4. **Audit Logging**: Enable audit logging in your Azure AD tenant
5. **Least Privilege**: Use minimum required permissions

### Permissions Required

The tool requires read-only permissions:
- `Policy.Read.All`
- `Directory.Read.All`
- `Group.Read.All`
- `Application.Read.All`
- `RoleManagement.Read.Directory`

**The tool does NOT require and should NOT be granted write permissions.**

## Secure Development

### For Contributors

- Never commit secrets or credentials
- Use environment variables for sensitive configuration
- Follow secure coding practices
- Review dependencies for vulnerabilities regularly
- Sign commits when possible

### Dependency Management

- Dependencies are reviewed before inclusion
- Automated security scanning via GitHub Dependabot
- Regular dependency updates

