/* Waypoint keyless engine. No API keys, no server, no AI model.
   Open sources that allow browser requests: Wikipedia, Wikibooks, GitHub (public, rate-limited),
   PeerTube via Sepia Search. Everything is built with plain code, so quality is simpler than AI. */
(function () {
  "use strict";
  var NOISE = /^(see also|references|external links|further reading|notes|bibliography|sources|footnotes|citations|gallery)$/i;
  var STOP = {};
  ("about after also another because been before being between both called could does during each from have into just known like made many more most much only other over same should since some such than that their them then there these they this those through under used uses using very were what when where which while will with would your").split(" ").forEach(function (w) { STOP[w] = 1; });
  var cache = {};
  var BAD_KEY = "wp-badhosts"; /* video sites that refuse to be embedded; learned from the "Skip this site" button */
  function badHosts() { var l = ["tube.picasoft.net"]; try { l = l.concat(JSON.parse(localStorage.getItem(BAD_KEY) || "[]")); } catch (e) {} return l; }
  function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return ""; } }
  function isEnglish(x) {
    var l = x.language && x.language.id; if (l) return l === "en";
    var t = String(x.name || ""), ascii = (t.match(/[\x00-\x7F]/g) || []).length / (t.length || 1);
    return ascii >= 0.95 && /\b(the|and|how|what|to|of|in|for|with|is|a|tutorial|course|guide|learn|introduction|explained|basics)\b/i.test(t);
  }
  function allowed(v) { return badHosts().indexOf(hostOf(v.embed)) === -1; }
  function blockHost(h) { try { var l = JSON.parse(localStorage.getItem(BAD_KEY) || "[]"); if (l.indexOf(h) === -1) l.push(h); localStorage.setItem(BAD_KEY, JSON.stringify(l)); } catch (e) {} }

  function qs(o) { return Object.keys(o).map(function (k) { return k + "=" + encodeURIComponent(o[k]); }).join("&"); }
  function getJson(url, signal, headers) {
    return fetch(url, { signal: signal, headers: headers }).then(function (r) { if (!r.ok) throw { code: "upstream_error" }; return r.json(); },
      function (e) { if (e && e.name === "AbortError") throw { code: "cancelled" }; throw { code: "network" }; });
  }
  function none(e) { if (e && e.code === "cancelled") throw e; return []; }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /* ----- wikis ----- */
  function wiki(host, params, signal) { params.format = "json"; params.origin = "*"; return getJson("https://" + host + "/w/api.php?" + qs(params), signal); }
  function wsearch(host, q, n, signal) {
    return wiki(host, { action: "query", list: "search", srsearch: q, srlimit: n, srnamespace: 0 }, signal).then(function (j) { return (j.query && j.query.search) || []; });
  }
  function clean(t) { return t.replace(/\([^()]*\)/g, "").replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim(); }
  function sections(text) {
    var parts = text.split(/^==+\s*(.+?)\s*==+\s*$/m), out = [{ title: "Overview", text: clean(parts[0]) }];
    for (var i = 1; i < parts.length; i += 2) if (!NOISE.test(parts[i])) out.push({ title: parts[i], text: clean(parts[i + 1] || "") });
    return out.filter(function (s) { return s.text.length >= 180; });
  }
  function wpage(host, title, signal) {
    var k = host + "|" + title; if (cache[k]) return Promise.resolve(cache[k]);
    return wiki(host, { action: "query", prop: "extracts", explaintext: 1, exsectionformat: "wiki", redirects: 1, titles: title }, signal).then(function (j) {
      var pg = j.query && j.query.pages, p = pg && pg[Object.keys(pg)[0]];
      if (!p || p.missing !== undefined || !p.extract) throw { code: "no_results" };
      return (cache[k] = { title: p.title, sections: sections(p.extract) });
    });
  }
  function wikiUrl(host, title, sec) { return "https://" + host + "/wiki/" + encodeURIComponent(title.replace(/ /g, "_")) + (sec && sec !== "Overview" ? "#" + encodeURIComponent(sec.replace(/ /g, "_")) : ""); }

  /* ----- text helpers ----- */
  function sents(t) { return (t.match(/[^.!?]+[.!?]+(?=\s|$)/g) || []).map(function (s) { return s.trim(); }).filter(function (s) { return s.length >= 40 && s.length <= 260; }); }
  function words(s) { return (s.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []).filter(function (w) { return !STOP[w]; }); }
  function freq(t) { var f = {}; words(t).forEach(function (w) { f[w] = (f[w] || 0) + 1; }); return f; }
  function rank(text, n) {
    var f = freq(text), sc = sents(text).map(function (s, i) { var ws = words(s); return { s: s, i: i, v: ws.reduce(function (a, w) { return a + f[w]; }, 0) / Math.pow(ws.length || 1, 0.6) }; });
    sc.sort(function (a, b) { return b.v - a.v; });
    return sc.slice(0, n).sort(function (a, b) { return a.i - b.i; }).map(function (x) { return x.s; });
  }
  function topTerms(text, n) { var f = freq(text); return Object.keys(f).filter(function (w) { return f[w] >= 2 && w.length >= 5; }).sort(function (a, b) { return f[b] - f[a]; }).slice(0, n); }
  function cloze(s, f) {
    var best = null, low = s.toLowerCase();
    words(s).forEach(function (w) { if (f[w] >= 2 && w.length >= 5 && (!best || f[w] > f[best]) && low.split(w).length === 2) best = w; });
    if (!best) return null;
    var t = s.replace(new RegExp("\\b" + best + "\\b", "i"), "_____");
    return t === s ? null : { term: best, text: t };
  }
  function cut(s, n) { return s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n)) + "..."; }

  /* ----- readable text for a step's link ----- */
  function sectionText(u, signal) {
    var x; try { x = new URL(u); } catch (e) { return Promise.reject({ code: "no_notes" }); }
    if (/(^|\.)(wikipedia|wikibooks)\.org$/.test(x.hostname)) {
      var title = decodeURIComponent(x.pathname.replace(/^\/wiki\//, "")).replace(/_/g, " "), sec = decodeURIComponent(x.hash.slice(1)).replace(/_/g, " ");
      return wpage(x.hostname, title, signal).then(function (art) {
        var s = null; if (sec) art.sections.forEach(function (a) { if (a.title === sec) s = a; });
        s = s || art.sections[0]; if (!s) throw { code: "no_notes" };
        return { title: art.title + (sec ? ": " + sec : ""), text: s.text };
      });
    }
    if (x.hostname === "github.com") {
      var m = x.pathname.split("/").filter(Boolean); if (m.length < 2) return Promise.reject({ code: "no_notes" });
      return fetch("https://api.github.com/repos/" + m[0] + "/" + m[1] + "/readme", { signal: signal, headers: { Accept: "application/vnd.github.raw" } })
        .then(function (r) { if (!r.ok) throw { code: "no_notes" }; return r.text(); })
        .then(function (md) { return { title: m[0] + "/" + m[1], text: clean(md.replace(/```[\s\S]*?```/g, " ").replace(/<[^>]+>/g, " ").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_`|=-]+/g, " ")).slice(0, 6000) }; });
    }
    return Promise.reject({ code: "no_notes" });
  }

  /* ----- learning path ----- */
  function path(params, signal) {
    var topic = params.topic, lvl = params.level === "advanced" ? "advanced" : params.level === "intermediate" ? "tutorial" : "for beginners", H = "en.wikipedia.org";
    return wsearch(H, topic, 6, signal).then(function (res) {
      if (!res.length) throw { code: "no_results" };
      return Promise.all([wpage(H, res[0].title, signal), wsearch("en.wikibooks.org", topic, 1, signal).catch(none),
        getJson("https://api.github.com/search/repositories?" + qs({ q: topic + " in:name,description", sort: "stars", order: "desc", per_page: 2 }), signal, { Accept: "application/vnd.github+json" }).then(function (j) { return j.items || []; }).catch(none)])
        .then(function (r) {
          var art = r[0], book = r[1][0], repos = r[2], related = res.slice(1, 4), secs = art.sections.slice(0, 12), size = Math.max(1, Math.ceil(secs.length / 3));
          var names = ["Foundations", "Core ideas", "Going deeper"], vq = [topic + " explained " + lvl, topic + " tutorial full course", topic + " real project walkthrough"];
          function read(s) {
            var n = s.text.split(" ").length;
            return { type: "read", title: s.title === "Overview" ? "What is " + art.title + "?" : s.title, source: "Wikipedia: " + art.title, minutes: Math.max(8, Math.round(n / 120) + 8), note: cut((sents(s.text)[0] || ""), 140), url: wikiUrl(H, art.title, s.title) };
          }
          var phases = [];
          for (var p = 0; p < 3; p++) {
            var chunk = secs.slice(p * size, p * size + size); if (!chunk.length) break;
            var items = [{ type: "video", title: "Video: " + topic + (p === 0 ? " explained" : p === 1 ? " tutorial" : " in a real project"), source: "Search", minutes: 30, query: vq[p], note: "Pick a well-liked video and watch it before the reading." }].concat(chunk.map(read));
            if (p === 0 && book) items.push({ type: "read", title: "Guide: " + book.title, source: "Wikibooks", minutes: 30, url: wikiUrl("en.wikibooks.org", book.title), note: "A free open textbook on the topic." });
            if (p === 1) repos.forEach(function (g) { items.push({ type: "code", title: g.full_name + " (" + g.stargazers_count + " stars)", source: "GitHub", minutes: 40, url: g.html_url, note: cut(g.description || "A popular open-source project on this topic.", 140) }); });
            if (p === 2) related.forEach(function (w) { items.push({ type: "read", title: "Related: " + w.title, source: "Wikipedia", minutes: 15, url: wikiUrl(H, w.title), optional: true }); });
            items.push({ type: "build", title: "Summarise " + names[p].toLowerCase() + " in 5 bullet points", source: "Your project", minutes: 30, note: "Close the page and write from memory, then check yourself." });
            phases.push({ title: names[p] + ": " + art.title, weeks: p === 0 ? "About 1 week" : "1 week", goal: p === 0 ? "Learn what " + topic + " is and the words people use." : p === 1 ? "Learn how the main parts of " + topic + " fit together." : "See " + topic + " in real use and connect it to nearby topics.", outcome: p === 2 ? "You can explain " + topic + " and point to real examples." : "You can explain this part of " + topic + " in your own words.", items: items });
          }
          phases.push({ title: "Build and practice", weeks: "1 week", goal: "Turn what you read into something you made.", outcome: "A small piece of your own work on " + topic + ".", items: [
            { type: "build", title: "Write a one-page explainer of " + topic, source: "Your project", minutes: 90, note: "Use your own words and one diagram." },
            { type: "build", title: "Make 10 flashcards from the key terms you met", source: "Your project", minutes: 45 },
            { type: "build", title: "Build or sketch a small " + topic + " example", source: "Your project", minutes: 180, note: "Pick one small real-life case and work it through." }] });
          return { summary: "Study " + topic + " from the basics to practice, using Wikipedia, open guides and top GitHub projects.", phases: phases };
        });
    });
  }

  /* ----- notes (extractive, no AI) ----- */
  function notes(topic, it, signal) {
    return sectionText(it.url, signal).then(function (src) {
      var t = src.text; if (t.length < 150) throw { code: "no_notes" };
      var all = sents(t), f = freq(t), key = rank(t, 6), terms = topTerms(t, 4);
      var qc = [];
      key.forEach(function (s) { if (qc.length < 2) { var c = cloze(s, f); if (c) qc.push({ q: "Fill in the blank: " + c.text, a: c.term }); } });
      var ex = all.filter(function (s) { return /for example|such as|e\.g\.|for instance/i.test(s); })[0];
      return { mode: "extract", sources: [{ title: src.title, url: it.url }], data: {
        summary: all.slice(0, 2).join(" "), key_points: key.map(function (s) { return cut(s, 220); }),
        terms: terms.map(function (w) { var s = all.filter(function (x) { return x.toLowerCase().indexOf(w) !== -1; })[0] || ""; return { term: w.charAt(0).toUpperCase() + w.slice(1), meaning: cut(s, 200) }; }).filter(function (x) { return x.meaning; }),
        example: ex ? cut(ex, 240) : "", try_this: "Explain \"" + it.title + "\" out loud in 3 sentences without looking, then compare with the notes. Write down 2 words you did not know.", quick_check: qc } };
    });
  }

  /* ----- phase test (fill-in-the-blank from the phase's own sources) ----- */
  function quiz(params, signal) {
    var steps = (params.phase && params.phase.steps) || [];
    var urls = steps.map(function (s) { return s.url; }).filter(function (u) { return u && /wikipedia\.org|wikibooks\.org|github\.com/.test(u); }).slice(0, 6);
    return Promise.all(urls.map(function (u) { return sectionText(u, signal).then(function (x) { return x.text; }).catch(none); })).then(function (texts) {
      texts = texts.filter(function (t) { return typeof t === "string"; });
      var all = texts.join(" "), f = freq(all), pool = [], terms = topTerms(all, 30), avoid = (params.avoid || []).join(" "), qs = [], used = {};
      texts.forEach(function (t) { sents(t).forEach(function (s) { var c = cloze(s, f); if (c && c.text.length <= 240) pool.push({ s: s, c: c }); }); });
      shuffle(pool).forEach(function (p) {
        if (qs.length >= 5 || used[p.c.term] || avoid.indexOf(p.c.text.slice(0, 40)) !== -1) return;
        var d = shuffle(terms.filter(function (x) { return x !== p.c.term && p.s.toLowerCase().indexOf(x) === -1; })).slice(0, 3);
        if (d.length < 3) return;
        used[p.c.term] = 1;
        qs.push({ question: "Fill in the blank: " + p.c.text, options: [p.c.term].concat(d), answer: 0, explanation: "From the source: " + p.s });
      });
      if (qs.length < 3) throw { code: "no_quiz" };
      return { questions: qs };
    });
  }

  /* ----- videos (PeerTube via Sepia Search; no key) -----
     Relevance first: a video must actually mention the topic words in its title, tags or description.
     Popularity (views, likes) only orders the videos that already match. */
  var GENERIC = /^(explained|explain|tutorial|tutorials|full|course|courses|real|project|projects|walkthrough|beginners|beginner|for|in|a|an|the|and|of|to|with|how|what|is|learn|intro|introduction|guide|basics)$/;
  function keywords(q) { return (String(q).toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*/g) || []).filter(function (w) { return w.length > 1 && !GENERIC.test(w); }); }
  function stem(w) { var t = w.replace(/(ing|es|ed|s)$/, ""); return t.length >= 3 ? t : w; }
  var YT_KEY = "wp-ytkey"; /* optional, free key the visitor pastes; stays in their browser */
  function getKey() { try { return localStorage.getItem(YT_KEY) || ""; } catch (e) { return ""; } }
  function setKey(k) { try { if (k) localStorage.setItem(YT_KEY, k); else localStorage.removeItem(YT_KEY); } catch (e) {} }
  function secs(iso) { var m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || ""); return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0; }
  function ytGet(url, signal) {
    return fetch(url, { signal: signal }).then(function (r) {
      if (r.status === 400) throw { code: "bad_key" };
      if (r.status === 403) throw { code: "quota_exceeded" };
      if (!r.ok) throw { code: "youtube_error" };
      return r.json();
    }, function (e) { if (e && e.name === "AbortError") throw { code: "cancelled" }; throw { code: "network" }; });
  }
  /* Real YouTube results, relevance first: the title must mention the topic words; views, likes and comments order the rest. */
  function videos(q, signal) {
    var key = getKey(); if (!key) return Promise.reject({ code: "need_key" });
    var kw = keywords(q), need = Math.max(1, Math.ceil(kw.length * 0.75)), base = "https://www.googleapis.com/youtube/v3/";
    return ytGet(base + "search?" + qs({ part: "snippet", type: "video", maxResults: 20, videoEmbeddable: "true", safeSearch: "moderate", relevanceLanguage: "en", q: q, key: key }), signal).then(function (sj) {
      var ids = (sj.items || []).map(function (i) { return i.id && i.id.videoId; }).filter(Boolean);
      if (!ids.length) throw { code: "no_videos" };
      return ytGet(base + "videos?" + qs({ part: "snippet,statistics,contentDetails,status", id: ids.join(","), key: key }), signal);
    }).then(function (vj) {
      var out = [];
      (vj.items || []).forEach(function (x) {
        var sn = x.snippet || {}, st = x.statistics || {}, sec = secs(x.contentDetails && x.contentDetails.duration), title = String(sn.title || "");
        if ((x.status && x.status.embeddable === false) || (sn.liveBroadcastContent && sn.liveBroadcastContent !== "none") || sec < 120 || sec > 4 * 3600) return;
        var lang = String(sn.defaultAudioLanguage || sn.defaultLanguage || "").toLowerCase();
        if (lang ? lang.indexOf("en") !== 0 : (title.match(/[\x00-\x7F]/g) || []).length / (title.length || 1) < 0.95) return;
        var low = title.toLowerCase(), rest = String(sn.description || "").toLowerCase().slice(0, 600), inT = 0, inR = 0;
        kw.forEach(function (w) { var s2 = stem(w); if (low.indexOf(s2) !== -1) inT++; else if (rest.indexOf(s2) !== -1) inR++; });
        if (kw.length && (inT < 1 || inT + inR < need)) return;
        var views = +st.viewCount || 0, likes = +st.likeCount || 0, com = +st.commentCount || 0, lr = views > 0 ? likes / views : 0;
        var pop = 0.5 * Math.min(Math.log10(views + 1) / 7, 1) + 0.3 * Math.min(Math.log10(likes + 1) / 6, 1) + 0.1 * Math.min(Math.log10(com + 1) / 5, 1) + 0.1 * Math.min(lr / 0.05, 1);
        var rel = kw.length ? (inT * 2 + inR) / (kw.length * 2) : 0.5, th = sn.thumbnails || {};
        out.push({ id: x.id, title: title, channel: String(sn.channelTitle || ""), thumb: (th.medium || th.default || {}).url || "", sec: sec, views: views, likes: likes, comments: com, score: Math.round((0.6 * rel + 0.4 * pop) * 100) / 10 });
      });
      out.sort(function (a, b) { return b.score - a.score; });
      var per = {}; out = out.filter(function (v) { per[v.channel] = (per[v.channel] || 0) + 1; return per[v.channel] <= 2; });
      if (!out.length) throw { code: "no_videos" };
      return out.slice(0, 4);
    });
  }

  window.WaypointKeyless = { path: path, notes: notes, quiz: quiz, videos: videos, getKey: getKey, setKey: setKey, filter: function (l) { return l.filter(function (v) { return !v.embed; }); } };
})();
