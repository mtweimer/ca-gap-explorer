# Contributing to Conditional Access Gap Analyzer

Thank you for your interest in contributing to the Conditional Access Gap Analyzer! This document provides guidelines and information for contributors.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment. Please be kind and constructive in all interactions.

## How to Contribute

### Reporting Issues

Before creating an issue, please:

1. Search existing issues to avoid duplicates
2. Use the appropriate issue template
3. Provide as much detail as possible:
   - Steps to reproduce the problem
   - Expected vs actual behavior
   - Environment details (OS, PowerShell version, browser)
   - Relevant logs or error messages

### Suggesting Features

We welcome feature suggestions! Please:

1. Check if the feature has already been requested
2. Use the feature request template
3. Explain the use case and benefits
4. Consider implementation complexity

### Pull Requests

#### Before You Start

1. Open an issue to discuss significant changes
2. Fork the repository
3. Create a feature branch from `main`

#### Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/conditional-access-gap-analyzer.git
cd conditional-access-gap-analyzer

# Install web dependencies
cd web
npm install

# Start development server
npm run dev
```

#### Code Standards

**PowerShell:**
- Follow [PowerShell Best Practices](https://docs.microsoft.com/en-us/powershell/scripting/developer/cmdlet/cmdlet-development-guidelines)
- Use approved verbs for function names
- Include comment-based help for public functions
- Use `Set-StrictMode -Version Latest`

**TypeScript/React:**
- Use TypeScript strict mode
- Follow existing code style
- Use functional components with hooks
- Write meaningful component and variable names

**General:**
- Write clear commit messages
- Keep changes focused and atomic
- Add tests for new functionality
- Update documentation as needed

#### Pull Request Process

1. Ensure all tests pass
2. Update the CHANGELOG.md
3. Fill out the PR template completely
4. Request review from maintainers
5. Address review feedback promptly

### Testing

**PowerShell Scripts:**
```powershell
# Run with test tenant or sample data
./scripts/run-all.ps1 -SkipConnect
```

**Web Application:**
```bash
cd web
npm run lint
npm run build
```

## Project Structure

```
conditional-access-gap-analyzer/
├── module/              # PowerShell module
│   └── CAGapCollector/
├── web/                 # React web application
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── utils/       # Utility functions
│   │   └── types/       # TypeScript types
│   └── public/          # Static assets
├── docker/              # Docker configurations
├── docs/                # Documentation
└── examples/            # Sample data and configs
```

## Getting Help

- Check the [documentation](docs/)
- Search existing issues
- Open a new issue with the "question" label

## Recognition

Contributors will be recognized in the project README and releases. Thank you for helping improve this project!

