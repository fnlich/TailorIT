#!/usr/bin/env node
/* global process, console, fetch, setTimeout */
// Re-records the small ATS fixtures the ingest tests read (apps/api/test/ingest-adapters.test.ts): a few real postings
// from public Greenhouse, Lever and Ashby boards, trimmed to the fields the adapters use. Run by hand when a board's
// response shape needs checking again: `node tools/ats-fixtures/record.mjs`. Needs network access; one request a second.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const USER_AGENT = 'TailorIT job ingest (fixture recording)';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const json = await response.json();
  await sleep(1000);
  return json;
}

function save(name, value) {
  writeFileSync(join(here, name), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${name}`);
}

function pick(object, keys) {
  return Object.fromEntries(keys.filter((key) => key in object).map((key) => [key, object[key]]));
}

/** Picks the wanted ids when they are still listed, else the first `count` postings. */
function choose(list, ids, count, idOf = (item) => item.id) {
  const wanted = ids.map((id) => list.find((item) => String(idOf(item)) === String(id))).filter(Boolean);
  return (wanted.length >= count ? wanted : list).slice(0, count);
}

const GREENHOUSE = 'https://boards-api.greenhouse.io/v1/boards/gitlab';
const gh = await getJson(`${GREENHOUSE}/jobs?content=true`);
const ghJobs = choose(gh.jobs, ['8687926002', '8860302002', '8716179002', '8638232002', '8889193002'], 5);
save('greenhouse-gitlab.json', { jobs: ghJobs, meta: { total: ghJobs.length } });
save('greenhouse-gitlab-board.json', await getJson(GREENHOUSE));
const payJob = ghJobs.find((job) => /United States/.test(job.location?.name ?? '')) ?? ghJobs[0];
const pay = await getJson(`${GREENHOUSE}/jobs/${payJob.id}?pay_transparency=true`);
save('greenhouse-gitlab-pay.json', pick(pay, ['id', 'title', 'absolute_url', 'pay_input_ranges']));

const lever = await getJson('https://api.lever.co/v0/postings/palantir?mode=json');
const leverKeys = ['id', 'text', 'categories', 'workplaceType', 'country', 'createdAt', 'hostedUrl', 'applyUrl',
  'description', 'descriptionPlain', 'lists', 'additional', 'salaryRange'];
const leverJobs = choose(lever, ['6ed76ce8-4156-4b60-b120-403538bd66cd', 'ab7e3425-81d5-4705-a7b5-cd60c8a45cdb',
  '1345438c-ebfc-4fa5-b545-30c1414f317c'], 3);
save('lever-palantir.json', leverJobs.map((posting) => pick(posting, leverKeys)));

const ashbyKeys = ['id', 'title', 'department', 'team', 'employmentType', 'location', 'secondaryLocations',
  'publishedAt', 'isListed', 'isRemote', 'workplaceType', 'address', 'jobUrl', 'applyUrl', 'descriptionHtml',
  'compensation'];
const linear = await getJson('https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=true');
const linearJobs = choose(linear.jobs, ['d3bc1ced-3ce4-4086-a050-555055dbb1ff', '12f8f208-0b9c-4569-bb3d-41c8a197029e',
  'b7669c4b-eeca-421d-ba9a-d90203f6fcb2', 'd062065e-05bb-42ce-a430-ec205695cc2e', 'f16dd5e9-ed10-4b8e-b5d7-1b8b5e3f002f'], 5);
save('ashby-linear.json', { jobs: linearJobs.map((job) => pick(job, ashbyKeys)), apiVersion: linear.apiVersion });
const ramp = await getJson('https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true');
const paid = ramp.jobs.filter((job) => job.compensation?.compensationTiers?.length && job.secondaryLocations?.length);
save('ashby-ramp.json', { jobs: paid.slice(0, 2).map((job) => pick(job, ashbyKeys)), apiVersion: ramp.apiVersion });
