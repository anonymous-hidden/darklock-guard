# Contributing to Darklock Guard

First off, thank you for considering contributing to Darklock Guard! It's people like you that make Darklock Guard such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the issue list as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

* **Use a clear and descriptive title**
* **Describe the exact steps to reproduce the problem**
* **Provide specific examples to demonstrate the steps**
* **Describe the behavior you observed after following the steps**
* **Explain which behavior you expected to see instead and why**
* **Include screenshots if possible**
* **Include your environment details** (OS, version, etc.)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

* **Use a clear and descriptive title**
* **Provide a step-by-step description of the suggested enhancement**
* **Provide specific examples to demonstrate the steps**
* **Describe the current behavior and explain the behavior you expected to see instead**
* **Explain why this enhancement would be useful**

### Pull Requests

* Fill in the required template
* Do not include issue numbers in the PR title
* Follow the Rust and TypeScript styleguides
* Include thoughtful comments in your code
* End all files with a newline
* Avoid platform-dependent code

## Development Setup

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Platform-specific dependencies (see README.md)

### Setup Steps

```bash
# Clone your fork
git clone https://github.com/your-username/darklock-guard.git
cd darklock-guard

# Install dependencies
cd desktop
npm install

# Run in development mode
npm run tauri
```

## Styleguides

### Git Commit Messages

* Use the present tense ("Add feature" not "Added feature")
* Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
* Limit the first line to 72 characters or less
* Reference issues and pull requests liberally after the first line

### Rust Styleguide

* Follow the official [Rust Style Guide](https://rust-lang.github.io/api-guidelines/)
* Run `cargo fmt` before committing
* Run `cargo clippy` and address warnings
* Write documentation for public APIs

### TypeScript Styleguide

* Use TypeScript strict mode
* Prefer functional components with hooks
* Use meaningful variable names
* Document complex functions with JSDoc comments
* Run `npm run lint` before committing

### Testing

* Write tests for new features
* Ensure all tests pass before submitting PR
* Aim for meaningful test coverage

## Project Structure

```
darklock-guard/
├── desktop/              # Tauri desktop application
│   ├── src/             # React frontend
│   └── src-tauri/       # Rust backend
├── crates/              # Shared Rust crates
│   ├── guard-core/      # Core security logic
│   ├── guard-service/   # Background service
│   └── updater-helper/  # Update management
└── docs/                # Documentation
```

## Questions?

Feel free to open an issue with your question or reach out to the maintainers.

Thank you for contributing! 🎉
