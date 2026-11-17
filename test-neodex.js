// lancé par le test « local » de NeoDex : le jeu démarre, une partie se lance, taper un mot affiché donne des points,
// et la sauvegarde arrive dans le dossier du plugin.
// Le jeu tourne dans une iframe à part : on lui parle par messages (window.__tn.post) et il répond dans window.__tnProbe.
module.exports = async ({ pj, sleep, shot }) => {
  const probe = async () => { await pj(`window.__tnProbe = null; window.__tn.probe(); 0`); for (let i = 0; i < 40; i++) { await sleep(50); const p = await pj(`window.__tnProbe`); if (p) return p; } throw new Error('le jeu ne répond pas'); };
  let p; for (let i = 0; i < 60; i++) { await sleep(500); if (await pj(`!!window.__tn`)) { p = await probe().catch(() => null); if (p && p.ready) break; } }
  if (!p || !p.ready) throw new Error('le jeu ne démarre pas : ' + await pj(`document.body.innerText.slice(0, 300)`));
  if (p.error) throw new Error('erreur du jeu : ' + p.error);
  const f0 = p.frames; await sleep(1000); p = await probe();
  const fps = p.frames - f0; if (fps < 30) throw new Error('le jeu avance trop lentement : ' + fps + ' images en 1 s');
  await shot('accueil');
  await pj(`window.__tn.post({ tn: 'test', screen: 'MAIN_MENU' }); 0`); await sleep(1500); await shot('menu');
  await pj(`window.__tn.post({ tn: 'test', newGame: true }); 0`);
  for (let i = 0; i < 40 && !(p = await probe()).words.length; i++) await sleep(250);
  if (!p.words.length) throw new Error('aucun mot à l\'écran après le début de la partie');
  const word = p.words[0], before = p.score;
  await pj(`window.__tn.post({ tn: 'test', type: ${JSON.stringify(word)} }); 0`); await sleep(800); await shot('partie');
  p = await probe();
  if (p.error) throw new Error('erreur du jeu : ' + p.error);
  if (!(p.score > before)) throw new Error('taper « ' + word + ' » ne donne pas de points (' + before + ' -> ' + p.score + ')');
  const saved = await pj(`window.__tnSaved.join(',')`);
  if (!saved.includes('config')) throw new Error('aucune sauvegarde écrite dans le dossier du plugin : ' + saved);
  return 'jeu en ' + p.width + '×' + p.height + ', ' + fps + ' images par seconde, « ' + word + ' » tapé : ' + p.score + ' points, sauvegardes : ' + [...new Set(saved.split(','))].join(' ');
};
