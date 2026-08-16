'use strict';

// script.js exports its pure parts under node and only starts the UI in a
// browser, so the config parsing / list splitting can be tested without a DOM.

const test = require('node:test');
const assert = require('node:assert/strict');
const {readConfig, parseSource, splitLists, normalizeName, world} = require('../script.js');

test('the script link becomes the text of the source field', () => {
    assert.equal(readConfig('https://x/script.js?tribes=SNTX,G-F'), 'SNTX,G-F');
    assert.equal(readConfig('https://x/script.js'), '');
    assert.equal(
        readConfig('https://x/script.js?thread=32&post=184'),
        '/game.php?screen=forum&screenmode=view_thread&thread_id=32&page=0#184'
    );
});

test('a forum url can be pasted into the link as-is', () => {
    // the council copies the address bar: unencoded "&" splits into params and
    // the post anchor arrives as a fragment - both still have to survive
    const url = 'https://zz1.tribalwars.works/game.php' +
        '?village=3350&screen=forum&screenmode=view_thread&thread_id=32&page=0#184';

    assert.deepEqual(parseSource(readConfig('https://x/script.js?thread=' + url)).thread,
        {id: '32', post: '184'});
    assert.deepEqual(parseSource(readConfig('https://x/script.js?thread=' + encodeURIComponent(url))).thread,
        {id: '32', post: '184'});
});

test('the source field takes tags or a thread address', () => {
    assert.deepEqual(parseSource('SNTX, G-F'), {tribes: ['SNTX', 'G-F'], thread: null});
    assert.deepEqual(parseSource(''), {tribes: [], thread: null});
    assert.deepEqual(parseSource('/game.php?screen=forum&thread_id=7&page=0').thread,
        {id: '7', post: null});
});

test('names from the world data files are decoded', () => {
    assert.equal(normalizeName('cel+micut'), 'cel micut');
    assert.equal(normalizeName('a%20V%20a'), 'a V a');
    assert.equal(normalizeName('50%+off'), '50% off');   // stray % stays as typed
});

test('the world files answer nickname, tribe tag and tag -> tribe id', () => {
    const w = world(
        '2101,Dux2311,44,8,87106,26\n5322,cel+micut,0,3,88,100',
        '2,Syntax+Sentinels,SNTX,6,1902,1,1,1\n44,Gone+Fishing,G-F,1,2,3,4,5'
    );
    assert.deepEqual(w.players['2101'], {name: 'Dux2311', tribeId: '44', tribe: 'G-F'});
    assert.deepEqual(w.players['5322'], {name: 'cel micut', tribeId: '0', tribe: ''});   // tribe 0 = no tribe
    assert.equal(w.tribes['sntx'], '2');
    assert.equal(w.tribes['g-f'], '44');
});

let nextId = 100;
const player = name => {
    const id = String(nextId++);
    return {id, name, profileUrl: '/game.php?screen=info_player&id=' + id};
};

// a row off the friends screen: same player, but the app hands over a whole
// table of text where the nickname belongs - only the id can be trusted
const row = (player, extra) => Object.assign({
    id: player.id,
    name: 'Name Rank Points Tribe ' + player.name,
    profileUrl: player.profileUrl,
    remove: {url: '/drop?' + player.id, method: 'GET'},
    note: 'Friends'
}, extra || {});

const me = {id: '1', name: 'tilaven'};

test('three lists: to invite, already there, outsiders', () => {
    const gnedler = player('Gnedler');
    const stranger = player('Randomek');
    const lists = splitLists(
        [gnedler, player('HomerJ'), {id: me.id, name: me.name}],
        [row(gnedler), row(stranger)],
        me
    );

    assert.deepEqual(lists.toInvite.map(e => [e.name, e.kind]), [['HomerJ', 'invite']]);
    assert.deepEqual(lists.already.map(e => e.id), [gnedler.id]);      // yourself is skipped
    assert.deepEqual(lists.outsiders.map(e => [e.id, e.kind]), [[stranger.id, 'remove']]);
    assert.ok(lists.toInvite[0].profileUrl, 'invite rows keep the profile link');
});

test('players are matched by profile id, never by the text of a row', () => {
    // the nickname on the row is unusable in the app, the id is not
    const homer = player('HomerJ');
    const lists = splitLists([homer], [row(homer)], me);
    assert.equal(lists.toInvite.length, 0);
    assert.equal(lists.outsiders.length, 0);
    assert.deepEqual(lists.already.map(e => e.id), [homer.id]);
});

test('a suggested player is not on the list yet, so he stays up for invite', () => {
    // suggestions are dropped while parsing (they only carry an add_buddy link),
    // so splitLists never sees them
    const lists = splitLists([player('Gnedler')], [], me);
    assert.deepEqual(lists.toInvite.map(e => e.kind), ['invite']);
    assert.equal(lists.already.length, 0);
});

test('somebody who invited us lands on the first list, to accept', () => {
    // in a tribe we are looking for, and still on the first list - not the second
    const rosario = player('Rosario');
    const request = row(rosario, {
        accept: {url: '/accept?1', method: 'GET'},
        remove: {url: '/decline?1', method: 'GET'},
        note: 'Requests'
    });

    const wanted = splitLists([rosario], [request], me);
    assert.deepEqual(wanted.toInvite.map(e => [e.id, e.kind]), [[rosario.id, 'accept']]);
    assert.equal(wanted.already.length, 0);
    assert.equal(wanted.outsiders.length, 0);

    // a request from somebody we are not looking for is not worth accepting -
    // it goes down to the outsiders, where removing it declines the request
    const unwanted = splitLists([], [request], me);
    assert.equal(unwanted.toInvite.length, 0);
    assert.deepEqual(unwanted.outsiders.map(e => [e.id, e.kind]), [[rosario.id, 'remove']]);
});

test('your own account never lands on any list', () => {
    const lists = splitLists([{id: me.id, name: me.name}], [], me);
    assert.equal(lists.toInvite.length + lists.already.length + lists.outsiders.length, 0);
});
