# Contributing to Baaton

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/rmzlb/baaton.git
cd baaton

# Backend (Rust)
cd backend
cp .env.example .env
cargo run

# Frontend (React)
cd ../frontend
npm install
npm run dev
```

## Running Tests

```bash
# Backend
cd backend
cargo test

# Smoke tests (requires running API + API key)
BAATON_API_KEY=baa_xxx ./tests/smoke.sh http://localhost:4000
```

## Pull Requests

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run `cargo clippy` and `cargo test`
5. Commit with a descriptive message
6. Push and open a PR

## Code Style

- Rust: `cargo fmt` + `cargo clippy` with no warnings
- Frontend: TypeScript strict, Tailwind for styling
- Keep files under 400 lines when possible
- No placeholder code — everything must compile and run

## Architecture

- `backend/src/routes/` — API endpoint handlers
- `backend/src/models/` — Data models
- `backend/src/middleware/` — Auth, rate limiting, RBAC
- `frontend/src/pages/` — Page components
- `frontend/src/components/` — Reusable UI components
- `packages/mcp/` — MCP bridge package

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
