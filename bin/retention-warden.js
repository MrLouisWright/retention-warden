#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mainCli, check, RULES } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
mainCli({
  name: 'retention-warden', version: pkg.version, configKey: 'retentionWarden', rules: RULES,
  tagline: 'lint a declarative data-retention policy',
  usage: 'Usage: retention-warden [policy.yml|dir] [options]   (default: retention.yml in the current directory)',
  dirFrom: () => '.',
  help: `Policy
      --max-period <p>         Longest allowed period, e.g. P7Y (overrides defaults.maxPeriod)
      --special-max-period <p> Longest period for special-category data, e.g. P1Y
      --review-every-months <n>  Review interval (default 12)
`,
  options: { 'max-period': { type: 'string' }, 'special-max-period': { type: 'string' }, 'review-every-months': { type: 'string' } },
  run: async ({ positionals, values: o, config, configFile }) => check(positionals[0], { maxPeriod: o['max-period'], specialMaxPeriod: o['special-max-period'], reviewEveryMonths: o['review-every-months'] != null ? Number(o['review-every-months']) : undefined, toolVersion: pkg.version }, config, configFile),
});
