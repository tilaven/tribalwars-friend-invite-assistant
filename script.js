// author: tilaven
// version: 0.2.1
//
// Invite Assistant - compares a target list of players (your tribe, other
// tribes, or a list posted on the tribe forum) with your friends screen and
// shows three lists: to invite or accept, already on the list, and friends
// that are not on the target list any more.
//
// The whole configuration travels in the script URL, so the tribe council can
// hand out one ready-made link:
//   javascript:$.getScript('https://.../script.js?tribes=SNTX,G-F');
//   javascript:$.getScript('https://.../script.js?thread=32&post=184');
//   javascript:$.getScript('https://.../script.js');            // own tribe
//
// Whatever the link says shows up in the source field of the panel, so it can
// be read and changed without handing out a new link.

(function () {
    'use strict';

    var VERSION = '0.2.1';
    var PANEL_ID = 'invite-assistant';
    var REQUEST_DELAY_MS = 350;     // the game's bot protection dislikes bursts

    // ── i18n ──────────────────────────────────────────────────────────────

    var STRINGS = {
        en: {
            title: 'Invite Assistant',
            toInvite: 'To invite',
            already: 'Already invited / friends',
            outsiders: 'Outside the list',
            invite: 'Invite',
            accept: 'Accept',
            inviteAll: 'Invite all',
            remove: 'Remove',
            removeAll: 'Remove all',
            stop: 'Stop',
            close: 'Close',
            load: 'Load',
            sourceHint: 'tribe tags or a forum thread link - empty means your own tribe',
            loading: 'Loading...',
            empty: 'nothing here',
            progress: '{done} / {total}',
            done: 'Done - {ok} ok, {failed} failed',
            stopped: 'Stopped - {ok} ok, {failed} failed',
            targets: '{count} players from {source}',
            sourceOwn: 'your tribe',
            sourceTribes: 'tribes {list}',
            sourceThread: 'forum thread {id}',
            noTargets: 'No target players found - check the source field.',
            unreadScreen: 'Could not read your friends screen - the lists below may be wrong.',
            unnamed: '{count} not in the world files yet ({known} players loaded)',
            noWorldFiles: 'the world data files did not answer, so nicknames and tribes are missing',
            botProtection: 'Bot protection kicked in. Solve the captcha in the game, then run the script again.',
            failed: 'Failed: {error}'
        },
        pl: {
            title: 'Asystent zapraszania',
            toInvite: 'Do zaproszenia',
            already: 'Już zaproszeni / znajomi',
            outsiders: 'Spoza listy',
            invite: 'Zaproś',
            accept: 'Akceptuj',
            inviteAll: 'Zaproś wszystkich',
            remove: 'Usuń',
            removeAll: 'Usuń wszystkich',
            stop: 'Zatrzymaj',
            close: 'Zamknij',
            load: 'Wczytaj',
            sourceHint: 'skróty plemion albo link do wątku - puste to twoje plemię',
            loading: 'Wczytywanie...',
            empty: 'pusto',
            progress: '{done} / {total}',
            done: 'Gotowe - {ok} ok, {failed} błędów',
            stopped: 'Zatrzymano - {ok} ok, {failed} błędów',
            targets: '{count} graczy z {source}',
            sourceOwn: 'twojego plemienia',
            sourceTribes: 'plemion {list}',
            sourceThread: 'wątku na forum {id}',
            noTargets: 'Nie znaleziono graczy - sprawdź pole ze źródłem.',
            unreadScreen: 'Nie udało się odczytać listy znajomych - poniższe listy mogą być błędne.',
            unnamed: '{count} spoza plików świata ({known} graczy wczytanych)',
            noWorldFiles: 'pliki świata nie odpowiedziały, więc brakuje nicków i plemion',
            botProtection: 'Włączyła się ochrona przed botami. Rozwiąż captchę w grze i odpal skrypt ponownie.',
            failed: 'Błąd: {error}'
        }
    };

    function t(key, vars) {
        var data = window.game_data || {};
        var polish = data.market === 'pl' || String(data.locale || '').indexOf('pl') === 0;
        var text = STRINGS[polish ? 'pl' : 'en'][key] || key;
        return text.replace(/\{(\w+)\}/g, function (_, name) {
            return (vars || {})[name];
        });
    }

    // ── names ─────────────────────────────────────────────────────────────

    // world data files store names url-encoded with "+" for spaces
    function normalizeName(name) {
        var text = decodeSafe(String(name == null ? '' : name).replace(/\+/g, ' '));
        return text.replace(/\s+/g, ' ').trim();   // \s also covers the nbsp the game likes
    }

    function decodeSafe(text) {
        try {
            return decodeURIComponent(text);
        } catch (e) {
            return text;               // a stray "%" - keep the text as typed
        }
    }

    function nameKey(name) {
        return normalizeName(name).toLowerCase();
    }

    function uniqueById(players) {
        var seen = {};
        return players.filter(function (player) {
            if (seen[player.id]) {
                return false;
            }
            seen[player.id] = true;
            return true;
        });
    }

    // the profile id is the identity wherever the game gives one; a name is
    // only a stand-in for the rare player the world files have not seen yet
    function playerKey(player) {
        return player.id ? 'id:' + player.id : 'name:' + nameKey(player.name);
    }

    // ── where the player list comes from ──────────────────────────────────

    function threadUrl(id, post) {
        return '/game.php?screen=forum&screenmode=view_thread&thread_id=' + id +
            '&page=0' + (post ? '#' + post : '');
    }

    function withPost(text, post) {
        return post && text.indexOf('#') < 0 ? text + '#' + post : text;
    }

    // the script link is turned into the text shown in the source field, so
    // whatever the council configured can be read and edited in the panel
    function readConfig(src) {
        var raw = String(src || '');
        var params = new URLSearchParams(raw.split('?').slice(1).join('?').split('#')[0]);
        var thread = params.get('thread') || '';
        var post = params.get('post') || (raw.match(/#(\d+)/) || [])[1];

        if (/^\d+$/.test(thread.trim())) {
            return threadUrl(thread.trim(), post);
        }
        if (/thread_id=\d+/.test(thread)) {
            return withPost(thread, post);
        }
        // the whole forum address pasted unencoded: its "&" split the query
        // into several params, so take the raw text after "thread="
        if (/thread_id=\d+/.test(raw)) {
            return withPost(raw.slice(raw.indexOf('thread=') + 'thread='.length), post);
        }
        return params.get('tribes') || '';
    }

    // a forum address (any shape) or a list of tribe tags
    function parseSource(text) {
        var value = decodeSafe(String(text || '').trim());
        var id = (value.match(/thread_id=(\d+)/) || [])[1];
        if (id) {
            return {tribes: [], thread: {id: id, post: (value.match(/#(\d+)/) || [])[1] || null}};
        }
        return {tribes: splitList(value), thread: null};
    }

    function splitList(value) {
        return String(value || '').split(/[,;\n]/)
            .map(normalizeName)
            .filter(Boolean);
    }

    function currentScriptSrc() {
        if (document.currentScript && document.currentScript.src) {
            return document.currentScript.src;
        }
        // jQuery.getScript on a same-origin URL evaluates the code without a
        // <script> tag, so fall back to the last script that looks like ours
        var scripts = Array.prototype.slice.call(document.scripts).reverse();
        var mine = scripts.filter(function (script) {
            return /invite|zapros/i.test(script.src);
        })[0];
        return mine ? mine.src : '';
    }

    // ── game requests ─────────────────────────────────────────────────────

    var Game = {
        url: function (screen, params) {
            var query = new URLSearchParams(params || {});
            query.set('screen', screen);
            if (window.game_data && game_data.village) {
                query.set('village', game_data.village.id);
            }
            return '/game.php?' + query.toString();
        },

        csrf: function () {
            return (window.game_data && game_data.csrf) || '';
        },

        get: function (url) {
            return fetch(url, {credentials: 'same-origin'}).then(function (response) {
                return response.text();
            });
        },

        document: function (url) {
            return Game.get(url).then(function (html) {
                return new DOMParser().parseFromString(html, 'text/html');
            });
        },

        post: function (url, body) {
            return fetch(url, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: body
            }).then(function (response) {
                return response.text();
            });
        },

        addBuddy: function (name) {
            return Game.post(
                Game.url('buddies', {action: 'add_buddy', h: Game.csrf()}),
                new URLSearchParams({name: name, h: Game.csrf()}).toString()
            );
        },

        // a row action is either a link to follow or a small form to post back
        send: function (action) {
            return action.method === 'POST'
                ? Game.post(action.url, action.body)
                : Game.get(action.url);
        },

        // returns an error message, or null when the game accepted the action
        errorIn: function (html) {
            if (/botprotect|bot_check|captcha/i.test(html)) {
                return t('botProtection');
            }
            var box = new DOMParser().parseFromString(html, 'text/html')
                .querySelector('.error_box, .error');
            return box ? box.textContent.trim().slice(0, 120) : null;
        }
    };

    // ── page parsing ──────────────────────────────────────────────────────

    var PROFILE_LINK = 'a[href*="screen=info_player"]';
    var BUDDY_ACTION = 'a[href*="screen=buddies"][href*="action="],' +
        'form[action*="screen=buddies"][action*="action="]';

    var Parse = {
        content: function (doc) {
            return doc.querySelector('#content_value') || doc.body || doc;
        },

        // player links inside the given element; the screen menu links to your
        // own profile without an id, which is exactly what we want to skip.
        // The id is the identity here - the app wraps whole rows in the profile
        // link, so the link text is worth nothing until the world files answer
        players: function (root) {
            var links = root.querySelectorAll(PROFILE_LINK);
            return uniqueById(Array.prototype.map.call(links, function (link) {
                var href = link.getAttribute('href') || '';
                var id = (href.match(/[?&]id=(\d+)/) || [])[1];
                return id ? {id: id, name: normalizeName(link.textContent), profileUrl: href} : null;
            }).filter(Boolean));
        },

        tribeIds: function (root) {
            var links = root.querySelectorAll('a[href*="screen=info_ally"]');
            return Array.prototype.map.call(links, function (link) {
                return (link.getAttribute('href').match(/[?&]id=(\d+)/) || [])[1];
            }).filter(Boolean);
        },

        // player.txt: id, name, tribe id, villages, points, rank. The screens
        // give ids reliably and names only sometimes, so the world files are
        // what turns an id into a nickname and a tribe tag - a day old at worst
        world: function (playerText, allyText) {
            var tagOf = {};
            var world = {players: {}, tribes: {}};

            String(allyText).split('\n').forEach(function (line) {
                var cells = line.split(',');
                if (cells.length > 2) {
                    tagOf[cells[0]] = normalizeName(cells[2]);
                    world.tribes[nameKey(cells[2])] = cells[0];
                }
            });
            String(playerText).split('\n').forEach(function (line) {
                var cells = line.split(',');
                if (cells.length > 2) {
                    world.players[cells[0]] = {
                        name: normalizeName(cells[1]),
                        tribeId: cells[2],
                        tribe: tagOf[cells[2]] || ''
                    };
                }
            });
            return world;
        },

        // one forum post if an anchor was configured, the whole thread otherwise
        threadScope: function (doc, postId) {
            var anchor = postId && doc.querySelector('a[name="' + postId + '"]');
            var post = anchor && anchor.closest('.post');
            return post || doc.querySelector('#forum_post_list') || doc;
        },

        // what the row lets us do, named after the action the game put in it:
        // add_buddy (a suggestion), accept_buddy, cancel_buddy / delete_buddy.
        // Buttons count as much as links - the game renders some of them as a
        // small form
        actions: function (row) {
            var controls = row.querySelectorAll(BUDDY_ACTION);
            var found = {add: null, accept: null, drop: null, all: []};

            Array.prototype.forEach.call(controls, function (control) {
                var action = Parse.action(control);
                var slot = /add/.test(action.name) ? 'add'
                    : (/accept|confirm/.test(action.name) ? 'accept' : 'drop');
                found.all.push(action);
                found[slot] = found[slot] || action;
            });

            // even an unknown naming gives it away: only a request somebody
            // sent us comes with two buttons (accept and decline)
            if (!found.accept && !found.add && found.all.length > 1) {
                found.accept = found.all[0];
                found.drop = found.all[1];
            }
            return found;
        },

        action: function (control) {
            var url = control.getAttribute('href') || control.getAttribute('action');
            var name = (url.match(/action=(\w+)/) || [])[1] || '';
            if (control.tagName !== 'FORM') {
                return {name: name, url: url, method: 'GET'};
            }
            var body = new URLSearchParams();
            Array.prototype.forEach.call(control.querySelectorAll('input[name],select[name]'), function (field) {
                body.set(field.name, field.value);
            });
            return {name: name, url: url, method: 'POST', body: body.toString()};
        },

        // somebody counts as being on your friends screen only when the game
        // offers a way to accept or drop them. The suggestions it makes carry
        // an add button at best - those rows are ignored completely, so a
        // suggested player stays on the "to invite" list and shows up nowhere
        // else
        scan: function (doc) {
            var found = {rows: [], players: 0, unreadable: 0};
            var seen = {};

            Array.prototype.forEach.call(Parse.content(doc).querySelectorAll(PROFILE_LINK), function (profile) {
                if (!/[?&]id=\d+/.test(profile.getAttribute('href') || '')) {
                    return;                   // the screen menu, not a player
                }
                found.players++;

                var href = profile.getAttribute('href');
                var id = (href.match(/[?&]id=(\d+)/) || [])[1];
                var row = Parse.rowOf(profile);
                var actions = row ? Parse.actions(row) : {};
                if (seen[id]) {
                    return;
                }
                if (!row || !(actions.accept || actions.drop)) {
                    // a suggestion is understood and dropped on purpose, a name
                    // with no buttons at all means the layout beat us
                    found.unreadable += actions.add ? 0 : 1;
                    return;
                }
                seen[id] = true;

                // both are only stand-ins until the world files answer: the app
                // wraps whole rows in the profile link, so the text can be the
                // entire table instead of a nickname
                var tribe = row.querySelector('a[href*="screen=info_ally"]');
                found.rows.push({
                    id: id,
                    name: normalizeName(profile.textContent),
                    profileUrl: href,
                    accept: actions.accept,
                    remove: actions.drop,
                    tribe: tribe ? normalizeName(tribe.textContent) : '',
                    note: Parse.sectionOf(row)
                });
            });

            // a screen we failed to read looks exactly like an empty friends
            // list, and that would put everybody up for a fresh invite - names
            // we saw but could do nothing with are the giveaway
            found.unread = !found.rows.length && found.unreadable > 0;
            return found;
        },

        // the desktop layout puts a friend in a table row, the app in a div, so
        // the row is simply the smallest block holding this one name together
        // with the buttons that belong to it
        rowOf: function (profile) {
            var node = profile.parentElement;
            for (var hops = 0; node && hops < 6; node = node.parentElement, hops++) {
                if (node.querySelector(BUDDY_ACTION) &&
                    Parse.players(node).length === 1) {
                    return node;
                }
            }
            return null;
        },

        // nearest heading above the row - tells friends from pending invites
        // without hard-coding the layout of the screen
        sectionOf: function (row) {
            for (var node = row; node; node = node.parentElement) {
                for (var prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
                    if (/^H[1-4]$/.test(prev.tagName)) {
                        return prev.textContent.trim();
                    }
                }
            }
            return '';
        }
    };

    // ── world data ────────────────────────────────────────────────────────

    // player.txt and ally.txt answer what the screens do not: the nickname
    // behind a profile id, the tribe somebody plays for, and the id behind a
    // tribe tag. Kept for an hour, which is also as often as the game allows
    // collecting them
    var World = {
        KEY: 'invite-assistant-world',
        MAX_AGE_MS: 60 * 60 * 1000,
        pending: null,

        load: function () {
            if (!World.pending) {
                World.pending = World.stored() || World.download();
            }
            return World.pending;
        },

        stored: function () {
            try {
                var saved = JSON.parse(localStorage.getItem(World.KEY));
                if (saved && Date.now() - saved.time < World.MAX_AGE_MS) {
                    return Promise.resolve(saved.world);
                }
            } catch (e) {
                // unreadable or switched off - just fetch it again
            }
            return null;
        },

        download: function () {
            return Promise.all([Game.get('/map/player.txt'), Game.get('/map/ally.txt')])
                .then(function (files) {
                    var world = Parse.world(files[0], files[1]);
                    try {
                        localStorage.setItem(World.KEY,
                            JSON.stringify({time: Date.now(), world: world}));
                    } catch (e) {
                        // no room for a whole world in storage, keep it for this run
                    }
                    return world;
                });
        }
    };

    // ── target list ───────────────────────────────────────────────────────

    var Targets = {
        resolve: function (config) {
            if (config.thread) {
                return Targets.fromThread(config.thread);
            }
            if (config.tribes.length) {
                return Targets.fromTags(config.tribes).then(function (players) {
                    return {
                        players: players,
                        source: t('sourceTribes', {list: config.tribes.join(', ')}),
                        sourceUrl: Targets.tribeUrl(Targets.lastIds)
                    };
                });
            }
            var own = window.game_data && game_data.player.ally;
            var ids = own && own !== '0' ? [own] : [];
            return Targets.fromTribeIds(ids).then(function (players) {
                return {players: players, source: t('sourceOwn'), sourceUrl: Targets.tribeUrl(ids)};
            });
        },

        // a council post usually links the tribes ([ally] tags); player links
        // are taken as they are, plain text lines are treated as tribe tags
        fromThread: function (thread) {
            var url = Game.url('forum', {screenmode: 'view_thread', thread_id: thread.id, page: 0});
            return Game.document(url).then(function (doc) {
                var scope = Parse.threadScope(doc, thread.post);
                var players = Parse.players(scope);
                var tribeIds = Parse.tribeIds(scope);
                var source = t('sourceThread', {id: '#' + thread.id + (thread.post ? '/' + thread.post : '')});

                var url = threadUrl(thread.id, thread.post);

                if (tribeIds.length) {
                    return Targets.fromTribeIds(tribeIds).then(function (members) {
                        return {
                            players: uniqueById(members.concat(players)),
                            source: source,
                            sourceUrl: url
                        };
                    });
                }
                if (players.length) {
                    return {players: players, source: source, sourceUrl: url};
                }
                return Targets.fromTags(splitList(scope.textContent)).then(function (members) {
                    return {players: members, source: source, sourceUrl: url};
                });
            });
        },

        // one tribe behind the list can be linked to, a handful cannot
        lastIds: [],

        tribeUrl: function (ids) {
            return ids.length === 1 ? Game.url('info_ally', {id: ids[0]}) : null;
        },

        fromTags: function (tags) {
            return World.load().then(function (world) {
                var ids = tags.map(function (tag) { return world.tribes[nameKey(tag)]; }).filter(Boolean);
                Targets.lastIds = ids;
                return Targets.fromTribeIds(ids);
            });
        },

        // the member list comes out of the world files rather than out of the
        // tribe screen: one file already in hand instead of a page per tribe,
        // and names that no screen layout can mangle
        fromTribeIds: function (ids) {
            return World.load().then(function (world) {
                var wanted = {};
                ids.forEach(function (id) { wanted[String(id)] = true; });

                return Object.keys(world.players)
                    .filter(function (id) { return wanted[world.players[id].tribeId]; })
                    .map(function (id) {
                        return {
                            id: id,
                            name: world.players[id].name,
                            tribe: world.players[id].tribe,
                            profileUrl: Game.url('info_player', {id: id})
                        };
                    });
            });
        }
    };

    // ── the three lists ───────────────────────────────────────────────────
    //
    // kind drives both the row button and what the batch button does:
    //   accept  invited us and is on the target list
    //   invite  on the target list, nowhere on the friends screen
    //   listed  already a friend or already invited by us
    //   remove  on the friends screen, not on the target list - that includes
    //           a request from somebody we are not looking for, where removing
    //           means declining it

    function splitLists(targets, rows, own) {
        var onList = {};
        var waiting = {};
        rows.forEach(function (row) {
            (row.accept ? waiting : onList)[playerKey(row)] = row;
        });

        var wanted = {};
        var players = targets.filter(function (player) { return !isSelf(player, own); });
        players.forEach(function (player) { wanted[playerKey(player)] = true; });

        var incoming = players
            .filter(function (player) { return waiting[playerKey(player)]; })
            .map(function (player) { return entry(waiting[playerKey(player)], 'accept'); });

        return {
            toInvite: incoming.concat(players
                .filter(function (player) {
                    return !onList[playerKey(player)] && !waiting[playerKey(player)];
                })
                .map(function (player) { return entry(player, 'invite'); })),
            already: players
                .filter(function (player) { return onList[playerKey(player)]; })
                .map(function (player) { return entry(onList[playerKey(player)], 'listed'); }),
            outsiders: rows
                .filter(function (row) { return !wanted[playerKey(row)] && row.remove; })
                .map(function (row) { return entry(row, 'remove'); })
        };
    }

    function isSelf(player, own) {
        own = own || {};
        return (own.id && String(own.id) === String(player.id)) ||
            (!!own.name && nameKey(own.name) === nameKey(player.name));
    }

    function entry(source, kind) {
        return {
            id: source.id || null,
            name: source.name,
            profileUrl: source.profileUrl || null,
            accept: source.accept || null,
            remove: source.remove || null,
            tribe: source.tribe || '',
            note: source.note || '',
            kind: kind
        };
    }

    // ── one action at a time ──────────────────────────────────────────────

    var Queue = {
        running: false,
        stopped: false,

        run: function (entries) {
            var todo = entries.filter(function (item) { return Actions[item.kind]; });
            if (Queue.running || !todo.length) {
                return Promise.resolve();
            }
            Queue.running = true;
            Queue.stopped = false;
            UI.setBusy(true);

            var ok = 0;
            var failed = 0;
            var lastError = null;
            var batch = todo.length > 1;      // a single click needs no counter

            var step = function (index) {
                if (index >= todo.length || Queue.stopped) {
                    Queue.running = false;
                    UI.setBusy(false);
                    // the reload rewrites the status line, so the outcome is
                    // put back on top of it
                    return App.refresh().then(function () {
                        if (lastError) {
                            UI.setStatus(t('failed', {error: lastError}));
                        } else if (batch) {
                            UI.setStatus(t(Queue.stopped ? 'stopped' : 'done', {ok: ok, failed: failed}));
                        }
                    });
                }
                var item = todo[index];
                if (batch) {
                    UI.setStatus(t('progress', {done: index + 1, total: todo.length}));
                }
                item.setStatus('pending');
                return Actions[item.kind](item).then(function (error) {
                    if (error) {
                        failed++;
                        lastError = error;
                        item.setStatus('failed', error);
                        Queue.stopped = Queue.stopped || error === t('botProtection');
                    } else {
                        ok++;
                        item.setStatus('ok');
                    }
                    // the delay is there to space out requests, so the last one
                    // must not sit on it - a single click has nothing to wait for
                    var last = Queue.stopped || index + 1 >= todo.length;
                    return (last ? Promise.resolve() : wait(REQUEST_DELAY_MS))
                        .then(function () { return step(index + 1); });
                });
            };

            return step(0);
        }
    };

    var Actions = {
        invite: function (item) {
            return Game.addBuddy(item.name).then(Game.errorIn);
        },
        // accepting and removing means replaying the link or the form the game
        // itself drew in that row, token and all
        accept: function (item) {
            return Game.send(item.accept).then(Game.errorIn);
        },
        remove: function (item) {
            return item.remove ? Game.send(item.remove).then(Game.errorIn)
                : Promise.resolve('no remove link in the row');
        }
    };

    function wait(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    // ── UI ────────────────────────────────────────────────────────────────

    var CSS = [
        '#' + PANEL_ID + '{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;',
        'justify-content:center;background:rgba(0,0,0,.45);font-family:Verdana,Arial,sans-serif}',
        '#' + PANEL_ID + ' *{box-sizing:border-box}',
        '.ia-box{width:min(560px,94vw);max-height:88vh;display:flex;flex-direction:column;',
        'background:#f4e4bc;border:2px solid #7d510f;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5)}',
        '.ia-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:2px solid #c1a264;',
        'background:linear-gradient(#e9d5a5,#dcc38a);border-radius:6px 6px 0 0}',
        '.ia-head b{font-size:15px;color:#4b2c02;flex:1}',
        '.ia-ver{font-size:11px;color:#7d6234}',
        '.ia-source{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #c1a264}',
        '.ia-source input{flex:1;min-width:0;border:1px solid #a08048;border-radius:4px;padding:3px 6px;',
        'font-size:12px;background:#fff8e6;color:#4b2c02}',
        '.ia-status{padding:6px 12px;font-size:12px;color:#5c3a08;border-bottom:1px solid #c1a264;min-height:26px}',
        '.ia-status a{color:#5c3a08;text-decoration:underline}',   // the game unstyles links
        '.ia-lists{overflow:auto;padding:4px 12px 12px}',
        '.ia-group{margin-top:12px;border:1px solid #c1a264;border-radius:6px;background:#fff8e6}',
        '.ia-group-head{display:flex;align-items:center;gap:8px;padding:6px 8px;',
        'background:#e9d5a5;border-bottom:1px solid #c1a264;border-radius:5px 5px 0 0}',
        '.ia-group-head span{flex:1;font-weight:bold;color:#4b2c02;font-size:13px}',
        '.ia-count{background:#7d510f;color:#f4e4bc;border-radius:10px;padding:1px 8px;font-size:11px}',
        '.ia-rows{max-height:26vh;overflow:auto}',
        '.ia-row{display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:12px;',
        'border-bottom:1px solid #ecdcb6}',
        '.ia-row:last-child{border-bottom:0}',
        '.ia-row a,.ia-name{color:#4b2c02;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.ia-note{color:#8a7550;font-size:11px}',
        '.ia-empty{padding:8px;color:#8a7550;font-size:12px;font-style:italic}',
        '.ia-mark{width:16px;text-align:center;font-size:12px}',
        '.ia-mark.ok{color:#1c7c1c}.ia-mark.failed{color:#a71c1c;cursor:help}.ia-mark.pending{color:#7d6234}',
        '.ia-btn{border:1px solid #4b2c02;border-radius:4px;color:#fff;cursor:pointer;font-size:11px;',
        'padding:3px 10px;background:linear-gradient(#947a62,#7b5c3d 22%,#6c4824 30%,#6c4824)}',
        '.ia-btn:hover:not(:disabled){filter:brightness(1.15)}',
        '.ia-btn:disabled{opacity:.45;cursor:default}',
        '.ia-btn.ia-danger{background:linear-gradient(#b06a6a,#8d3f3f 30%,#7d2e2e)}'
    ].join('');

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (key) {
            if (key === 'class') {
                node.className = attrs[key];
            } else if (key === 'text') {
                node.textContent = attrs[key];
            } else if (key.indexOf('on') === 0) {
                node.addEventListener(key.slice(2), attrs[key]);
            } else {
                node.setAttribute(key, attrs[key]);
            }
        });
        (children || []).forEach(function (child) {
            if (child) {
                node.appendChild(child);
            }
        });
        return node;
    }

    var UI = {
        open: function () {
            var old = document.getElementById(PANEL_ID);
            if (old) {
                old.remove();
            }
            if (!document.getElementById('ia-css')) {
                document.head.appendChild(el('style', {id: 'ia-css', text: CSS}));
            }

            UI.status = el('div', {class: 'ia-status', text: t('loading')});
            UI.lists = el('div', {class: 'ia-lists'});
            UI.source = el('input', {
                type: 'text',
                placeholder: t('sourceHint'),
                title: t('sourceHint'),
                onkeydown: function (event) {
                    if (event.key === 'Enter') {
                        App.load(UI.source.value);
                    }
                }
            });
            UI.stopButton = el('button', {
                class: 'ia-btn', text: t('stop'), disabled: 'disabled',
                onclick: function () { Queue.stopped = true; }
            });

            var box = el('div', {class: 'ia-box'}, [
                el('div', {class: 'ia-head'}, [
                    el('b', {text: t('title')}),
                    el('span', {class: 'ia-ver', text: 'v' + VERSION}),
                    UI.stopButton,
                    el('button', {
                        class: 'ia-btn', text: t('close'),
                        onclick: function () { document.getElementById(PANEL_ID).remove(); }
                    })
                ]),
                el('div', {class: 'ia-source'}, [
                    UI.source,
                    el('button', {
                        class: 'ia-btn', text: t('load'),
                        onclick: function () { App.load(UI.source.value); }
                    })
                ]),
                UI.status,
                UI.lists
            ]);

            var panel = el('div', {
                id: PANEL_ID,
                onclick: function (event) {
                    if (event.target === panel && !Queue.running) {
                        panel.remove();
                    }
                }
            }, [box]);
            document.body.appendChild(panel);
        },

        // the status line doubles as a link to whatever it is reporting on, so
        // the thread or tribe behind the list is one click away
        setStatus: function (text, url) {
            UI.statusText = text;
            UI.statusUrl = url || null;
            UI.status.textContent = '';
            UI.status.appendChild(url
                ? el('a', {text: text, href: url, target: '_blank'})
                : document.createTextNode(text));
        },

        addNote: function (note) {
            UI.status.appendChild(el('span', {class: 'ia-note', text: ' - ' + note}));
        },

        // every button is disabled while a queue runs - that is the whole
        // trick to not firing the same invite twice
        setBusy: function (busy) {
            UI.stopButton.disabled = !busy;
            UI.source.disabled = busy;
            Array.prototype.forEach.call(
                document.getElementById(PANEL_ID).querySelectorAll('.ia-source .ia-btn, .ia-lists .ia-btn'),
                function (button) { button.disabled = busy; }
            );
        },

        render: function (lists) {
            UI.lists.textContent = '';
            UI.lists.appendChild(UI.group(t('toInvite'), lists.toInvite, t('inviteAll')));
            UI.lists.appendChild(UI.group(t('already'), lists.already, null));
            UI.lists.appendChild(UI.group(t('outsiders'), lists.outsiders, t('removeAll'), true));
        },

        group: function (title, entries, batchLabel, danger) {
            var rows = el('div', {class: 'ia-rows'});
            var count = el('b', {class: 'ia-count', text: String(entries.length)});
            var left = entries.length;

            // a row that got its click leaves right away, no waiting around
            var drop = function (row) {
                row.remove();
                left--;
                count.textContent = String(left);
                if (!left) {
                    rows.appendChild(el('div', {class: 'ia-empty', text: t('empty')}));
                }
            };

            if (!entries.length) {
                rows.appendChild(el('div', {class: 'ia-empty', text: t('empty')}));
            }
            entries.forEach(function (item) {
                rows.appendChild(UI.row(item, drop));
            });

            var head = el('div', {class: 'ia-group-head'}, [
                el('span', {text: title}),
                count,
                batchLabel && entries.length ? el('button', {
                    class: 'ia-btn' + (danger ? ' ia-danger' : ''),
                    text: batchLabel,
                    onclick: function () { Queue.run(entries); }
                }) : null
            ]);

            return el('div', {class: 'ia-group'}, [head, rows]);
        },

        row: function (item, drop) {
            var mark = el('span', {class: 'ia-mark'});
            var tribe = el('span', {class: 'ia-note', text: item.tribe});
            var name = item.profileUrl
                ? el('a', {text: item.name, href: item.profileUrl, target: '_blank'})
                : el('span', {class: 'ia-name', text: item.name});

            item.setTribe = function (tag) {
                tribe.textContent = tag || '';
            };
            // the app hands us a row of table text instead of a nickname, so
            // the world files get to correct both the label and what we invite
            item.setName = function (nick) {
                item.name = nick;
                name.textContent = nick;
            };

            item.setStatus = function (state, title) {
                mark.className = 'ia-mark ' + state;
                mark.textContent = {pending: '...', ok: 'ok', failed: 'x'}[state] || '';
                mark.title = title || '';
                if (title) {
                    UI.setStatus(t('failed', {error: title}));
                }
                // the row leaves the moment the click is fired, not when the
                // game answers - a failed one comes back with the reload, with
                // the reason in the status line
                if (state === 'pending') {
                    drop(node);
                }
            };

            var node = el('div', {class: 'ia-row'}, [
                name,
                tribe,
                item.note ? el('span', {class: 'ia-note', text: item.note}) : null,
                mark,
                Actions[item.kind] ? el('button', {
                    class: 'ia-btn' + (item.kind === 'remove' ? ' ia-danger' : ''),
                    text: t(item.kind),
                    onclick: function () { Queue.run([item]); }
                }) : null
            ]);

            return node;
        }
    };

    // ── app ───────────────────────────────────────────────────────────────

    var App = {
        targets: {players: [], source: ''},

        start: function () {
            UI.open();
            App.load(readConfig(currentScriptSrc()));
        },

        load: function (source) {
            UI.source.value = source;
            UI.setStatus(t('loading'));
            return Targets.resolve(parseSource(source))
                .then(function (targets) {
                    App.targets = targets;
                    return App.refresh();
                })
                .catch(function (error) {
                    UI.setStatus(t('failed', {error: error.message || error}));
                });
        },

        refresh: function () {
            return Game.document(Game.url('buddies')).then(function (doc) {
                var me = window.game_data && game_data.player;
                var friends = Parse.scan(doc);
                var lists = splitLists(App.targets.players, friends.rows,
                    me && {id: me.id, name: me.name});
                var count = lists.toInvite.length + lists.already.length;
                UI.render(lists);
                if (friends.unread) {
                    UI.setStatus(t('unreadScreen'));
                } else if (count) {
                    UI.setStatus(t('targets', {count: count, source: App.targets.source}),
                        App.targets.sourceUrl);
                } else {
                    UI.setStatus(t('noTargets'));
                }
                return App.label(lists.toInvite.concat(lists.already, lists.outsiders));
            });
        },

        // the screens give ids reliably and everything else unevenly: a full
        // tribe name in the tables that have that column, nothing in the rest,
        // and in the app a whole row of table text where a nickname belongs.
        // The world files settle all of it, so every row reads the same way
        label: function (entries) {
            if (!entries.length) {
                return Promise.resolve();
            }
            return World.load().then(function (world) {
                var unnamed = 0;
                entries.forEach(function (item) {
                    var known = world.players[item.id];
                    if (known) {
                        item.setTribe(known.tribe);
                        item.setName(known.name);
                        return;
                    }
                    // too new for the daily files: the screen text is worth
                    // showing only when it reads like a nickname and not like a
                    // row of a table, which is what the app hands over
                    unnamed++;
                    item.setName(item.name.length > 30 ? '#' + item.id : item.name);
                });
                if (unnamed) {
                    UI.addNote(t('unnamed', {
                        count: unnamed,
                        known: Object.keys(world.players).length
                    }));
                }
            }).catch(function () {
                UI.addNote(t('noWorldFiles'));
            });
        }
    };

    // the browser runs the script, `node --test` only pokes at the pure parts
    if (typeof module === 'object' && module.exports) {
        module.exports = {
            readConfig: readConfig,
            parseSource: parseSource,
            splitLists: splitLists,
            normalizeName: normalizeName,
            world: Parse.world
        };
    } else {
        App.start();
    }
})();
