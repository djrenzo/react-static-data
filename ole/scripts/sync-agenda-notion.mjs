// scripts/sync-agenda-notion.mjs
//
// Queries a Notion database and writes its rows out as agenda.json in the
// shape the site expects. Run via the accompanying GitHub workflow.
//
// Required env vars:
//   NOTION_TOKEN        - Notion integration token (secret)
//   NOTION_DATABASE_ID  - the database to query
//
// Optional env vars (only needed if your Notion property names differ from
// the defaults below):
//   NOTION_TITLE_PROPERTY   (default: "title")
//   NOTION_DATE_PROPERTY    (default: "date")
//   NOTION_LABEL_PROPERTY   (default: "ButtonLabel")
//   NOTION_URL_PROPERTY     (default: "URL")
//   OUTPUT_PATH             (default: "ole/agenda.json")

import { writeFile, mkdir } from "fs/promises";
import path from "path";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const NOTION_VERSION = "2022-06-28";

const TITLE_PROPERTY = process.env.NOTION_TITLE_PROPERTY || "Title";
const DATE_PROPERTY = process.env.NOTION_DATE_PROPERTY || "Date";
const LABEL_PROPERTY = process.env.NOTION_LABEL_PROPERTY || "ButtonLabel";
const URL_PROPERTY = process.env.NOTION_URL_PROPERTY || "URL";

const OUTPUT_PATH = process.env.OUTPUT_PATH || "ole/agenda.json";

const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const DEFAULT_CTA_LABEL = "Apuntarse";
const DEFAULT_CTA_HREF = "#contacto";

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error("NOTION_TOKEN and NOTION_DATABASE_ID are required.");
  process.exit(1);
}

function getTitleText(page, propName) {
  const prop = page.properties[propName];
  const arr = prop?.title;
  if (!Array.isArray(arr)) return "";
  return arr.map((t) => t.plain_text).join("");
}

function getRichText(page, propName) {
  const prop = page.properties[propName];
  const arr = prop?.rich_text;
  if (!Array.isArray(arr)) return "";
  return arr.map((t) => t.plain_text).join("");
}

function getUrl(page, propName) {
  const prop = page.properties[propName];
  return prop?.url ?? null;
}

function getDateStart(page, propName) {
  const prop = page.properties[propName];
  return prop?.date?.start ?? null;
}

// Split the date string manually instead of using `new Date(...)` to avoid
// timezone-shift bugs - Notion date-only values are plain "YYYY-MM-DD" and
// JS Date parsing/local-time conversion can shift the day depending on the
// runner's timezone.
function splitDate(dateStr) {
  const datePart = dateStr.split("T")[0]; // "2026-05-18"
  const [year, month, day] = datePart.split("-");
  return { year, month, day };
}

async function queryDatabase() {
  const results = [];
  let cursor;
  let hasMore = true;

  while (hasMore) {
    const body = {
      page_size: 100,
      sorts: [{ property: DATE_PROPERTY, direction: "descending" }],
    };
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Notion API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    results.push(...data.results);
    hasMore = data.has_more;
    cursor = data.next_cursor;
  }

  return results;
}

function transformPage(page) {
  const dateStart = getDateStart(page, DATE_PROPERTY);
  if (!dateStart) {
    console.warn(`Skipping page ${page.id} - no value in "${DATE_PROPERTY}" property.`);
    return null;
  }

  const { year, month, day } = splitDate(dateStart);
  const monthIndex = parseInt(month, 10) - 1;
  const monthLabel = MONTH_NAMES_ES[monthIndex] || month;

  const title = getTitleText(page, TITLE_PROPERTY);
  const ctaLabel = getRichText(page, LABEL_PROPERTY) || DEFAULT_CTA_LABEL;
  const ctaHref = getUrl(page, URL_PROPERTY) || DEFAULT_CTA_HREF;

  return { day, month, monthLabel, year, title, ctaLabel, ctaHref };
}

async function main() {
  console.log(`Querying Notion database ${NOTION_DATABASE_ID}...`);
  const pages = await queryDatabase();
  console.log(`Fetched ${pages.length} row(s).`);

  const agenda = pages
    .map(transformPage)
    .filter((item) => item !== null);

  const outDir = path.dirname(OUTPUT_PATH);
  if (outDir && outDir !== ".") {
    await mkdir(outDir, { recursive: true });
  }

  await writeFile(OUTPUT_PATH, JSON.stringify(agenda, null, 2) + "\n", "utf-8");
  console.log(`Wrote ${agenda.length} item(s) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
