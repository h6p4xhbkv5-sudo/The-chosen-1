# Test Coverage Analysis — Lumina AI

## Executive Summary

The codebase has **zero test coverage** across ~9,200 lines of production code.
No test framework is installed, no test files exist, and no CI pipeline runs
checks on pull requests. Given that this platform handles student authentication,
Stripe payments, and personal academic data, this is a critical gap that creates
real risk of regressions going undetected in production.

This document maps every handler and functional area to its risk level,
identifies the highest-value tests to write first, and proposes a realistic
roadmap for reaching meaningful coverage.

---

## 1. Current State

| File | Lines | Test Coverage |
|---|---|---|
| `api/chat.js` | 452 | 0% |
| `index.html` (frontend JS) | ~4,800 | 0% |
| `admin.html` | 146 | 0% |
| **Total** | **~9,200** | **0%** |

### Additional structural issues that block testing

`api/chat.js` contains **six separate serverless handlers concatenated into one
file**, each with its own `export default` declaration. This is not valid
JavaScript — a module can only have one default export — and must be split into
separate files before the handlers can be individually imported and tested:

| Intended file | Line range | Handler |
|---|---|---|
| `api/admin.js` | 1–47 | Admin stats, user list, bulk email |
| `api/auth.js` | 48–126 | signup / login / reset / verify |
| `api/chat.js` | 127–146 | Anthropic API proxy |
| `api/email.js` | 147–235 | Email templates + Resend dispatch |
| `api/notes.js` | 236–263 | Note CRUD |
| `api/progress.js` | 264–304 | Progress tracking + XP |
| `api/stripe.js` | 305–347 | Stripe checkout + billing portal |
| `api/webhook.js` | 348–452 | Stripe webhook event processing |

---

## 2. Risk-Prioritised Coverage Gaps

### Priority 1 — Critical (payment & auth pipelines)

These areas handle money and user identity. A bug here directly harms users.

#### 2.1 Stripe Webhook Handler (`api/webhook.js`)

The webhook is the only mechanism that activates subscriptions after payment.
If it silently fails, users pay but never gain access.

| Test case | Why it matters |
|---|---|
| `checkout.session.completed` activates profile | Core business flow |
| `checkout.session.completed` defaults plan to "student" | Prevents data corruption when `metadata.plan` is absent |
| `invoice.payment_succeeded` re-activates after renewal | Subscription persistence across billing cycles |
| `invoice.payment_failed` marks profile `past_due` | Correct access control for overdue accounts |
| `invoice.payment_failed` sends failure email | User notification on card decline |
| `customer.subscription.deleted` sets plan to "free" | Access revocation on cancellation |
| Invalid Stripe signature → 400 | Security: prevents spoofed webhooks |
| Non-POST method → 405 | HTTP correctness |
| Email skipped when `RESEND_API_KEY` absent | Graceful degradation in dev environments |

**Tests added:** `tests/api/webhook.test.js` (20 test cases)

#### 2.2 Auth Handler (`api/auth.js`)

| Test case | Why it matters |
|---|---|
| `signup` creates Supabase user + profile row | User onboarding integrity |
| `signup` defaults plan to "student" | Data consistency |
| `signup` returns 400 on duplicate email | Prevents silent failures |
| `signup` returns 500 on unexpected Supabase error | Error surfacing |
| `login` returns token + merged profile | Session establishment |
| `login` returns 401 on wrong credentials | Security |
| `reset` calls Supabase with correct redirect URL | Password recovery flow |
| `reset` returns 400 when email not found | Error handling |
| `verify` resolves token to user + profile | Session validation |
| `verify` returns 401 with no `Authorization` header | Security |
| `verify` returns 401 for an invalid token | Security |
| Unknown action → 400 | API contract |
| OPTIONS → 200 (CORS preflight) | Browser compatibility |

**Tests added:** `tests/api/auth.test.js` (13 test cases)

---

### Priority 2 — High (data integrity)

Bugs here corrupt user academic data rather than causing immediate financial harm.

#### 2.3 Progress Tracking (`api/progress.js`)

The accuracy calculation is pure logic with several edge cases:

