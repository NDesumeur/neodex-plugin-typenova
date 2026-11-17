// TypeNova pour NeoDex.
// Le jeu d'origine est écrit en Python (pygame). Son code est traduit en JavaScript par un outil (py2js.py, gardé avec le
// jeu Python, hors de ce dépôt) et rangé dans game/typenova.js : ce fichier-là ne s'édite pas à la main, il se régénère.
// Ici, on ne fait que le lancer :
//   1. on lit le code du jeu et la liste de ses fichiers (polices, sons, mots) dans l'archive du plugin (ctx.files.read) ;
//   2. on ouvre une iframe à part pour le jeu. Il lui faut sa propre page : pour se comporter comme Python, son code ajoute
//      des méthodes aux tableaux et aux objets de JavaScript, ce qui ne doit pas toucher la page du plugin ;
//   3. on répond à ses demandes par messages : lire un fichier, enregistrer une sauvegarde, ouvrir un lien.
// Les sauvegardes sont trois documents du dossier du plugin (ctx.folder) : config, progression, game_history.
const DOCS = ['config', 'progression', 'game_history'];
const MIN_W = 1200, MIN_H = 780;   // la taille de fenêtre du jeu d'origine : en dessous, le jeu est dessiné à cette taille puis rétréci, pour que rien ne se chevauche

// La page du jeu. CHILD est le petit programme qui tourne dedans, à côté du code du jeu.
const CHILD = `
const cv = document.getElementById('c'), say = m => parent.postMessage(m, '*'), waits = new Map(); let seq = 0, tn = null;
const fail = e => say({ tn: 'error', text: String(e && e.stack || e) });
const read = path => new Promise((ok, ko) => { const id = ++seq; waits.set(id, [ok, ko]); say({ tn: 'read', id, path }); });
const probe = () => { const s = tn && tn.state, g = tn && tn.app.screens.TYPING_GAME;
  return { tn: 'probe', ready: !!tn, frames: tn ? tn.frames : 0, screen: s ? s.GAME_STATE : '', error: tn && tn.error ? String(tn.error) : '', width: cv.width, height: cv.height,
    score: g ? g.score : 0, words: g ? g.word_objects.map(w => w.text) : [], paused: !!(tn && tn.paused) }; };
addEventListener('message', e => {
  if (e.source !== parent) return; const d = e.data || {};
  if (d.tn === 'data') { const w = waits.get(d.id); waits.delete(d.id); if (w) d.error ? w[1](new Error(d.error)) : w[0](new Uint8Array(d.bytes)); }
  else if (d.tn === 'init') __bootTypeNova({ canvas: cv, width: d.width, height: d.height, files: d.files, read, user: d.user, stayOpen: true,
      onsave: (name, text) => say({ tn: 'save', name, text }), openUrl: url => say({ tn: 'open', url }), onerror: fail })
    .then(t => { tn = t; tn.start(); say({ tn: 'ready' }); }, fail);
  else if (d.tn === 'pause' && tn) tn.pause(d.on);
  else if (d.tn === 'probe') say(probe());
  else if (d.tn === 'test' && tn) {   // pour test-neodex.js : change d'écran, lance une partie, tape un texte
    if (d.screen) tn.state.GAME_STATE = d.screen;
    if (d.newGame) { tn.state.GAME_STATE = 'TYPING_GAME'; tn.app.screens.TYPING_GAME.start_new_game(); }
    for (const ch of d.type || '') { dispatchEvent(new KeyboardEvent('keydown', { key: ch })); dispatchEvent(new KeyboardEvent('keyup', { key: ch })); tn.frame(); }
  }
});
// les raccourcis de NeoDex (Ctrl+…, Alt+…, F1 à F12) remontent à la page du plugin, qui les rend à NeoDex
addEventListener('keydown', e => { if (e.ctrlKey || e.altKey || e.metaKey || /^F\\d+$/.test(e.key)) say({ tn: 'key', key: e.key, code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey }); });
addEventListener('error', e => fail(e.error || e.message));
say({ tn: 'hello' });
`;
const page = code => '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#0d0a1a;overflow:hidden}canvas{display:block;width:100%;height:100%;outline:0;cursor:none}</style>'
  + '<canvas id="c" tabindex="0"></canvas><script>' + code.replace(/<\/script/gi, '<\\/script') + '</scr' + 'ipt><script>' + CHILD + '</scr' + 'ipt>';

