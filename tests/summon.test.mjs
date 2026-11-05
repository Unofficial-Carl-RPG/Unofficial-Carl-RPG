import { world, makeActor, makeItem, makeCrawler } from './stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runEvents } from '../module/helpers/events.mjs';
import { freeCells, findAnchor } from '../module/helpers/summon.mjs';

const gm = () => game.user;

beforeEach(() => {
  world.reset();
  delete gm().targets;
  delete Actor.implementation;
});

/* -------------------------------------------- */
/*  Fakes                                       */
/* -------------------------------------------- */

/** A scene with a 100px grid. `scene.add(data)` puts a token on it. */
function makeScene() {
  const scene = { id: 'S1', documentName: 'Scene', grid: { size: 100 }, tokens: [] };
  let n = 0;
  scene.add = (data = {}) => {
    const token = {
      id: `T${++n}`,
      documentName: 'Token',
      parent: scene,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      elevation: 0,
      hidden: false,
      actorId: '',
      ...data,
    };
    token.uuid = `Scene.S1.Token.${token.id}`;
    scene.tokens.push(token);
    world.docs[token.uuid] = token;
    return token;
  };
  scene.createEmbeddedDocuments = async (kind, datas) => datas.map((d) => scene.add(d));
  return scene;
}

/** A mob whose token follows its prototype (`size` is the token's width and height in cells). */
function makeMob(name = 'Goblin', { size = 1, link = false } = {}) {
  const mob = makeActor({ type: 'mob', name });
  mob.prototypeToken = { width: size, height: size };
  mob.getTokenDocument = async (data) => ({
    toObject: () => ({ name, actorId: mob.id, width: size, height: size, actorLink: link, ...data }),
  });
  world.docs[mob.uuid] = mob;
  game.actors.push(mob);
  return mob;
}

const summon = (over = {}) => ({
  id: 'e1',
  enabled: true,
  trigger: 'used',
  phase: 'any',
  conditions: [],
  match: 'all',
  actions: [
    {
      type: 'addToken',
      mode: '',
      uuid: '',
      amount: '1',
      targetActor: '',
      runOn: 'user',
      selfItem: false,
      skipIfHas: true,
      ignoreDR: false,
      ask: false,
      text: '',
      targetGroup: '',
      hidden: false,
      joinCombat: true,
      ...over,
    },
  ],
});

/** A crawler whose skill summons, standing on a scene with a token of its own at (500, 500). */
async function setup({ action = {}, trusted = false, owners = [] } = {}) {
  const scene = makeScene();
  const mob = makeMob();
  const skill = makeItem({
    type: 'skill',
    name: 'Summon',
    system: { rank: 1, events: [summon({ uuid: mob.uuid, ...action })], upgrades: [], eventsTrusted: trusted },
  });
  const crawler = await makeCrawler({ items: [skill], owners });
  crawler.token = scene.add({ x: 500, y: 500, actorId: crawler.id });
  return { scene, mob, skill, crawler };
}

const placed = (scene) => scene.tokens.filter((tk) => tk.actorId && tk.actorId !== '' && tk.name === 'Goblin');

/* -------------------------------------------- */
/*  Where tokens go                             */
/* -------------------------------------------- */

const at = (spots) => spots.map((s) => `${s.x},${s.y}`).sort();

test('free cells fill the squares next to the anchor first, then the corners', () => {
  const anchor = { x: 200, y: 200, width: 1, height: 1 };
  assert.deepEqual(at(freeCells({ anchor, count: 4, grid: 100 })), ['100,200', '200,100', '200,300', '300,200']);
  const five = freeCells({ anchor, count: 5, grid: 100 });
  assert.equal(five.length, 5);
  assert.ok(Math.abs(five[4].x - 200) === 100 && Math.abs(five[4].y - 200) === 100); // a corner
});

test('free cells skip occupied cells and never overlap each other', () => {
  const anchor = { x: 200, y: 200, width: 1, height: 1 };
  const occupied = [{ x: 300, y: 200, width: 1, height: 1 }];
  const spots = freeCells({ anchor, occupied, count: 4, grid: 100 });
  assert.ok(!at(spots).includes('300,200'));
  assert.equal(new Set(at(spots)).size, 4);
});

test('free cells keep clear of a large anchor and fit large tokens', () => {
  const anchor = { x: 200, y: 200, width: 2, height: 2 };
  const [spot] = freeCells({ anchor, size: { width: 2, height: 2 }, count: 1, grid: 100 });
  const apart =
    spot.x + 200 <= anchor.x || spot.x >= anchor.x + 200 || spot.y + 200 <= anchor.y || spot.y >= anchor.y + 200;
  assert.ok(apart);
  // The two big tokens touch rather than sit a gap apart.
  assert.ok(Math.abs(spot.x - 200) <= 200 && Math.abs(spot.y - 200) <= 200);
});

