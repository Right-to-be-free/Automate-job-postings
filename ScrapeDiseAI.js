import { chromium } from "playwright";
import { Parser } from "json2csv";
import fs from "fs";

// Keywords we care about
const aiKeywords = [
  "AI",
  "Artificial Intelligence",
  "Machine Learning",
  "Deep Learning",
  "NLP",
  "Generative AI",
  "Data Scientist"
];

// Helper: Scrape Dice
async function scrapeDice(keyword, location, maxPages = 5) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const url = `https://www.dice.com/jobs?q=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}`;
  console.log(`🔎 Searching: "${keyword}" in ${location}`);
  await page.goto(url, { waitUntil: "networkidle" });

  let allJobs = [];
  let pageCount = 1;

  // Detect total pages
  let totalPages = await page.evaluate(() => {
    const section = document.querySelector('section[aria-label*="Page"]');
    if (!section) return 1;
    const match = section.getAttribute("aria-label").match(/of\\s+(\\d+)/);
    return match ? parseInt(match[1]) : 1;
  });
  console.log(`📊 Pages available: ${totalPages}`);

  // Loop through pages
  while (pageCount <= Math.min(maxPages, totalPages)) {
    console.log(`📄 Scraping page ${pageCount}...`);
    await page.waitForSelector('[data-testid="job-card"]', { timeout: 20000 });

    const jobs = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-testid="job-card"]');
      return Array.from(cards).map((card) => {
        const titleEl = card.querySelector('[data-testid="job-search-job-detail-link"]');
        const companyEl = card.querySelector('a[href*="/company-profile/"] p');
        const locationEl = card.querySelector("p.text-sm.font-normal.text-zinc-600");

        return {
          title: titleEl ? titleEl.innerText.trim() : null,
          company: companyEl ? companyEl.innerText.trim() : null,
          location: locationEl ? locationEl.innerText.trim() : null,
          link: titleEl ? titleEl.href : null,
          description: card.innerText // raw text to filter C2C later
        };
      });
    });

    allJobs = allJobs.concat(jobs);

    // Next button
    if (pageCount < Math.min(maxPages, totalPages)) {
      const nextBtn = await page.$('span[aria-label="Next"][role="link"]');
      if (!nextBtn) break;
      const ariaDisabled = await nextBtn.getAttribute("aria-disabled");
      if (ariaDisabled === "true") break;

      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle" }),
        nextBtn.click(),
      ]);
    }
    pageCount++;
  }

  await browser.close();
  return allJobs;
}

// Main runner
async function run() {
  let allResults = [];

  // 1. Boston AI jobs
  for (const kw of aiKeywords) {
    const results = await scrapeDice(kw, "Boston, MA", 3);
    results.forEach((job) => (job.category = "Boston AI"));
    allResults = allResults.concat(results);
  }

  // 2. Other US AI jobs (not Boston)
  for (const kw of aiKeywords) {
    const results = await scrapeDice(kw, "United States", 3);
    results
      .filter((job) => !job.location?.includes("Boston"))
      .forEach((job) => (job.category = "Other US AI"));
    allResults = allResults.concat(results);
  }

  // 3. C2C jobs
  const c2cResults = allResults.filter((job) =>
    /c2c|corp\s*to\s*corp/i.test(job.title + " " + job.description)
  );
  c2cResults.forEach((job) => (job.category = "C2C"));

  console.log(`✅ Total collected: ${allResults.length}`);
  console.log(`   - Boston AI: ${allResults.filter(j => j.category === "Boston AI").length}`);
  console.log(`   - Other US AI: ${allResults.filter(j => j.category === "Other US AI").length}`);
  console.log(`   - C2C: ${c2cResults.length}`);

  // Save to CSV
  const parser = new Parser();
  const csv = parser.parse(allResults);
  fs.writeFileSync(`ai_jobs_${Date.now()}.csv`, csv);

  console.log("💾 Results saved to CSV.");
}

run();