| Test case | Input | Expected `accuracy` |
|---|---|---|
| Normal case | 8 correct / 10 total | 80 |
| All wrong | 0 correct / 10 total | 0 |
| Division by zero | 0 correct / 0 total | 0 (not `NaN`) |
| Rounding | 1 correct / 3 total | 33 (not 33.33…) |
| Perfect score | 5 correct / 5 total | 100 |

Additional test cases required:

- `GET` returns combined progress, profile, and top-10 mistakes
- `GET` returns empty arrays when user has no data (no `null` crashes)
- `POST` upserts with the correct conflict key `user_id,subject,topic`
- `POST` calls `increment_user_stats` RPC with correct `xp_add` and `questions_add`
- `POST` defaults `xpEarned` to 0 when omitted
- Unauthorized requests → 401 (no token, bad token)

**Tests added:** `tests/api/progress.test.js` (14 test cases)

#### 2.4 Notes CRUD (`api/notes.js`)

| Test case | Why it matters |
|---|---|
| `GET` returns notes ordered newest-first | UI ordering contract |
| `GET` returns `[]` when user has no notes | Prevents `null` crash in frontend |
| `GET` scopes query to authenticated user | Data isolation |
| `POST` inserts note with correct `user_id` | Data ownership |
| `POST` returns created note | Optimistic UI update |
| `DELETE` uses both `id` and `user_id` in WHERE | Prevents users deleting others' notes |
| All methods reject unauthenticated requests → 401 | Security |

**Tests added:** `tests/api/notes.test.js` (10 test cases)

---

### Priority 3 — Medium (reliability of supporting services)

#### 2.5 Email Handler (`api/email.js`)

| Test case | Why it matters |
|---|---|
| `welcome` template contains user name | Personalisation regression |
| `welcome` template links to correct `SITE_URL` | Broken links are a support burden |
| `weekly` template renders all four stats | All stats visible to user |
| `weekly` template defaults stats to 0 (not `undefined`) | Prevents ugly emails |
| `exam_reminder` includes subject name and days | Email accuracy |
| Unknown `type` → 400 | API contract |
| With `RESEND_API_KEY`: calls Resend, returns `id` | Production path |
| Without `RESEND_API_KEY`: returns HTML preview | Dev fallback |
| Sends from `hello@luminaai.co.uk` always | Brand consistency |
| Resend network error → 500 | Error surfacing |

**Tests added:** `tests/api/email.test.js` (11 test cases)

#### 2.6 Admin Handler (`api/admin.js`)

| Test case | Why it matters |
|---|---|
| Missing / wrong `x-admin-key` → 403 | Security: prevents public access to user data |
| `stats` action returns total, active_7d, paying counts | Dashboard correctness |
| `stats` handles 0 counts (no `null` crash) | Empty-state safety |
| `users` action returns list sorted by `created_at` desc | Admin UX contract |
| `send_weekly_emails` calls email API for each active user | Bulk-send correctness |
| `send_weekly_emails` returns the number of emails sent | Operator feedback |
| Unknown action → 400 | API contract |

**Tests not yet written** — recommended next sprint.

---

### Priority 4 — Frontend Logic (currently untestable without refactoring)

The frontend JavaScript is entirely embedded in `index.html` as inline `<script>`
tags, which means none of it can be imported into a test runner. The functions
below contain real business logic that should be extracted into importable modules:

#### 2.7 Gamification Engine

| Function | Logic to test |
|---|---|
| `addXP(amount)` | XP accumulates in `state.xp`; negative amounts are ignored |
| `updateLevel()` | Level = `Math.floor(xp / 500) + 1`; capped at configured max |
| `logActivity(xp)` | Writes to `localStorage`; accumulates daily, does not overwrite |
| `buildHeatmap()` | Renders one cell per day; today's cell is highlighted |

Extraction path: move pure state-manipulation functions to `src/gamification.js`
and DOM-rendering functions to `src/ui.js`.

#### 2.8 Accessibility Modes

| Function | Logic to test |
|---|---|
| `applyLearningProfile()` | Applies correct CSS class for each profile type |
| `setMode(mode, on)` | Adds/removes class; persists setting to `localStorage` |
| `toggleMode(mode)` | Reads current state from `localStorage` before toggling |

#### 2.9 Calculator (Dyscalculia Support)

