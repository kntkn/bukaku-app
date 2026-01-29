const { chromium } = require('playwright');
const fs = require('fs');

const credentials = JSON.parse(fs.readFileSync('data/credentials.json', 'utf-8'));
const platformSkills = JSON.parse(fs.readFileSync('data/platform-skills.json', 'utf-8'));

// Test property name
const TEST_PROPERTY = 'テスト';

async function login(page, platform, skills) {
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
      if (!step.optional) throw e;
    }
  }
  await page.waitForTimeout(3000);
}

async function executeStep(page, step, propertyName) {
  const value = (step.value || '').replace(/\$\{propertyName\}/g, propertyName);

  if (step.action === 'goto') {
    await page.goto(step.url, { timeout: 30000, waitUntil: 'domcontentloaded' });
    if (step.wait) await page.waitForTimeout(step.wait);
  } else if (step.action === 'waitFor') {
    await page.waitForSelector(step.selector, { timeout: step.timeout || 10000, state: 'visible' });
  } else if (step.action === 'fill') {
    await page.fill(step.selector, value);
  } else if (step.action === 'click') {
    await page.click(step.selector);
  } else if (step.action === 'pressKey') {
    await page.keyboard.press(step.key);
  } else if (step.action === 'wait') {
    await page.waitForTimeout(step.ms || 1000);
  }
}

async function testPlatformSearch(platformId) {
  const platform = credentials.platforms[platformId];
  const skills = platformSkills[platformId];

  if (!platform || !skills) {
    return { platformId, status: 'NO_CONFIG' };
  }

  if (skills.rpaProhibited) {
    return { platformId, name: skills.name, status: 'RPA_PROHIBITED', reason: skills.comment };
  }

  if (skills.search && skills.search.disabled) {
    return { platformId, name: skills.name, status: 'SEARCH_DISABLED' };
  }

  if (skills.complexNavigation || (skills.search && skills.search.requiresManualNavigation)) {
    return { platformId, name: skills.name, status: 'COMPLEX_NAV', reason: skills.comment };
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const result = { platformId, name: skills.name, phases: [] };

  try {
    // Phase 1: Login
    result.phases.push({ phase: 'login', status: 'start' });
    await page.goto(platform.loginUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await login(page, platform, skills);
    result.phases[result.phases.length - 1].status = 'ok';
    result.phases[result.phases.length - 1].url = page.url();

    // Phase 2: Search preSteps
    if (skills.search.preSteps) {
      result.phases.push({ phase: 'search_pre', status: 'start' });
      for (const step of skills.search.preSteps) {
        try {
          await executeStep(page, step, TEST_PROPERTY);
        } catch (e) {
          if (!step.optional) {
            result.phases[result.phases.length - 1].status = 'failed';
            result.phases[result.phases.length - 1].error = `${step.action}: ${e.message}`;
            throw e;
          }
        }
      }
      result.phases[result.phases.length - 1].status = 'ok';
      result.phases[result.phases.length - 1].url = page.url();
    }

    // Phase 3: Search steps
    result.phases.push({ phase: 'search', status: 'start' });
    for (const step of skills.search.steps) {
      try {
        await executeStep(page, step, TEST_PROPERTY);
      } catch (e) {
        if (!step.optional) {
          result.phases[result.phases.length - 1].status = 'failed';
          result.phases[result.phases.length - 1].error = `${step.action}: ${e.message}`;
          throw e;
        }
      }
    }
    result.phases[result.phases.length - 1].status = 'ok';
    result.phases[result.phases.length - 1].url = page.url();

    // Take screenshot
    await page.screenshot({ path: `scripts/screenshots/${platformId}-search-result.png` });

    result.status = 'SEARCH_OK';

  } catch (e) {
    const lastPhase = result.phases[result.phases.length - 1];
    if (lastPhase.status === 'start') {
      lastPhase.status = 'failed';
      lastPhase.error = e.message;
    }
    result.status = `FAILED_${lastPhase.phase.toUpperCase()}`;
    result.error = lastPhase.error || e.message;
  } finally {
    await browser.close().catch(() => {});
  }

  return result;
}

async function main() {
  // All platforms except sumirin (RPA prohibited)
  const platforms = credentials.priority;

  console.log(`Testing search for ${platforms.length} platforms with property name "${TEST_PROPERTY}"...\n`);

  const results = [];
  for (const platformId of platforms) {
    process.stdout.write(`${platformId}: `);
    const result = await testPlatformSearch(platformId);
    results.push(result);

    if (result.status === 'RPA_PROHIBITED') {
      console.log('SKIP (RPA prohibited)');
    } else if (result.status === 'COMPLEX_NAV') {
      console.log('SKIP (complex navigation)');
    } else if (result.status === 'SEARCH_OK') {
      console.log('OK');
    } else {
      console.log(`${result.status} - ${result.error || ''}`);
    }
  }

  console.log('\n=== SUMMARY ===');
  const ok = results.filter(r => r.status === 'SEARCH_OK');
  const complexNav = results.filter(r => r.status === 'COMPLEX_NAV');
  const rpaProhibited = results.filter(r => r.status === 'RPA_PROHIBITED');
  const failed = results.filter(r => !['SEARCH_OK', 'RPA_PROHIBITED', 'SEARCH_DISABLED', 'NO_CONFIG', 'COMPLEX_NAV'].includes(r.status));

  console.log(`\n✅ OK (${ok.length}): ${ok.map(r => r.platformId).join(', ')}`);
  console.log(`⚠️ Complex Navigation (${complexNav.length}): ${complexNav.map(r => r.platformId).join(', ')}`);
  console.log(`🚫 RPA Prohibited (${rpaProhibited.length}): ${rpaProhibited.map(r => r.platformId).join(', ')}`);
  if (failed.length > 0) {
    console.log(`❌ Failed (${failed.length}):`);
    failed.forEach(r => {
      console.log(`  ${r.platformId}: ${r.status} - ${r.error || ''}`);
    });
  }
}

main().catch(console.error);
