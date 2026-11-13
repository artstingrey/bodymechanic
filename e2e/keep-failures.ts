/**
 * Keeps the evidence of every failed test (lead, 2026-11-07: a live M-01 failure was lost — Playwright wipes
 * e2e/.results on the next run). For each failed / timed-out attempt the attachments (trace, screenshot,
 * error-context) and the error text are copied to e2e/.failures/<run time>/<project>__<test>__try<N>/, which no run
 * cleans. Open a trace with `npx playwright show-trace <…>/trace.zip`. The folder is git-ignored; delete it by hand.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Reporter, TestCase, TestResult, FullConfig } from '@playwright/test/reporter';

const slug = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80);

export default class KeepFailures implements Reporter {
  private dir = '';
  private kept = 0;

  onBegin(config: FullConfig) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.dir = path.join(config.rootDir, '.failures', stamp);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === 'passed' || result.status === 'skipped') return;
    const project = test.parent.project()?.name ?? 'project';
    const into = path.join(this.dir, `${slug(project)}__${slug(test.title)}__try${result.retry}`);
    fs.mkdirSync(into, { recursive: true });
    const base = process.env.GATE_BASE_URL || 'local out/';
    const errors = result.errors.map((e) => e.stack || e.message || String(e.value)).join('\n\n');
    fs.writeFileSync(path.join(into, 'error.txt'), `${test.titlePath().join(' › ')}\nproject: ${project}\nagainst: ${base}\nstatus: ${result.status}, ${result.duration} ms\n\n${errors}\n`);
    for (const a of result.attachments) {
      try {
        if (a.path && fs.existsSync(a.path)) fs.copyFileSync(a.path, path.join(into, path.basename(a.path)));
        else if (a.body) fs.writeFileSync(path.join(into, slug(a.name) + (a.contentType.includes('png') ? '.png' : '.txt')), a.body);
      } catch { /* best effort: never fail the run over evidence */ }
    }
    this.kept++;
  }

  onEnd() {
    if (this.kept) console.log(`\nkeep-failures: evidence of ${this.kept} failed test(s) in ${this.dir}`);
  }
}
