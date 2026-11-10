import './stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Crawler from '../module/data/actor-crawler.mjs';

/*
 * Popularity is a plain number on the crawler (system.popularity, granted or removed by the GM
 * in Dungeon Info), not a Bio text box. The schema itself can't be inspected under the stubs
 * (fields are inert), so these cover what load-time migration does to the old text.
 */

test('old popularity text is dropped on load', () => {
  const source = { background: { pastTrauma: 'x', popularity: 'Famous', looseEnds: '', regrets: '' } };
  Crawler.migrateData(source);
  assert.equal('popularity' in source.background, false);
  assert.equal(source.background.pastTrauma, 'x');
  assert.equal(source.popularity, undefined, 'the text is not turned into a number');
});

test('data from before Bio moved still loses the popularity text', () => {
  // The oldest crawlers kept the Bio text under `hotlist`.
  const source = { hotlist: { pastTrauma: 'x', popularity: 'Famous', looseEnds: '', regrets: '' } };
  Crawler.migrateData(source);
  assert.equal('popularity' in source.background, false);
  assert.deepEqual(source.hotlist, {});
});

test('a crawler with a popularity number keeps it', () => {
  const source = { popularity: 7, background: {} };
  Crawler.migrateData(source);
  assert.equal(source.popularity, 7);
});

/* -------------------------------------------- */
/*  Granting (Dungeon Info, /popularity, macros) */
/* -------------------------------------------- */

import { world, makeActor, makeItem, makeCrawler } from './stubs.mjs';
import { beforeEach } from 'node:test';
import { grantNumber } from '../module/helpers/grants.mjs';
import { runActorEvents } from '../module/helpers/events.mjs';

beforeEach(() => world.reset());

test('granting popularity adds it and says so in chat', async () => {
  const crawler = await makeCrawler({ system: { popularity: 2 } });
  const total = await grantNumber(crawler, 'popularity', 3);
  assert.equal(total, 5);
  assert.equal(crawler.system.popularity, 5);
  assert.equal(world.chat.length, 1);
  assert.match(world.chat[0].content, /CARL_RPG\.GMTab\.PopularityAwarded/);
  assert.match(world.chat[0].content, /"amount":3,"total":5/);
});

test('taking popularity away stops at 0 and says it was lost', async () => {
  const crawler = await makeCrawler({ system: { popularity: 2 } });
  const total = await grantNumber(crawler, 'popularity', -5);
  assert.equal(total, 0);
  assert.equal(crawler.system.popularity, 0);
  assert.match(world.chat[0].content, /CARL_RPG\.GMTab\.PopularityLost/);
  assert.match(world.chat[0].content, /"amount":5,"total":0/);
});

test('AI favor goes through the same grant with its own chat line', async () => {
  const crawler = await makeCrawler({ system: { aiFavor: 1 } });
  assert.equal(await grantNumber(crawler, 'aiFavor', 2), 3);
  assert.equal(crawler.system.aiFavor, 3);
  assert.match(world.chat[0].content, /CARL_RPG\.GMTab\.FavorAwarded/);
});

test('nothing is granted for a zero or fractional-zero amount, a mob or an unknown field', async () => {
  const crawler = await makeCrawler({ system: { popularity: 1 } });
  assert.equal(await grantNumber(crawler, 'popularity', 0), null);
  assert.equal(await grantNumber(crawler, 'popularity', 'abc'), null);
  assert.equal(await grantNumber(crawler, 'gold', 5), null);
  const mob = makeActor({ type: 'mob', system: {} });
  assert.equal(await grantNumber(mob, 'popularity', 1), null);
  assert.equal(crawler.system.popularity, 1);
  assert.equal(world.chat.length, 0);
});

test('a fractional amount is cut to a whole number', async () => {
  const crawler = await makeCrawler({ system: { popularity: 0 } });
  assert.equal(await grantNumber(crawler, 'popularity', 2.9), 2);
});

/* -------------------------------------------- */
/*  The Popularity event action                 */
/* -------------------------------------------- */

const withActions = (...actions) =>
  makeItem({
    type: 'skill',
    name: 'Skill',
    system: {
      rank: 1,
      upgrades: [],
      events: [{ id: 'e1', enabled: true, trigger: 'used', phase: 'any', conditions: [], match: 'all', actions }],
    },
  });

test('the Popularity event action awards and removes it, never below 0', async () => {
  const item = withActions(
    { type: 'popularity', mode: 'award', amount: '4' },
    { type: 'popularity', mode: 'remove', amount: '1' }
  );
  const crawler = await makeCrawler({ items: [item], system: { popularity: 0 } });
  await runActorEvents(crawler, 'used');
  assert.equal(crawler.system.popularity, 3);

  const drain = withActions({ type: 'popularity', mode: 'remove', amount: '10' });
  const other = await makeCrawler({ items: [drain], system: { popularity: 2 } });
  await runActorEvents(other, 'used');
  assert.equal(other.system.popularity, 0);
});

test('the Popularity event action takes a formula and leaves AI favor alone', async () => {
  const item = withActions({ type: 'popularity', mode: 'award', amount: '1 + 2' });
  const crawler = await makeCrawler({ items: [item], system: { popularity: 0, aiFavor: 7 } });
  await runActorEvents(crawler, 'used');
  assert.equal(crawler.system.popularity, 3);
  assert.equal(crawler.system.aiFavor, 7);
});
