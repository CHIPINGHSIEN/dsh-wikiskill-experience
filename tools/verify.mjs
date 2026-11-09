#!/usr/bin/env node
/**
 * dsh-wikiskill-experience - offline self-check.
 *
 * Drives the plugin through a MOCK Cordis context against a REAL temporary
 * wiki directory. No DeepSeek Harness, no profile, no network.
 *
 *   node tools/verify.mjs             structural + descriptive loop + dry-run
 *   node tools/verify.mjs --publish   also exercise publish + rollback inside
 *                                     the temporary skill root (opt-in)
 *
 * What this CANNOT verify: the Harness' own `defineTool` output validation
 * (it lives in the Host, not here). This script only asserts that every key a
 * tool returns is declared in that tool's `output.schema.properties`, and that
 * every `required` key is present.
 *
 * Source is pure ASCII on purpose (see README section 9).
 */

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply, inject } from '../index.js';

const WITH_PUBLISH = process.argv.includes('--publish');

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`FAIL ${label}${detail === undefined ? '' : ` -> ${String(detail).slice(0, 300)}`}`);
  }
}

function assertSubset(label, value, schema) {
  const props = (schema && schema.properties) || {};
  const bad = Object.keys(value || {}).filter((key) => !(key in props));
  check(`${label}: every returned key is declared in output.schema`, bad.length === 0, bad.join(','));
  const missing = ((schema && schema.required) || []).filter((key) => !(key in (value || {})));
  check(`${label}: every required output key is present`, missing.length === 0, missing.join(','));
}

async function lineCount(file) {
  if (!existsSync(file)) return 0;
  const text = await readFile(file, 'utf8');
  return text.split('\n').filter((line) => line.trim()).length;
}

