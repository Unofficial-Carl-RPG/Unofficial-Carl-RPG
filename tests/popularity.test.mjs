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
