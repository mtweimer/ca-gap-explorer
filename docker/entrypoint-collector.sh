#!/bin/bash
set -e

# CA Gap Collector Entrypoint Script

echo "=========================================="
echo "  CA Gap Collector"
echo "=========================================="

# Import the module
pwsh -NoLogo -NoProfile -Command "Import-Module /workspace/module/CAGapCollector/CAGapCollector.psd1 -Force"

case "$1" in
    collect)
        echo "Starting collection..."
        
        # Build connection parameters
        CONNECT_PARAMS=""
        
        if [ -n "$CA_GAP_CLIENT_ID" ] && [ -n "$CA_GAP_CLIENT_SECRET" ] && [ -n "$CA_GAP_TENANT_ID" ]; then
            echo "Using client credentials authentication..."
            pwsh -NoLogo -NoProfile -Command "
                Import-Module /workspace/module/CAGapCollector/CAGapCollector.psd1 -Force
                Connect-CAGapGraph -ClientId '$CA_GAP_CLIENT_ID' -ClientSecret '$CA_GAP_CLIENT_SECRET' -TenantId '$CA_GAP_TENANT_ID'
                Get-CAPolicies -OutputPath /workspace/output -Verbose
                Export-CAGraph -InputPath /workspace/output/conditional_access_policies.json -OutputPath /workspace/output -Format Both
                Disconnect-CAGapGraph
            "
        elif [ -n "$CA_GAP_USE_MANAGED_IDENTITY" ]; then
            echo "Using managed identity authentication..."
            pwsh -NoLogo -NoProfile -Command "
                Import-Module /workspace/module/CAGapCollector/CAGapCollector.psd1 -Force
                Connect-CAGapGraph -ManagedIdentity
                Get-CAPolicies -OutputPath /workspace/output -Verbose
                Export-CAGraph -InputPath /workspace/output/conditional_access_policies.json -OutputPath /workspace/output -Format Both
                Disconnect-CAGapGraph
            "
        else
            echo "Using device code authentication..."
            echo "Watch for the device code prompt below..."
            pwsh -NoLogo -NoProfile -Command "
                Import-Module /workspace/module/CAGapCollector/CAGapCollector.psd1 -Force
                Connect-CAGapGraph -UseDeviceCode
                Get-CAPolicies -OutputPath /workspace/output -Verbose
                Export-CAGraph -InputPath /workspace/output/conditional_access_policies.json -OutputPath /workspace/output -Format Both
                Disconnect-CAGapGraph
            "
        fi
        
        echo ""
        echo "Collection complete!"
        echo "Output files are in /workspace/output"
        ;;
        
    export)
        echo "Exporting graph data..."
        pwsh -NoLogo -NoProfile -Command "
            Import-Module /workspace/module/CAGapCollector/CAGapCollector.psd1 -Force
            Export-CAGraph -InputPath /workspace/output/conditional_access_policies.json -OutputPath /workspace/output -Format Both
        "
        echo "Export complete!"
        ;;
        
    shell)
        echo "Starting PowerShell shell..."
        exec pwsh -NoLogo -NoProfile
        ;;
        
    *)
        echo "Usage: $0 {collect|export|shell}"
        echo ""
        echo "Commands:"
        echo "  collect  - Connect to Graph and collect CA policies"
        echo "  export   - Export existing data to graph format"
        echo "  shell    - Start an interactive PowerShell shell"
        echo ""
        echo "Environment variables:"
        echo "  CA_GAP_CLIENT_ID      - App registration client ID"
        echo "  CA_GAP_CLIENT_SECRET  - App registration client secret"
        echo "  CA_GAP_TENANT_ID      - Azure AD tenant ID"
        echo "  CA_GAP_USE_MANAGED_IDENTITY - Use managed identity (set to any value)"
        exit 1
        ;;
esac