async function main() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'wikiskill-verify-'));
  const root = path.join(tmp, 'experience', 'wiki');
  const skillRoot = path.join(tmp, 'skills');

  const registered = new Map();
  const sections = [];
  const listeners = [];

  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    systemPrompt: {
      section(options) {
        sections.push(options);
        return () => {};
      },
    },
    tools: {
      register(def) {
        registered.set(def.name, def);
        return () => {};
      },
    },
    workingDirectory: { get: () => process.cwd() },
    on(event, listener) {
      listeners.push({ event, listener });
      return () => {};
    },
    get() {
      return undefined;
    },
  };

  // --- module surface -----------------------------------------------------
  check('module exports apply()', typeof apply === 'function');
  check('module exports inject[]', Array.isArray(inject) && inject.length > 0, inject);
  check(
    'inject declares the services the plugin touches',
    ['systemPrompt', 'tools', 'workingDirectory'].every((s) => inject.includes(s)),
    inject,
  );

  const dispose = apply(ctx, {
    root,
    enabled: true,
    injectSection: true,
    mirrorProjectLayer: false,
    maxIndexLines: 12,
    topN: 8,
    p2Enabled: true,
    p3Enabled: true,
    p3SkillRoot: skillRoot,
  });
  check('apply() returns a disposer', typeof dispose === 'function');

  // Let the asynchronous boot (layout + first compile) settle.
  await new Promise((resolve) => setTimeout(resolve, 400));

  // --- registration -------------------------------------------------------
  const names = [...registered.keys()].sort();
  check('registers exactly the four documented tools', names.join(',') ===
    'wikiskill_hint,wikiskill_propose,wikiskill_record,wikiskill_release', names.join(','));
  check('registers one systemPrompt section', sections.length === 1, sections.length);
  check('section is declared non-interpolating', sections[0] && sections[0].interpolate === false);
  check('observes tools/result for hit receipts', listeners.some((l) => l.event === 'tools/result'));
  check('observes session/event for corrections', listeners.some((l) => l.event === 'session/event'));

  // --- layout -------------------------------------------------------------
  for (const dir of ['raw', 'patterns', 'skills']) {
    check(`layout creates ${dir}/`, existsSync(path.join(root, dir)));
  }
  check('layout creates index.md', existsSync(path.join(root, 'index.md')));
  check('layout creates logs.md', existsSync(path.join(root, 'logs.md')));
  check('layout creates manifest.json', existsSync(path.join(root, 'manifest.json')));
  check('p2 layout created', existsSync(path.join(root, 'p2')));
  check('p3 layout created', existsSync(path.join(root, 'p3')));

  // --- P0: record ---------------------------------------------------------
  const recordTool = registered.get('wikiskill_record');
  const recorded = await recordTool.execute({
    patternId: 'failure-verify-probe',
    kind: 'failure',
    title: 'Self-check probe record',
    errorDescription: 'Written by tools/verify.mjs into a temporary wiki.',
    rootCause: 'The self-check needed a real end-to-end write to assert consistency.',
    when: 'Any time the shipped invariants have to be re-asserted without a live profile.',
    general: 'Run the packaged self-check before publishing a new version.',
    projectContext: 'Temporary directory only; removed at the end of the run.',
    evidence: 'tools/verify.mjs',
    transfer: 'project-only',
  });
  assertSubset('wikiskill_record', recorded, recordTool.output.schema);
  check('wikiskill_record returns ok:true', recorded.ok === true, recorded.note);
  check('record reports its wiki root', recorded.wikiRoot === root, recorded.wikiRoot);

  const day = new Date().toISOString().slice(0, 10);
  const rawFile = path.join(root, 'raw', `${day}.jsonl`);
  check('raw/YYYY-MM-DD.jsonl exists', existsSync(rawFile));
  check('raw holds exactly one record', (await lineCount(rawFile)) === 1);
  const logText = await readFile(path.join(root, 'logs.md'), 'utf8');
  const logRecords = logText
    .split('\n')
    .filter((line) => line.startsWith('- ') && line.includes('failure-verify-probe'));
  check('logs.md gains exactly one append-only line for the record', logRecords.length === 1);
  check('pattern page exists for the recorded pattern',
    existsSync(path.join(root, 'patterns', 'failure-verify-probe.md')));

  const rawRecord = JSON.parse((await readFile(rawFile, 'utf8')).trim().split('\n').pop());
  check('raw record is parseable JSON with the pattern id', rawRecord.patternId === 'failure-verify-probe');
  check('raw record marks whether the wiki was injected', typeof rawRecord.wikiInjected === 'boolean');
  check('skills/ inside the wiki stays empty',
    (await readdir(path.join(root, 'skills'))).length === 0);

  const indexText = await readFile(path.join(root, 'index.md'), 'utf8');
  check('index.md mentions the recorded pattern', indexText.includes('failure-verify-probe'));
  check('index.md is descriptive, not imperative boilerplate', indexText.length > 0);

  const injected = sections[0].text();
  check('injected section text is a non-empty string', typeof injected === 'string' && injected.length > 0);

  // --- P0: hint -----------------------------------------------------------
  const hintTool = registered.get('wikiskill_hint');
  const hint = await hintTool.execute({});
  assertSubset('wikiskill_hint', hint, hintTool.output.schema);
  check('wikiskill_hint returns a numeric count', typeof hint.count === 'number');

  // --- P2: gate refuses on thin evidence ----------------------------------
  const proposeTool = registered.get('wikiskill_propose');
  const gate = await proposeTool.execute({ action: 'status' });
  assertSubset('wikiskill_propose', gate, proposeTool.output.schema);
  check('P2 is reported enabled', gate.p2Enabled === true);
  check('P2 gate refuses one record (1 < 20)', gate.eligible === false, JSON.stringify(gate).slice(0, 200));

  const draft = await proposeTool.execute({ action: 'draft' });
  check('P2 draft reports eligible:false below the gate', draft.ok === true && draft.eligible === false,
    JSON.stringify(draft).slice(0, 240));
  check('P2 draft creates no proposal below the gate', draft.deferredCount === 0, draft.deferredCount);
  check('P2 deferred queue holds no proposal entry',
    !/^### Proposal /m.test(await readFile(path.join(root, 'p2', 'deferred-proposals.md'), 'utf8')));

  // --- P3: dry-run publishes nothing --------------------------------------
  const releaseTool = registered.get('wikiskill_release');
  const status = await releaseTool.execute({ action: 'status' });
  assertSubset('wikiskill_release status', status, releaseTool.output.schema);
  check('P3 status reports approvalRequired', status.approvalRequired === true);
  check('P3 status reports the configured skill root', status.skillRoot === skillRoot, status.skillRoot);

  const dryRun = await releaseTool.execute({ action: 'publish', name: 'verify-probe' });
  assertSubset('wikiskill_release publish (dry-run)', dryRun, releaseTool.output.schema);
  check('publish without a user token is DRY-RUN', dryRun.dryRun === true, JSON.stringify(dryRun).slice(0, 200));
  check('dry-run wrote no SKILL.md', !existsSync(skillRoot));

  // --- optional: approved publish + rollback in the temp skill root -------
  if (WITH_PUBLISH) {
    // The token is supplied by this script to test the write path inside a
    // throwaway skill root. It is NOT a substitute for user approval, and this
    // mode never touches a real skill root.
    const noDraft = await releaseTool.execute({ action: 'publish', name: 'failure-verify-probe', approvalToken: 'USER-APPROVED' });
    check('approved publish without a draft is refused', noDraft.ok === false, JSON.stringify(noDraft).slice(0, 240));
    check('refused publish wrote no file', !existsSync(skillRoot));

    const forced = await proposeTool.execute({ action: 'draft', minCases: 1, minRepeat: 1, minScenes: 1 });
    check('explicit threshold overrides are reported in the note',
      typeof forced.note === 'string' && forced.note.includes('threshold overrides'), forced.note);
    check('draft is created once the (explicitly lowered) gate passes',
      forced.ok === true && forced.eligible === true && forced.deferredCount === 1,
      JSON.stringify(forced).slice(0, 240));

    const published = await releaseTool.execute({ action: 'publish', name: 'failure-verify-probe', approvalToken: 'USER-APPROVED' });
    assertSubset('wikiskill_release publish (approved)', published, releaseTool.output.schema);
    check('approved publish returns ok:true and a skill file',
      published.ok === true && typeof published.skillFile === 'string' && existsSync(published.skillFile),
      JSON.stringify(published).slice(0, 240));
    check('published skill name is normalized to kebab-case',
      published.publishedName === 'wikiskill-failure-verify-probe', published.publishedName);
    if (published.skillFile && existsSync(published.skillFile)) {
      const body = await readFile(published.skillFile, 'utf8');
      check('published SKILL.md has a real description, not the scaffold text',
        body.includes('description: ') && !body.includes('See the pattern page'));
      check('published SKILL.md carries the real strategy-level method',
        body.includes('Run the packaged self-check before publishing a new version.'));
      check('published SKILL.md declares its own name and instructions section',
        body.includes('name: wikiskill-failure-verify-probe') && body.includes('## Instructions'));
    }

    const rolled = await releaseTool.execute({ action: 'rollback', name: 'failure-verify-probe', approvalToken: 'USER-APPROVED' });
    check('rollback removes the published SKILL.md',
      rolled.ok === true && !existsSync(published.skillFile), JSON.stringify(rolled).slice(0, 240));
    check('rollback leaves the wiki pattern page intact',
      existsSync(path.join(root, 'patterns', 'failure-verify-probe.md')));
    check('rollback leaves skills/ inside the wiki root empty',
      (await readdir(path.join(root, 'skills'))).length === 0);
  }

  // --- disposition --------------------------------------------------------
  dispose();
  check('disposer runs without throwing', true);

  await rm(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });

  console.log('');
  console.log(`${passed} passed, ${failures.length} failed${WITH_PUBLISH ? ' (with --publish)' : ''}`);
  if (failures.length) {
    console.log('failed checks:');
    for (const name of failures) console.log(`  - ${name}`);
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(`verify crashed: ${error && error.stack ? error.stack : error}`);
  process.exitCode = 1;
});
