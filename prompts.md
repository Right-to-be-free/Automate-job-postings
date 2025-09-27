Open https://www.dice.com/jobs?q=Data+Analyst&location=Boston%2C%20MA in Chromium.
Wait until [data-testid="job-card"] elements are visible.
Extract the first 5 job cards with:
- title: innerText of [data-testid="job-search-job-detail-link"]
- company: innerText of a[href*="/company-profile/"], or fallback to any company element if missing
- location: innerText of p.text-sm.font-normal.text-zinc-600
- link: href of [data-testid="job-search-job-detail-link"]
For each link, open the job detail page in a new tab, click any "Show more" button if present, wait for the description container, and extract:
- description: main content text
- postedDate: any element showing when the job was posted
- salary: if available, text of salary element
- jobType: if available, text of employment type element
Return a single JSON array of up to 5 job objects.