test('free cells give fewer than asked for when there is no room', () => {
  const anchor = { x: 0, y: 0, width: 1, height: 1 };
  const occupied = [{ x: -5000, y: -5000, width: 100, height: 100 }]; // a map-sized token
  assert.equal(freeCells({ anchor, occupied, count: 2, grid: 100, reach: 3 }).length, 0);
});

test('the anchor is the first targeted token, else the owner\'s token', async () => {
  const { scene, crawler } = await setup();
  assert.equal(findAnchor(crawler, []), crawler.token);
  const target = scene.add({ x: 900, y: 900 });
  assert.equal(findAnchor(crawler, [{ document: target }]), target);
  assert.equal(findAnchor(null, []), null);
  const bare = await makeCrawler({});
  assert.equal(findAnchor(bare, []), null);
});

/* -------------------------------------------- */
/*  The action                                  */
/* -------------------------------------------- */

test('an event places the actor\'s token next to the owner\'s token', async () => {
  const { scene, skill, crawler } = await setup();
  await runEvents(skill, 'used', {});
  const [token] = placed(scene);
  assert.ok(token);
  assert.equal(token.actorId, game.actors.find((a) => a.name === 'Goblin').id);
  assert.equal(token.hidden, false);
  // Touching the crawler's token, not on it.
  assert.ok(Math.abs(token.x - crawler.token.x) + Math.abs(token.y - crawler.token.y) === 100);
});

test('the amount is rolled and the tokens do not stack', async () => {
  const { scene, skill } = await setup({ action: { amount: '3' } });
  await runEvents(skill, 'used', {});
  const tokens = placed(scene);
  assert.equal(tokens.length, 3);
  assert.equal(new Set(tokens.map((tk) => `${tk.x},${tk.y}`)).size, 3);
  assert.ok(tokens.every((tk) => !(tk.x === 500 && tk.y === 500)));
});

test('a targeted token is used before the owner\'s', async () => {
  const { scene, skill } = await setup();
  const target = scene.add({ x: 1500, y: 1500 });
  gm().targets = new Set([{ document: target }]);
  await runEvents(skill, 'used', {});
  const [token] = placed(scene);
  assert.ok(Math.abs(token.x - 1500) + Math.abs(token.y - 1500) === 100);
});

test('hidden tokens and the anchor\'s elevation carry over', async () => {
  const { scene, skill, crawler } = await setup({ action: { hidden: true } });
  crawler.token.elevation = 10;
  await runEvents(skill, 'used', {});
  const [token] = placed(scene);
  assert.equal(token.hidden, true);
  assert.equal(token.elevation, 10);
});

test('tokens join the combat on their scene when the action says so', async () => {
  const joined = [];
  const combat = (scene) => ({
    scene,
    active: true,
    isOwner: true,
    createEmbeddedDocuments: async (kind, datas) => joined.push(...datas),
  });
  {
    const { scene, skill } = await setup({ action: { amount: '2' } });
    game.combats.push(combat(scene));
    await runEvents(skill, 'used', {});
    assert.equal(joined.length, 2);
    assert.deepEqual(
      joined.map((c) => c.tokenId).sort(),
      placed(scene).map((tk) => tk.id).sort()
    );
    assert.ok(joined.every((c) => c.sceneId === 'S1' && c.hidden === false));
  }
  joined.length = 0;
  world.reset();
  {
    const { scene, skill } = await setup({ action: { joinCombat: false } });
    game.combats.push(combat(scene));
    await runEvents(skill, 'used', {});
    assert.equal(placed(scene).length, 1);
    assert.equal(joined.length, 0);
  }
});

test('a combat on another scene is not joined', async () => {
  const joined = [];
  const { scene, skill } = await setup();
  game.combats.push({
    scene: { id: 'other' },
    active: true,
    isOwner: true,
    createEmbeddedDocuments: async (kind, datas) => joined.push(...datas),
  });
  await runEvents(skill, 'used', {});
  assert.equal(placed(scene).length, 1);
  assert.equal(joined.length, 0);
});

test('with nothing to place next to, it warns and adds nothing', async () => {
  const { scene, skill, crawler } = await setup();
  crawler.token = null;
  await runEvents(skill, 'used', {});
  assert.equal(placed(scene).length, 0);
  assert.deepEqual(world.warnings, ['CARL_RPG.Events.Warn.NoAnchor']);
});

test('a missing actor warns and adds nothing', async () => {
  const { scene, skill, mob } = await setup();
  delete world.docs[mob.uuid];
  await runEvents(skill, 'used', {});
  assert.equal(placed(scene).length, 0);
  assert.deepEqual(world.warnings, ['CARL_RPG.Events.Warn.ActorMissing']);
});

/* -------------------------------------------- */
/*  Permissions                                 */
/* -------------------------------------------- */

