FROM mcr.microsoft.com/powershell:lts-ubuntu-22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV POWERSHELL_TELEMETRY_OPTOUT=1

WORKDIR /workspace

# Install dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       curl \
       unzip \
       ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Microsoft Graph PowerShell modules
RUN pwsh -NoLogo -NoProfile -Command \
    "Install-Module Microsoft.Graph -Scope AllUsers -Force -AllowClobber; \
     Install-Module Microsoft.Graph.Identity.SignIns -Scope AllUsers -Force -AllowClobber; \
     Install-Module Microsoft.Graph.Identity.DirectoryManagement -Scope AllUsers -Force -AllowClobber; \
     Install-Module Microsoft.Graph.Authentication -Scope AllUsers -Force -AllowClobber"

# Copy scripts into the container
COPY scripts /workspace/scripts

# Create output directory
RUN mkdir -p /workspace/output /workspace/web/public /workspace/web/public/entities

# Default command runs the complete pipeline
# Override with -SkipConnect if reusing an existing Graph connection
CMD ["pwsh", "-NoLogo", "-NoProfile", "-File", "/workspace/scripts/run-all.ps1"]
