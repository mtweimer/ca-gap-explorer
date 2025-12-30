# Docker Configuration

This directory contains Docker configurations for the CA Gap Analyzer.

## Quick Start

```bash
# Navigate to docker directory
cd docker

# Copy environment template
cp env.example .env

# Edit .env with your values (optional, for automated auth)
# Leave blank to use interactive device code authentication

# Run collection and web UI
docker-compose --profile full up
```

## Profiles

| Profile | Description | Command |
|---------|-------------|---------|
| `collector` | Run data collection only | `docker-compose --profile collector up` |
| `web` | Run web UI only (use existing data) | `docker-compose --profile web up` |
| `full` | Run complete pipeline | `docker-compose --profile full up` |
| `dev` | Development mode with hot reload | `docker-compose --profile dev up` |
| `shell` | Interactive PowerShell shell | `docker-compose --profile shell up` |

## Authentication Methods

### Device Code (Interactive)

Leave the `CA_GAP_*` environment variables empty. When the collector starts, it will display a device code that you enter at https://microsoft.com/devicelogin.

```bash
docker-compose --profile collector up
# Watch the logs for the device code prompt
```

### Client Credentials (Automated)

Set the following in your `.env` file:

```env
CA_GAP_CLIENT_ID=your-app-id
CA_GAP_CLIENT_SECRET=your-client-secret
CA_GAP_TENANT_ID=your-tenant-id
```

### Managed Identity (Azure-hosted)

Set `CA_GAP_USE_MANAGED_IDENTITY` to any value:

```env
CA_GAP_USE_MANAGED_IDENTITY=true
```

## Volume Mounts

- `/workspace/output` - Output directory for collected data
- `/workspace/module/CAGapCollector` - PowerShell module (read-only)

## Ports

| Service | Port | Description |
|---------|------|-------------|
| web | 8080 (configurable via `WEB_PORT`) | Web UI |
| web-dev | 5173 | Development server with hot reload |

## Building Images

```bash
# Build collector image
docker build -f Dockerfile.collector -t ca-gap-collector:latest ..

# Build web image
docker build -f Dockerfile.web -t ca-gap-web:latest ..
```

## Troubleshooting

### "No policies returned"

1. Ensure your account has `Policy.Read.All` permission
2. Verify you completed the device code authentication
3. Check if you're connected to the correct tenant

### "Connection timed out during device code"

The device code flow has a timeout. Ensure you complete the authentication promptly.

### Web UI shows no data

1. Verify the output files exist in the `output` directory
2. Check that the volume mounts are correct
3. Ensure the collector completed successfully before starting web

### Permission denied on output directory

```bash
# Fix permissions
chmod 777 output
# Or run with appropriate user
docker-compose run --user $(id -u):$(id -g) collector collect
```