const player = (can) => ({ id: 'p1', name: 'Player', isGM: false, active: true, can: (p) => can.includes(p) });

test('a player who may create tokens places them directly', async () => {
  const { scene, skill } = await setup({ owners: ['p1'] });
  game.users.push(game.user, player(['TOKEN_CREATE']));
  game.user = game.users[1];
  await runEvents(skill, 'used', {});
  assert.equal(placed(scene).length, 1);
  assert.equal(world.chat.length, 0);
});

test('a player without the permission goes through the GM, if the events are approved', async () => {
  for (const trusted of [false, true]) {
    world.reset();
    const { scene, skill } = await setup({ owners: ['p1'], trusted });
    const p = player([]);
    game.users.push(gm(), p);
    game.users.activeGM = gm();
    game.user = p;
    await runEvents(skill, 'used', {});
    assert.equal(placed(scene).length, 0);
    if (trusted) {
      assert.equal(world.chat.length, 1);
      const relay = world.chat[0].flags['carl-rpg'].eventRelay;
      assert.equal(relay.actionIndex, 0);
      assert.equal(relay.anchorUuid, 'Scene.S1.Token.T1');
    } else {
      assert.equal(world.chat.length, 0);
      assert.equal(world.warnings.length, 1);
    }
  }
});

test('an actor the player does not own, or a combat they do not own, goes through the GM', async () => {
  const relayed = async (change) => {
    world.reset();
    const { scene, skill, mob } = await setup({ owners: ['p1'], trusted: true });
    const p = player(['TOKEN_CREATE']);
    game.users.push(gm(), p);
    game.users.activeGM = gm();
    game.user = p;
    change({ scene, mob });
    await runEvents(skill, 'used', {});
    return world.chat.length === 1 && placed(scene).length === 0;
  };
  assert.equal(await relayed(({ mob }) => (mob.isOwner = false)), true);
  assert.equal(
    await relayed(({ scene }) => game.combats.push({ scene, active: true, isOwner: false })),
    true
  );
});

/* -------------------------------------------- */
/*  Compendium actors                           */
/* -------------------------------------------- */

test('a compendium actor is imported once, then reused', async () => {
  const { scene, skill, mob } = await setup({ action: { amount: '1' } });
  // Move the mob into a compendium.
  world.docs[mob.uuid] = undefined;
  game.actors.length = 0;
  const source = makeMob('Goblin');
  game.actors.length = 0;
  source.inCompendium = true;
  source.uuid = 'Compendium.pack.Actor.goblin';
  world.docs[source.uuid] = source;
  skill.system.events[0].actions[0].uuid = source.uuid;

  let imports = 0;
  game.actors.fromCompendium = (doc) => ({ name: doc.name, _stats: { compendiumSource: doc.uuid } });
  Actor.implementation = {
    create: async (data) => {
      imports++;
      const copy = makeMob(data.name);
      copy._stats = data._stats;
      return copy;
    },
  };
  await runEvents(skill, 'used', {});
  await runEvents(skill, 'used', {});
  assert.equal(imports, 1);
  assert.equal(placed(scene).length, 2);
});

/* -------------------------------------------- */
/*  Menus, summaries and text                   */
/* -------------------------------------------- */

test('the action is in the menu, summarised, and every key it uses has text', async () => {
  const { readFileSync } = await import('node:fs');
  const { summarizeAction } = await import('../module/helpers/event-summary.mjs');
  const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
  const text = (key) => key.split('.').reduce((o, k) => o?.[k], lang);

  assert.equal(CONFIG.CARL_RPG.eventActions.addToken, 'CARL_RPG.Events.Actions.addToken');
  const keys = [
    CONFIG.CARL_RPG.eventActions.addToken,
    'CARL_RPG.Events.Summary.Act.addToken',
    'CARL_RPG.Events.Summary.Act.addTokenHidden',
    'CARL_RPG.Events.Drop.tokenActor',
    'CARL_RPG.Events.TokenHidden',
    'CARL_RPG.Events.TokenJoinCombat',
    'CARL_RPG.Events.TokenNextTo',
    'CARL_RPG.Events.Warn.ActorMissing',
    'CARL_RPG.Events.Warn.NoAnchor',
    'CARL_RPG.Events.Warn.NoRoom',
  ];
  for (const key of keys) assert.equal(typeof text(key), 'string', key);

  const plain = await summarizeAction({ type: 'addToken', amount: '2', uuid: '', hidden: false, targetGroup: 'allies' });
  const secret = await summarizeAction({ type: 'addToken', amount: '2', uuid: '', hidden: true });
  assert.match(plain, /Summary\.Act\.addToken /);
  assert.match(secret, /Summary\.Act\.addTokenHidden/);
  assert.ok(!plain.includes('allies')); // who it affects doesn't apply here
});
