'use strict';

// script.js exports its pure parts under node and only starts the UI in a
// browser, so the config parsing / list splitting can be tested without a DOM.

const test = require('node:test');
const assert = require('node:assert/strict');
const {readConfig, parseSource, splitLists, normalizeName, allyTags, playerTags} = require('../script.js');

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

test('ally.txt maps a tag to its tribe id', () => {
    const tags = allyTags('2,Syntax+Sentinels,SNTX,6,1902,1,1,1\n44,Gone+Fishing,G-F,1,2,3,4,5');
    assert.equal(tags['sntx'], '2');
    assert.equal(tags['g-f'], '44');
});

test('the world data files say which tribe a player is in', () => {
    const tribes = playerTags(
        '2101,Dux2311,44,8,87106,26\n5322,cel+micut,0,3,88,100',
        '2,Syntax+Sentinels,SNTX,6,1902,1,1,1\n44,Gone+Fishing,G-F,1,2,3,4,5'
    );
    assert.equal(tribes['dux2311'], 'G-F');
    assert.equal(tribes['cel micut'], '');       // tribe 0 means no tribe
});

const player = name => ({name, profileUrl: '/game.php?screen=info_player&id=' + name.length});

test('three lists: to invite, already there, outsiders', () => {
    const rows = [
        {name: 'Gnedler', remove: {url: '/drop?1', method: 'GET'}, note: 'Friends'},
        {name: 'Randomek', remove: {url: '/drop?2', method: 'GET'}, note: 'Friends'}
    ];
    const lists = splitLists([player('Gnedler'), player('HomerJ'), player('tilaven')], rows, 'tilaven');

    assert.deepEqual(lists.toInvite.map(e => [e.name, e.kind]), [['HomerJ', 'invite']]);
    assert.deepEqual(lists.already.map(e => e.name), ['Gnedler']);      // yourself is skipped
    assert.deepEqual(lists.outsiders.map(e => [e.name, e.kind]), [['Randomek', 'remove']]);
    assert.ok(lists.toInvite[0].profileUrl, 'invite rows keep the profile link');
});

test('a suggested player is not on the list yet, so he stays up for invite', () => {
    // suggestions are dropped while parsing (they only carry an add_buddy link),
    // so splitLists never sees them
    const lists = splitLists([player('Gnedler')], [], 'me');
    assert.deepEqual(lists.toInvite.map(e => [e.name, e.kind]), [['Gnedler', 'invite']]);
    assert.equal(lists.already.length, 0);
});

test('somebody who invited us lands on the first list, to accept', () => {
    // in a tribe we are looking for, and still on the first list - not the second
    const rows = [{
        name: 'Rosario',
        accept: {url: '/accept?1', method: 'GET'},
        remove: {url: '/decline?1', method: 'GET'},
        note: 'Requests'
    }];

    const wanted = splitLists([player('Rosario')], rows, 'me');
    assert.deepEqual(wanted.toInvite.map(e => [e.name, e.kind]), [['Rosario', 'accept']]);
    assert.equal(wanted.already.length, 0);
    assert.equal(wanted.outsiders.length, 0);

    // a request from somebody we are not looking for is not worth accepting -
    // it goes down to the outsiders, where removing it declines the request
    const stranger = splitLists([], rows, 'me');
    assert.equal(stranger.toInvite.length, 0);
    assert.deepEqual(stranger.outsiders.map(e => [e.name, e.kind]), [['Rosario', 'remove']]);
});

test('matching ignores case and encoding differences', () => {
    const lists = splitLists([player('cel+micut')], [{name: 'Cel Micut', remove: {url: '/x', method: 'GET'}}], 'me');
    assert.equal(lists.toInvite.length, 0);
    assert.equal(lists.outsiders.length, 0);
    assert.equal(lists.already.length, 1);
});
