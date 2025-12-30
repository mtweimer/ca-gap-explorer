# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- OpenGraph/BloodHound export format for graph data portability
- PolicyExplorer component for deep-dive policy analysis
- ExposureMatrix component for cross-policy gap visualization
- GroupMembershipTree component for hierarchical group exploration
- ConditionAnalyzer component for condition-based analysis
- PowerShell module structure (CAGapCollector)
- Multiple authentication methods support
- Docker compose profiles for different deployment scenarios
- Comprehensive documentation suite

### Changed
- Restructured repository for open-source release
- Enhanced UI with expandable policy analysis sections
- Improved graph visualization with better node organization

### Fixed
- Various UI rendering improvements
- Edge case handling in policy relationship parsing

## [0.1.0] - 2024-12-29

### Added
- Initial release
- PowerShell collection scripts for Conditional Access Policies
- Graph JSON generation with nodes and edges
- React web UI with:
  - Gap analysis tab
  - Graph visualization tab
  - Table view tab
  - Objects browser tab
- Policy filtering by state and grant controls
- Policy details modal
- Group membership expansion
- Named location support
- Docker support for collection and web serving

### Technical Details
- Microsoft Graph API integration for data collection
- D3.js/Dagre-based graph layout
- TypeScript/React frontend
- Vite build system

