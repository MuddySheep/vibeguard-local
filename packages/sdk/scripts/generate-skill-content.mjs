// Generates src/cli/skill-md-content.generated.ts from
// examples/agent-skill/SKILL.md so the install-skill subcommand can
// embed the canonical skill content at build time.
//
// Why generate vs hand-inline:
//   - SKILL.md content has backticks (in code blocks) and ${} (in
//     JSON examples). Hand-escaping all that in a TS template literal
//     is fragile and a magnet for drift.
//   - The SKILL.md file is the canonical source — anyone editing it
//     should not have to also edit a duplicate constant. The
//     generator + drift-prevention test (tests/test-cli-install-skill)
//     together guarantee the inline constant always matches.
//
// Why no fancy plugin:
//   - tsup plugins or webpack loaders would add build-tooling
//     complexity for a one-shot stringify. A 30-line script run as a
//     prebuild/pretest hook is the simpler answer.
//
// This script runs as `npm run prebuild`, `npm run pretest`, and
// `npm run pretypecheck`. The generated file is gitignored.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_MD_PATH = resolve(
  HERE,
  '..',
  'examples',
  'agent-skill',
  'SKILL.md',
);
const OUTPUT_PATH = resolve(
  HERE,
  '..',
  'src',
  'cli',
  'skill-md-content.generated.ts',
);

const content = readFileSync(SKILL_MD_PATH, 'utf8');

// JSON.stringify handles all the escaping concerns (quotes, backslashes,
// newlines, control chars). The output is a valid JS string literal.
const generated = `// GENERATED FILE — DO NOT EDIT.
//
// Source: examples/agent-skill/SKILL.md
// Generator: scripts/generate-skill-content.mjs
//
// Regenerated automatically by the npm prebuild / pretest /
// pretypecheck hooks. If you need to edit the skill content,
// edit examples/agent-skill/SKILL.md and re-run any of:
//   npm run build / npm test / npm run typecheck
//
// Drift prevention: tests/test-cli-install-skill.test.ts asserts
// this constant matches the source file byte-for-byte.

export const SKILL_MD_CONTENT: string = ${JSON.stringify(content)};
`;

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, generated, 'utf8');

// Brief stdout so npm script output is informative without being noisy.
process.stdout.write(
  `  generated ${OUTPUT_PATH.replace(HERE + '/..', '.')} (${content.length} bytes)\n`,
);