| Function | Logic to test |
|---|---|
| `calcInput(val)` | Appends digit; handles decimal point correctly |
| `calcEquals()` | `eval`-free arithmetic for `+`, `-`, `×`, `÷` |
| `calcClear()` | Resets display to `"0"` |

The current implementation uses `eval()` internally, which is both a security
risk and difficult to test. This should be replaced with a proper parser.

#### 2.10 Language Switching (Welsh)

| Function | Logic to test |
|---|---|
| `setLanguage('cy')` | All UI strings replaced with Welsh equivalents |
| `setLanguage('en')` | Welsh strings reverted to English |
| Persistence | Selected language is restored on page reload from `localStorage` |

---

## 3. Recommended Testing Roadmap

### Phase 1 — Infrastructure (complete)

- [x] Install Vitest and `@vitest/coverage-v8` as dev dependencies
- [x] Add `vitest.config.js` with coverage thresholds (70% lines/functions)
- [x] Add `test`, `test:watch`, and `test:coverage` scripts to `package.json`

### Phase 2 — Backend unit tests (complete)

- [x] `tests/api/auth.test.js` — 13 test cases
- [x] `tests/api/webhook.test.js` — 20 test cases
- [x] `tests/api/notes.test.js` — 10 test cases
- [x] `tests/api/progress.test.js` — 14 test cases
- [x] `tests/api/email.test.js` — 11 test cases

### Phase 3 — Backend unit tests (next sprint)

- [ ] `tests/api/admin.test.js` — 7 test cases
- [ ] `tests/api/stripe-checkout.test.js` — checkout session + billing portal

### Phase 4 — Frontend extraction and unit tests

- [ ] Extract gamification logic → `src/gamification.js` + tests
- [ ] Extract accessibility mode logic → `src/accessibility.js` + tests
- [ ] Extract calculator logic → `src/calculator.js` + tests (replace `eval`)
- [ ] Extract language switching → `src/i18n.js` + tests

### Phase 5 — Integration and E2E tests

- [ ] Full signup → profile creation → welcome email flow (mocked external APIs)
- [ ] Payment → webhook → subscription activation flow
- [ ] Quiz completion → XP award → level-up flow
- [ ] E2E with Playwright: login, take a quiz, view dashboard

### Phase 6 — CI/CD

- [ ] Add GitHub Actions workflow: run `npm test` on every PR
- [ ] Block merges when coverage falls below thresholds
- [ ] Add Stripe CLI webhook forwarding for integration tests in CI

---

## 4. Missing Input Validation (test-driven fixes)

The following inputs are accepted by the API with no validation. Tests for these
cases should be written alongside the fixes:

| Handler | Missing validation |
|---|---|
| `auth` signup | `email` format; `password` minimum length; `name` not empty |
| `auth` signup | `plan` must be one of `['student', 'homeschool']` |
| `notes` POST | `text` not empty; `subject` not empty |
| `progress` POST | `total` must be ≥ 0; `correct` must be ≤ `total`; `xpEarned` must be ≥ 0 |
| `email` handler | `email` is a valid address; `name` not empty |
| `stripe` checkout | `plan` must be one of `['student', 'homeschool']`; `email` is valid |
| `admin` handler | All admin routes currently lack rate limiting |

---

## 5. Security Issues Surfaced by Test Planning

Writing these tests revealed the following security gaps:

1. **`api/chat.js` proxies Anthropic API without any authentication.** Any
   anonymous caller can use the application's API key. The handler should verify
   a Supabase session token before forwarding requests.

2. **The calculator uses `eval()`.** If user input ever reaches the calculator
   server-side, this is an RCE vector. The frontend calculator should use a
   proper expression parser.

3. **Admin routes have no rate limiting.** An attacker who discovers the
   `ADMIN_SECRET_KEY` can enumerate all user data without throttling.

4. **DELETE /notes only validates `user_id`** — but does not verify that the
   `id` is a valid UUID before passing it to Supabase. A malformed ID could
   trigger unexpected database behaviour.

---

## 6. Quick Reference — Running Tests

```bash
# Install dependencies (first time)
npm install

# Run all tests once
npm test

# Run tests in watch mode during development
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

Coverage reports are written to `coverage/` in HTML, JSON, and text formats.
Open `coverage/index.html` in a browser to explore line-level coverage.