export default async function (ctx) {
  const t = ctx.t || (s => s), view = ctx.view, dec = new TextDecoder();
  view.style.position = 'relative'; view.style.overflow = 'hidden'; view.style.background = '#0d0a1a';
  const note = ctx.el('div'); note.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;color:#cfc3ff;font-size:18px;text-align:center;padding:24px;white-space:pre-wrap;z-index:2';
  note.textContent = t('Chargement de TypeNova…'); view.append(note);
  const showError = text => { note.style.display = 'grid'; note.style.background = '#0d0a1aee'; note.textContent = t('TypeNova a rencontré une erreur.') + '\n\n' + String(text).split('\n').slice(0, 4).join('\n'); };

  let frame = null, ready = false;
  const post = (m, transfer) => frame && frame.contentWindow && frame.contentWindow.postMessage(m, '*', transfer || []);
  try {
    const [code, list] = await Promise.all([ctx.files.read('game/typenova.js'), ctx.files.read('game/files.json')]);
    const files = new Map(JSON.parse(dec.decode(list)));   // chemin vu par le jeu -> fichier dans l'archive
    const user = {};
    for (const name of DOCS) { const doc = await ctx.folder.read(name).catch(() => null); if (doc != null) user[name + '.json'] = JSON.stringify(doc); }

    // une sauvegarde à la fois par document, dans l'ordre où le jeu les écrit
    let saving = Promise.resolve(); const saved = window.__tnSaved = [];   // les documents enregistrés, dans l'ordre (lu par test-neodex.js)
    const save = (name, text) => {
      const doc = name.replace(/\.json$/, ''); if (!DOCS.includes(doc) || !name.endsWith('.json')) return;
      saving = saving.then(() => text == null ? ctx.folder.remove(doc) : ctx.folder.write(doc, JSON.parse(text))).then(() => { saved.push(doc); }).catch(e => ctx.ui.toast(t('Sauvegarde impossible') + ' : ' + (e && e.message || e), true));
    };

    addEventListener('message', async e => {
      if (!frame || e.source !== frame.contentWindow) return; const d = e.data || {};
      if (d.tn === 'hello') {
        const w = Math.max(1, view.clientWidth), h = Math.max(1, view.clientHeight), k = Math.min(1, w / MIN_W, h / MIN_H);
        post({ tn: 'init', width: Math.round(w / k), height: Math.round(h / k), files: [...files.keys()], user });
      } else if (d.tn === 'read') {
        try { const bytes = await ctx.files.read(files.get(d.path)); post({ tn: 'data', id: d.id, bytes: bytes.buffer }, [bytes.buffer]); }
        catch (err) { post({ tn: 'data', id: d.id, error: String(err && err.message || err) }); }
      } else if (d.tn === 'save') save(d.name, d.text);
      else if (d.tn === 'open') ctx.ui.newTab(d.url);
      else if (d.tn === 'ready') { ready = true; note.style.display = 'none'; frame.contentWindow.focus(); }
      else if (d.tn === 'error') showError(d.text);
      else if (d.tn === 'key') document.dispatchEvent(new KeyboardEvent('keydown', { key: d.key, code: d.code, ctrlKey: d.ctrlKey, altKey: d.altKey, shiftKey: d.shiftKey, metaKey: d.metaKey, bubbles: true }));
      else if (d.tn === 'probe') window.__tnProbe = d;
    });

    frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts'); frame.title = 'TypeNova';
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;display:block';
    frame.srcdoc = page(dec.decode(code));
    view.append(frame);
  } catch (e) { showError(e && e.message || e); return; }

  // la vue fermée : le jeu et sa musique s'arrêtent ; rouverte : ils reprennent, et le clavier revient au jeu
  ctx.onClose(() => post({ tn: 'pause', on: true }));
  ctx.onOpen(() => { post({ tn: 'pause', on: false }); if (ready) frame.contentWindow.focus(); });
  window.__tn = { post, probe: () => post({ tn: 'probe' }) };   // pour test-neodex.js
}
