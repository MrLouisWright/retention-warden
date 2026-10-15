# retention-warden

[![npm version](https://img.shields.io/npm/v/retention-warden.svg)](https://www.npmjs.com/package/retention-warden) [![CI](https://github.com/MrLouisWright/retention-warden/actions/workflows/ci.yml/badge.svg)](https://github.com/MrLouisWright/retention-warden/actions/workflows/ci.yml) [![Node](https://img.shields.io/node/v/retention-warden.svg)](https://nodejs.org) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Lint your data-retention policy as code: every data category gets a period, a legal basis and an action at expiry.

GDPR's storage-limitation principle, the UK GDPR and most security questionnaires ask the same thing: how long do you keep each kind of personal data, why, and what happens afterwards? The answer usually lives in a spreadsheet that drifts away from the systems it describes. `retention-warden` reads a small, declarative `retention.yml` (categories, systems and rules), checks it is complete and consistent, and fails CI when someone adds a new data category without a rule or sets an over-long or indefinite period.

CLI, library and GitHub Action. Node.js 18+, **zero runtime dependencies**, runs offline. By Louis Wright.

## Features

- **Coverage:** every category held in a system needs a rule (category-wide or system-specific); undeclared categories and systems are reported; unused categories are noted.
- **Periods:** ISO 8601 (`P30D`, `P6M`, `P2Y`) or plain words (`90 days`, `6 years`); invalid periods, missing periods and indefinite retention of personal data (without `justification`) are high severity.
- **Limits:** `defaults.maxPeriod` and `defaults.specialMaxPeriod` (for `special: true` categories such as health data).
- **Consistency:** conflicting rules for the same category and system, and exact duplicates.
- **Accountability:** legal basis, action at expiry (delete, anonymise, archive, review, ...), trigger (when the clock starts), owner, and a `reviewed` date checked against `reviewEveryMonths` (default 12).
- **Precise locations:** findings carry the line in your YAML file, so SARIF annotations land on the right rule.

### Scope

retention-warden checks the policy document, not your databases: it does not discover data or delete anything. Pair it with your data inventory. It is not legal advice; periods and bases must come from your own legal review.

## Rules

| Rule | Default severity | What it means |
|---|---|---|
| `retention-parse-error` | high | Policy file is not valid YAML/JSON or has the wrong shape |
| `retention-category-unmapped` | high | A data category held in a system has no retention rule |
| `retention-period-missing` | high | Rule has no retention period |
| `retention-period-invalid` | high | Retention period cannot be parsed (use ISO 8601 like P2Y, or "30 days", "6 months") |
| `retention-conflict` | high | Two rules give the same category (and system) different periods or actions |
| `retention-indefinite` | high | Personal data is kept indefinitely without a documented justification |
| `retention-category-unknown` | medium | Rule or system refers to a category that is not declared |
| `retention-system-unknown` | medium | Rule refers to a system that is not declared |
| `retention-basis-missing` | medium | Rule has no legal basis or justification for the period |
| `retention-action-missing` | medium | Rule does not say what happens at expiry (delete, anonymise, archive, review) |
| `retention-exceeds-max` | medium | Period is longer than the policy maximum (maxPeriod / specialMaxPeriod) |
| `retention-trigger-missing` | low | Rule does not say when the period starts (collection, last activity, contract end, ...) |
| `retention-owner-missing` | low | Rule or system has no accountable owner |
| `retention-review-overdue` | low | Policy review date is missing or older than reviewEveryMonths |
| `retention-duplicate` | low | Identical rule declared twice |
| `retention-category-unused` | info | Declared category is not held in any system and has no rule |
| `allowlist-expired` | medium | An allowlist entry is past its `expires` date |
| `allowlist-unused` | info | An allowlist entry matched nothing |

## Install and run

```bash
npx retention-warden
npx retention-warden policies/retention.yml --fail-on medium
npx retention-warden . --max-period P7Y --special-max-period P1Y
npx retention-warden --format sarif > retention.sarif
```

### Sample output

```text
retention-warden — test/fixtures/bad/retention.yml
policy test/fixtures/bad/retention.yml

HIGH     test/fixtures/bad/retention.yml:12 "chat" is held in postgres but no rule covers it [retention-category-unmapped]
HIGH     test/fixtures/bad/retention.yml:21 Rules #1 and #2 disagree for account: P2Y/delete vs P10Y/delete [retention-conflict]
HIGH     test/fixtures/bad/retention.yml:32 marketing is kept indefinitely [retention-indefinite]
HIGH     test/fixtures/bad/retention.yml:36 Period "soon" for invoices in s3 is not understood [retention-period-invalid]
MEDIUM   test/fixtures/bad/retention.yml:13 System "postgres" holds undeclared category "marketing" [retention-category-unknown]
MEDIUM   test/fixtures/bad/retention.yml:22 account kept 10y, over maxPeriod 5y [retention-exceeds-max]
```

## Options

```text
retention-warden 1.0.0 — lint a declarative data-retention policy

Usage: retention-warden [policy.yml|dir] [options]   (default: retention.yml in the current directory)

Policy
      --max-period <p>         Longest allowed period, e.g. P7Y (overrides defaults.maxPeriod)
      --special-max-period <p> Longest period for special-category data, e.g. P1Y
      --review-every-months <n>  Review interval (default 12)

Common
  -c, --config <file>     JSON config (default: .retention-warden.json or "retentionWarden" in package.json)
  -f, --format <fmt>      text (default) | json | sarif | markdown
      --json <file>       Also write a JSON report
      --sarif <file>      Also write SARIF 2.1.0
      --markdown <file>   Also write Markdown (e.g. for a job summary)
      --fail-on <sev>     critical | high | medium | low | info | none (default: high)
      --list-rules        Print rules and default severities
      --no-fixes          Hide fix suggestions in text output
      --no-color          Disable colours
  -v, --version / -h, --help

Exit codes: 0 = passed, 1 = findings at or above --fail-on, 2 = usage, config or read error.
```

## Configuration and allowlist

Options can live in `.retention-warden.json` (or a `"retentionWarden"` key in `package.json`, or `--config <file>`):

```json
{
  "failOn": "medium",
  "severity": {
    "retention-parse-error": "low"
  },
  "allowlist": [
    {
      "rule": "retention-indefinite",
      "subject": "audit-log",
      "reason": "Statutory audit trail, reviewed by DPO",
      "expires": "2027-03-31"
    }
  ],
  "maxPeriod": "P7Y",
  "specialMaxPeriod": "P1Y",
  "reviewEveryMonths": 6
}
```

- **`severity`** changes a rule's severity, or turns it `"off"`.
- **`allowlist`** entries suppress matching findings. Each needs a `reason` and matches on any combination of `rule`, `file`, `subject` (globs with `*`) and `match` (a substring of the message). Add `expires` (`YYYY-MM-DD`) so the exception is time-boxed: once it lapses the finding comes back along with an `allowlist-expired` finding (medium). Entries that no longer match anything are reported as `allowlist-unused` (info).

The config file is looked up in the target directory first, then in the current directory, so `.retention-warden.json` can live at your repository root. Other keys: `maxPeriod`, `specialMaxPeriod`, `reviewEveryMonths`, `requireSystemOwner` and `failOn`.

## Output and exit codes

- `--format text` (default), `json`, `sarif` (SARIF 2.1.0 for GitHub code scanning) or `markdown` (for job summaries and PR comments). `--json`, `--sarif` and `--markdown` write extra report files in the same run.
- `--fail-on <severity>` sets the threshold (`critical`, `high`, `medium`, `low`, `info`, `none`; default `high`).
- Exit codes: **0** passed, **1** findings at or above `--fail-on`, **2** usage, config or read error.

## GitHub Action

```yaml
permissions:
  contents: read
  security-events: write   # only needed for the SARIF upload
jobs:
  retention-warden:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with: { persist-credentials: false }
      - uses: MrLouisWright/retention-warden@v1
        with:
          path: .
          fail-on: high
          sarif: retention-warden.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with: { sarif_file: retention-warden.sarif }
```

| Input | Description | Default |
|---|---|---|
| `path` | Policy file, or directory containing `retention.yml` | `.` |
| `fail-on` | Failure threshold | `high` |
| `config` | Config file path | |
| `sarif` / `json` | Write SARIF / JSON report to this path | |
| `job-summary` | Add the Markdown report to the job summary | `true` |
| `args` | Extra CLI arguments | |

The action runs the bundled CLI with Node 20; it has no dependencies to install. Pin it to a commit SHA if your policy requires it.

## Library

```js
import { check, lintPolicy, parsePeriod } from "retention-warden";
parsePeriod("P2Y"); // { days: 730.5 }
const report = check("retention.yml");
console.log(report.counts, report.findings);
```

Types are included.

## Requirements

Node.js 18 or newer. Zero runtime dependencies.

## Support

If this project is useful to you, you can support its development with a donation: [Buy me a coffee](https://donate.stripe.com/aFa00lek3cvX4Ds2Fk9EI0b). It helps keep these tools maintained, documented and free for everyone.

## Credit (optional)

Free to use under MIT, no attribution required. If retention-warden helps you, a link back is appreciated:

```html
<a href="https://louiswright.co.uk">Built with retention-warden by Louis Wright</a>
```

```markdown
[![Built with retention-warden by Louis Wright](https://img.shields.io/badge/built%20with-retention--warden-blue)](https://louiswright.co.uk)
```

## Licence

MIT © Louis Wright ([Louis Wright](https://github.com/MrLouisWright))
