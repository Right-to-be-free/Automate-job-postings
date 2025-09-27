import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Assumptions:
// - We'll search LinkedIn for "Data Analyst" across United States and collect up to 100 job postings.
// - Some job pages may be gated (require sign-in). Gated listings will be recorded with minimal metadata.
// - Categorization rules (case-insensitive):
//    - Boston jobs: location contains 'boston' or 'ma' or 'massachusetts'
//    - AI jobs: title or description contains 'ai', 'machine learning', 'artificial intelligence', 'ml'
//    - Analyst jobs: title contains 'analyst'

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const outPath = path.join(__dirname, 'linkedin_top100_categorized.json');
  const results = [];

  try {
    const searchUrl = 'https://www.linkedin.com/jobs/search?keywords=Data%20Analyst&location=United%20States';
    console.log('Opening LinkedIn search:', searchUrl);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // wait for results container
    try {
      await page.waitForSelector('ul.jobs-search__results-list, .jobs-search-results__list', { timeout: 15000 });
    } catch (e) {
      console.warn('Could not find LinkedIn results list selector; continuing to attempt collection.');
    }

    // Scroll & collect links until we have 100 or reach max attempts
    const maxWanted = 100;
    const links = new Set();
    let attempts = 0;
    while (links.size < maxWanted && attempts < 30) {
      // collect current links
      const found = await page.$$eval('ul.jobs-search__results-list li a, .jobs-search-results__list li a', els =>
        els.map(a => a.href).filter(h => h && h.includes('/jobs/view/'))
      ).catch(() => []);

      found.forEach(h => links.add(h));

      // scroll container or page to load more
      await page.evaluate(() => {
        const container = document.querySelector('.jobs-search-results__list, ul.jobs-search__results-list');
        if (container) container.scrollBy(0, container.scrollHeight || 1000);
        else window.scrollBy(0, window.innerHeight);
      }).catch(()=>{});

      await page.waitForTimeout(800);
      attempts++;
    }

    const jobLinks = Array.from(links).slice(0, maxWanted);
    console.log(`Collected ${jobLinks.length} job links`);

    // Helper extract function per job
    async function extractJob(link, idx) {
      const job = { link };
      const p = await browser.newPage();
      try {
        await p.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
        // dismiss any cookie
        try { const btn = await p.$('button:has-text("Accept all"), button:has-text("Accept")'); if (btn) await btn.click().catch(()=>{}); } catch(e){}

        // title
        let title = '';
        try {
          title = (await p.$eval('h1', el => el.innerText.trim())).slice(0, 500);
        } catch (e) {
          try { title = (await p.$eval('.topcard__title, .jobs-unified-top-card__job-title', el => el.innerText.trim())).slice(0,500); } catch(e2){}
        }
        job.title = title || null;

        // company
        let company = null;
        try { company = await p.$eval('a.topcard__org-name-link, a.jobs-unified-top-card__company-url, .topcard__flavor a', el => el.innerText.trim()); } catch(e){
          try { company = await p.$eval('.topcard__flavor', el => el.innerText.trim()); } catch(e2){}
        }
        job.company = company || null;

        // location
        let location = null;
        try { location = await p.$eval('.topcard__flavor--bullet, .jobs-unified-top-card__bullet', el => el.innerText.trim()); } catch(e){
          try { location = await p.$eval('.jobs-unified-top-card__subtitle-primary-grouping > span', el => el.innerText.trim()); } catch(e2){}
        }
        job.location = location || null;

        // posted date
        try { job.posted = await p.$eval('span.posted-time-ago__text, .posted-time-ago__text, .jobs-unified-top-card__posted-date', el => el.innerText.trim()); } catch(e){}

        // description (may be gated)
        let description = null;
        try {
          description = await p.$eval('.show-more-less-html__markup, .jobs-description__content, .description__text, .job-description', el => el.innerText.trim());
        } catch (e) {
          // fallback to main text
          try { description = await p.$eval('main', el => el.innerText.trim()).catch(()=>null); } catch(e2){}
        }
        job.description = description || null;

        // detect gating
        if (!description) {
          // check if sign-in gate present
          const gate = await p.$('div[role="dialog"], .sign-in-outlet, .sign-in-form');
          if (gate) job.gated = true;
          else job.gated = false;
        } else {
          job.gated = false;
        }

        // take small screenshot for record (optional)
        const shot = `li_job_${idx + 1}_${Date.now()}.png`;
        try { await p.screenshot({ path: path.join(__dirname, shot), fullPage: true }); job.screenshot = shot; } catch(e){}

      } catch (err) {
        job.error = err.message;
      } finally {
        await p.close().catch(()=>{});
      }

      return job;
    }

    // iterate sequentially (to be gentle)
    for (let i = 0; i < jobLinks.length; i++) {
      console.log(`Processing ${i + 1}/${jobLinks.length}`);
      const job = await extractJob(jobLinks[i], i);
      results.push(job);
      // small delay
      await page.waitForTimeout(300);
    }

    // Categorize
    const boston_jobs = [];
    const other_state_jobs = [];
    const ai_jobs = [];
    const analyst_jobs = [];

    const aiRegex = /\b(ai|machine learning|artificial intelligence|ml)\b/i;
    const analystRegex = /\banalyst\b/i;

    for (const j of results) {
      const title = (j.title || '') + '';
      const desc = (j.description || '') + '';
      const loc = (j.location || '') + '';

      const isBoston = /boston|massachusetts|\bma\b/i.test(loc);
      if (isBoston) boston_jobs.push(j);
      else other_state_jobs.push(j);

      if (aiRegex.test(title) || aiRegex.test(desc)) ai_jobs.push(j);
      if (analystRegex.test(title)) analyst_jobs.push(j);
    }

    const out = {
      generatedAt: new Date().toISOString(),
      totalCollected: results.length,
      boston_jobs,
      other_state_jobs,
      ai_jobs,
      analyst_jobs,
      all_jobs: results
    };

    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log('Saved categorized results to', outPath);

  } catch (err) {
    console.error('Fatal error during LinkedIn scrape:', err.message);
    // save partial results if available
    try { fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), partial: true, results }, null, 2), 'utf8'); } catch(e){}
  } finally {
    await browser.close().catch(()=>{});
  }

  process.exit(0);
})();
