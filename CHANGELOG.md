# Changelog

## 1.0.0 (2026-10-14)

First release, by Louis Wright.

- Lints a declarative retention policy (YAML subset or JSON) with line numbers.
- Periods as ISO 8601 durations or "<n> days|weeks|months|years"; indefinite retention flagged for personal data unless justified.
- Coverage: every category held in a system must have a rule; unknown categories/systems; unused categories.
- Conflicts and duplicates, max period and special-category max period, legal basis, expiry action, trigger, owner, review date.
- Text/JSON/SARIF/Markdown output, `--fail-on`, exit codes 0/1/2, allowlist with expiry, severity overrides.
- Composite GitHub Action with job summary.
