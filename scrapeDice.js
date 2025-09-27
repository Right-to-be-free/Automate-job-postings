import { chromium } from "playwright";
import { Parser } from "json2csv";
import fs from "fs";

async function scrapeDice(keyword, location, maxPages = 20) {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const url = `https://www.dice.com/jobs?q=${encodeURIComponent(
    keyword
  )}&location=${encodeURIComponent(location)}`;
  console.log("🔎 Navigating to:", url);
  await page.goto(url, { waitUntil: "networkidle" });

  let allJobs = [];
  let pageCount = 1;

  // 🔎 Detect total pages (from "Page 1 of 11" section)
  let totalPages = 1;
  try {
    totalPages = await page.evaluate(() => {
      const section = document.querySelector('section[aria-label*="Page"]');
      if (!section) return 1;
      const match = section.getAttribute("aria-label").match(/of\s+(\d+)/);
      return match ? parseInt(match[1]) : 1;
    });
    console.log(`📊 Detected total pages: ${totalPages}`);
  } catch (e) {
    console.log("⚠️ Could not detect total pages, defaulting to 1");
  }

  // 📄 Scrape pages in a loop
  while (pageCount <= Math.min(maxPages, totalPages)) {
    console.log(`📄 Scraping page ${pageCount}...`);

    await page.waitForSelector('[data-testid="job-card"]', { timeout: 20000 });

    const jobs = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-testid="job-card"]');
      return Array.from(cards).map((card) => {
        const titleEl = card.querySelector(
          '[data-testid="job-search-job-detail-link"]'
        );
        const companyEl = card.querySelector('a[href*="/company-profile/"] p');
        const locationEl = card.querySelector(
          "p.text-sm.font-normal.text-zinc-600"
        );

        return {
          title: titleEl ? titleEl.innerText.trim() : null,
          company: companyEl ? companyEl.innerText.trim() : null,
          location: locationEl ? locationEl.innerText.trim() : null,
          link: titleEl ? titleEl.href : null,
        };
      });
    });

    console.log(`✅ Found ${jobs.length} jobs on page ${pageCount}`);
    allJobs = allJobs.concat(jobs);

    // 👉 Click Next button if there are more pages
    if (pageCount < Math.min(maxPages, totalPages)) {
      const nextBtn = await page.$('span[aria-label="Next"][role="link"]');
      if (nextBtn) {
        const ariaDisabled = await nextBtn.getAttribute("aria-disabled");
        if (ariaDisabled === "true") {
          console.log("⛔ Next button disabled, stopping.");
          break;
        }
        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle" }),
          nextBtn.click(),
        ]);
      } else {
        console.log("⛔ Next button not found, stopping.");
        break;
      }
    }

    pageCount++;
  }

  // 💾 Save results
  if (allJobs.length > 0) {
    const parser = new Parser();
    const csv = parser.parse(allJobs);
    const fileName = `jobs_${keyword.replace(/\s+/g, "_")}_${Date.now()}.csv`;
    fs.writeFileSync(fileName, csv);
    console.log(
      `✅ Saved ${allJobs.length} jobs across ${
        pageCount - 1
      } pages to ${fileName}`
    );
  } else {
    console.log("⚠️ No jobs found at all.");
  }

  await browser.close();
}

// ▶ Example run
scrapeDice("Data Analyst", "Boston, MA", 50);
