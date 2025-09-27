import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  const browser = await chromium.launch({ headless: false }); // show browser for debugging
  const page = await browser.newPage();

  try {
    // Step 1: Go to Dice search
    await page.goto("https://www.dice.com/jobs?q=Data+Analyst&location=Boston%2C%20MA", { waitUntil: 'domcontentloaded' });

    // Dismiss cookie banner if present
    try {
      const acceptBtn = await page.$('button:has-text("Accept all"), button:has-text("Accept")');
      if (acceptBtn) await acceptBtn.click().catch(() => {});
    } catch (e) {}

    // Step 2: Wait for job cards
    await page.waitForSelector('[data-testid="job-card"]', { timeout: 30000 });

    // Scan the top 5 result pages and collect job-detail links (deduplicated)
    // Assumption: Dice supports a `page` query parameter (e.g. &page=2). If that changes, we can switch to clicking the pagination controls.
    const results = [];
    const visited = new Set();

    // helper to process a single job link safely
    async function processLink(link, pageNum, idx) {
      const detailPage = await browser.newPage();
      try {
        await detailPage.goto(link, { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
        console.log(`Visiting (page ${pageNum}): ${link}`);

        // attempt to dismiss any cookie prompt on detail page
        try { const c = await detailPage.$('button:has-text("Accept all"), button:has-text("Accept")'); if(c) await c.click().catch(()=>{}); } catch(e){}

        // take a full-page screenshot per your request
        const ts = Date.now();
        const screenshotName = `screenshot_page${pageNum}_job${idx + 1}_${ts}.png`;
        const screenshotPath = path.join(__dirname, screenshotName);
        await detailPage.screenshot({ path: screenshotPath, fullPage: true }).catch(()=>{});

        // Look for Easy Apply / Easy apply / Easy Apply button variations
        const easyApply = await detailPage.$('button:has-text("Easy apply"), button:has-text("Easy Apply"), button:has-text("Easy Apply Now")');
        if (easyApply) {
          console.log('Easy Apply detected');
          results.push({ link, page: pageNum, status: 'Easy Apply', screenshot: screenshotPath });
        } else {
          console.log('No Easy Apply on page');
          results.push({ link, page: pageNum, status: 'No Easy Apply', screenshot: screenshotPath });
        }
      } catch (err) {
        console.error(`Error on ${link}:`, err.message);
        const screenshotPath = path.join(__dirname, `dice_error_page${pageNum}_job${idx + 1}.png`);
        await detailPage.screenshot({ path: screenshotPath, fullPage: true }).catch(()=>{});
        results.push({ link, page: pageNum, status: 'Error', error: err.message, screenshot: screenshotPath });
      } finally {
        await detailPage.close().catch(()=>{});
      }
    }

    for (let pageNum = 1; pageNum <= 5; pageNum++) {
      const pageUrl = `https://www.dice.com/jobs?q=Data+Analyst&location=Boston%2C%20MA&page=${pageNum}`;
      console.log(`Navigating to search page ${pageNum}: ${pageUrl}`);
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded' }).catch(()=>{});

      // dismiss cookies if present on search page
      try { const acceptBtn = await page.$('button:has-text("Accept all"), button:has-text("Accept")'); if (acceptBtn) await acceptBtn.click().catch(()=>{}); } catch(e){}

      // wait for job cards
      try {
        await page.waitForSelector('[data-testid="job-card"]', { timeout: 15000 });
      } catch (e) {
        console.warn(`No job cards detected on search page ${pageNum}`);
        continue;
      }

      // collect links on this page (limit to first 10 to keep run time reasonable)
      const linksOnPage = await page.$$eval('[data-testid="job-card"] a', els =>
        els.map(el => el.href).filter(h => h && h.includes('/job-detail/')).slice(0, 10)
      );

      console.log(`Found ${linksOnPage.length} job links on page ${pageNum}`);

      for (let idx = 0; idx < linksOnPage.length; idx++) {
        const link = linksOnPage[idx];
        if (visited.has(link)) continue;
        visited.add(link);
        await processLink(link, pageNum, idx);
      }

      // small delay between pages to avoid overloading the site or local resources
      await page.waitForTimeout(500);
    }

    // save results to file
    const outPath = path.join(__dirname, 'dice_apply_results.json');
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
    console.log('Saved results to', outPath);
    console.log('Summary:', results);
  } catch (err) {
    console.error('Fatal error:', err.message);
  } finally {
    await browser.close();
  }
})();
