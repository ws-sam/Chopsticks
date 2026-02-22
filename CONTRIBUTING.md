# Contributing to Chopsticks

First off — **thank you** for taking the time to contribute! 🎉

Whether you're fixing a bug, adding a feature, improving documentation, or reporting an issue, every contribution makes Chopsticks better for everyone.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Commit Conventions](#commit-conventions)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Code Standards](#code-standards)
- [Reporting Issues](#reporting-issues)
- [Feature Requests](#feature-requests)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold these standards. Please report unacceptable behavior to the maintainers.

---

## Getting Started

### 1. Fork & clone

```bash
git clone https://github.com/YOUR_USERNAME/Chopsticks.git
cd Chopsticks
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
# Fill in: DISCORD_TOKEN, CLIENT_ID, BOT_OWNER_IDS, DATABASE_URL, REDIS_URL
```

### 4. Run migrations

```bash
npm run migrate
```

### 5. Deploy slash commands to your test guild

```bash
node scripts/deployCommands.js
```

### 6. Start the bot

```bash
npm run bot
```

> 💡 See [QUICKSTART.md](QUICKSTART.md) for a full local setup walkthrough including PostgreSQL, Redis, and Lavalink.

---

## Development Workflow

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   # or
   git checkout -b fix/the-bug
   ```

2. **Make your changes** — keep them focused on a single concern.

3. **Test your changes:**
   ```bash
   npm test
   ```

4. **Commit** using [conventional commits](#commit-conventions).

5. **Push** your branch and **open a Pull Request** against `main`.

---

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/) for clear, machine-readable history:

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

**Types:**

| Type | When to use |
|------|-------------|
| `feat` | New feature or command |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `chore` | Build, CI, dependency updates |

**Examples:**
```
feat(pools): add /pools ally subcommand
fix(music): skip button not responding after queue end
docs: update QUICKSTART for Docker setup
```

---

## Pull Request Guidelines

- **Keep PRs small and focused** — one concern per PR makes review fast
- **Write a clear description** — explain *what* changed and *why*
- **Link related issues** — use `Closes #123` in the PR body
- **Don't reformat unrelated code** — minimizes noise in diffs
- **All tests must pass** — run `npm test` before submitting
- **No secrets in code** — use `.env` variables for all credentials

### PR title format

Follow the same [Conventional Commits](#commit-conventions) format:
```
feat(economy): add /gamble command with server toggle
```

---

## Code Standards

### General

- Prefer **explicit, defensive error handling** — wrap DB calls in try/catch
- All slash command handlers must call `deferReply` before any `await` that could take time
- Never log or display a plaintext bot token — use `maskToken()` for display
- Keep slash commands backwards compatible unless the change is documented in CHANGELOG

### Style

- ES Modules (`import`/`export`) throughout — no `require()`
- 2-space indentation
- Single quotes for strings
- Trailing commas in multi-line arrays/objects
- No unused variables (`const x = await ...` must be used)

### Slash commands

- Every handler must reply even on error — use the top-level try/catch in `execute()`
- Validate all user input before touching the database
- Use `flags: MessageFlags.Ephemeral` for sensitive responses

---

## Reporting Issues

Use [GitHub Issues](https://github.com/wokspec/Chopsticks/issues) with the appropriate template:

**Bug reports should include:**
- Steps to reproduce
- Expected vs. actual behavior
- Node.js version, OS, and deployment method (Docker / bare metal)
- Relevant logs (with secrets removed)

**Do not** open public issues for security vulnerabilities — see [SECURITY.md](SECURITY.md).

---

## Feature Requests

[Open a feature request](https://github.com/wokspec/Chopsticks/issues/new?template=feature_request.md) with:

- A clear description of the problem it solves
- Any examples or prior art from other bots/projects
- Whether you'd be willing to implement it yourself

---

## Recognition

All contributors are recognized in the repository. Thank you for making Chopsticks better! 🥢

---

By contributing, you agree that your contributions are licensed under the project's [MIT License](LICENSE).

