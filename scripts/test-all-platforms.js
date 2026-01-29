const { chromium } = require('playwright');
const fs = require('fs');

const credentials = JSON.parse(fs.readFileSync('data/credentials.json', 'utf-8'));
const platformSkills = JSON.parse(fs.readFileSync('data/platform-skills.json', 'utf-8'));

async function testPlatform(platformId) {
  const platform = credentials.platforms[platformId];
  const skills = platformSkills[platformId];

  if (!platform) return { platformId, status: 'NO_CONFIG', error: 'credentials.jsonに設定なし' };
  if (!skills) return { platformId, status: 'NO_SKILLS', error: 'platform-skills.jsonに設定なし' };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  const result = { platformId, name: platform.name, phases: [] };

  try {
    // Phase 1: Navigate
    result.phases.push({ phase: 'navigate', status: 'start' });
    await page.goto(platform.loginUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
    result.phases[result.phases.length - 1].status = 'ok';
    result.phases[result.phases.length - 1].url = page.url();

    // Phase 2: Login form detection
    result.phases.push({ phase: 'login_form', status: 'start' });
    const firstStep = skills.login && skills.login.steps && skills.login.steps[0];
    if (firstStep && firstStep.selector) {
      try {
        await page.waitForSelector(firstStep.selector, { timeout: 10000, state: 'visible' });
        result.phases[result.phases.length - 1].status = 'ok';
        result.phases[result.phases.length - 1].selector = firstStep.selector;
      } catch (e) {
        result.phases[result.phases.length - 1].status = 'failed';
        result.phases[result.phases.length - 1].error = 'セレクタ "' + firstStep.selector + '" が見つからない';
      }
    } else {
      result.phases[result.phases.length - 1].status = 'skipped';
    }

    // Phase 3: Login execution
    if (result.phases[result.phases.length - 1].status === 'ok') {
      result.phases.push({ phase: 'login_exec', status: 'start' });
      const creds = platform.credentials;

      for (const step of skills.login.steps) {
        try {
          if (step.action === 'waitFor') {
            await page.waitForSelector(step.selector, { timeout: step.timeout || 10000, state: 'visible' });
          } else if (step.action === 'fill') {
            let value = step.value
              .replace(/\$\{email\}/g, creds.email || '')
              .replace(/\$\{password\}/g, creds.password || '')
              .replace(/\$\{id\}/g, creds.id || '')
              .replace(/\$\{userId\}/g, creds.userId || '');
            await page.fill(step.selector, value);
          } else if (step.action === 'click') {
            await page.click(step.selector);
          } else if (step.action === 'wait') {
            await page.waitForTimeout(step.ms || 1000);
          }
        } catch (e) {
          if (!step.optional) {
            result.phases[result.phases.length - 1].status = 'failed';
            result.phases[result.phases.length - 1].error = step.action + ': ' + e.message;
            break;
          }
        }
      }

      if (result.phases[result.phases.length - 1].status !== 'failed') {
        await page.waitForTimeout(3000);
        const currentUrl = page.url();
        const successCheck = skills.login.successCheck;
        let loginOk = true;

        if (successCheck && successCheck.urlContains && !currentUrl.includes(successCheck.urlContains)) loginOk = false;
        if (successCheck && successCheck.urlNotContains) {
          const notContains = Array.isArray(successCheck.urlNotContains) ? successCheck.urlNotContains : [successCheck.urlNotContains];
          if (notContains.some(function(s) { return currentUrl.includes(s); })) loginOk = false;
        }

        result.phases[result.phases.length - 1].status = loginOk ? 'ok' : 'failed';
        result.phases[result.phases.length - 1].url = currentUrl;
        if (!loginOk) result.phases[result.phases.length - 1].error = 'ログイン後のURL判定失敗';
      }
    }

    // Summary
    const lastPhase = result.phases[result.phases.length - 1];
    if (lastPhase.status === 'ok' && lastPhase.phase === 'login_exec') {
      result.status = 'LOGIN_OK';
    } else if (lastPhase.status === 'failed') {
      result.status = 'FAILED_AT_' + lastPhase.phase.toUpperCase();
      result.error = lastPhase.error;
    } else {
      result.status = 'UNKNOWN';
    }

  } catch (e) {
    result.status = 'ERROR';
    result.error = e.message;
  } finally {
    await browser.close().catch(function() {});
  }

  return result;
}

async function main() {
  const platforms = credentials.priority;
  console.log('Testing ' + platforms.length + ' platforms...\n');

  const results = [];

  for (const platformId of platforms) {
    process.stdout.write('Testing ' + platformId + '... ');
    const result = await testPlatform(platformId);
    results.push(result);
    const errMsg = result.error ? ' (' + result.error.substring(0, 50) + ')' : '';
    console.log(result.status + errMsg);
  }

  console.log('\n=== SUMMARY ===');
  const ok = results.filter(function(r) { return r.status === 'LOGIN_OK'; });
  const failed = results.filter(function(r) { return r.status !== 'LOGIN_OK'; });

  console.log('\nOK (' + ok.length + '): ' + ok.map(function(r) { return r.platformId; }).join(', '));
  console.log('\nFailed (' + failed.length + '):');
  failed.forEach(function(r) {
    console.log('  ' + r.platformId + ': ' + r.status + ' - ' + (r.error || 'no error info'));
  });
}

main().catch(console.error);
