/**
 * Banc d'essai : charge Sonar.plugin.js comme le fait BetterDiscord
 * (new Function avec require/module/exports injectes) contre de faux
 * modules Discord, et valide le cablage de bout en bout.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const PLUGIN = path.join(__dirname, "..", "Sonar.plugin.js");

let pass = 0, fail = 0;
const check = (label, cond, extra = "") => {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.log(`  ECHEC ${label} ${extra}`); }
};

/* ---------------------- Faux environnement navigateur ---------------------- */

const played = [];
globalThis.Audio = class {
    constructor(src) { this.src = src; this.volume = 1; }
    play() { played.push({src: this.src, volume: this.volume}); return Promise.resolve(); }
    pause() {}
};
globalThis.URL.createObjectURL = (blob) => `blob:fake/${blob.size}`;
globalThis.URL.revokeObjectURL = () => {};

const listeners = {};
globalThis.document = {
    title: "Discord",
    addEventListener: (t, fn) => { (listeners[t] ??= []).push(fn); },
    removeEventListener: () => {}
};
const notifications = [];
globalThis.Notification = class {
    constructor(title, opts) { notifications.push({title, ...opts}); }
    close() {}
};
globalThis.Notification.permission = "granted";

let flashed = 0;
globalThis.window = {
    DiscordNative: {window: {flashFrame: () => { flashed++; }}},
    Notification: globalThis.Notification,
    addEventListener: () => {},
    removeEventListener: () => {},
    focus: () => {}
};

/* --------------------------- Faux modules Discord -------------------------- */

const ME = "111111111111111111";
const FRIEND = "287654321098765432";
const CHANNEL = "999999999999999999";
const CATEGORY = "888888888888888888";

const subs = {};
const dispatcher = {
    dispatch() {}, register() {},
    subscribe(ev, fn) { (subs[ev] ??= new Set()).add(fn); },
    unsubscribe(ev, fn) { subs[ev]?.delete(fn); },
    emit(ev, payload) { for (const fn of subs[ev] ?? []) fn(payload); }
};

const sent = [], deleted = [];
const messageActions = {
    editMessage() {},
    sendMessage(channelId, data, wait, options) { sent.push({channelId, data, options}); return Promise.resolve({body: {id: `msg${sent.length}`}}); },
    deleteMessage(channelId, messageId) { deleted.push({channelId, messageId}); return Promise.resolve(); },
    fetchMessages() { return Promise.resolve(); }
};

const stores = {
    UserStore: {getCurrentUser: () => ({id: ME, username: "kenol"}), getUser: (id) => ({id}), _dispatcher: dispatcher},
    ChannelStore: {getChannel: (id) => (id === CHANNEL ? {id, name: "sonar", type: 0} : id === CATEGORY ? {id, name: "categorie", type: 4} : null)},
    MessageStore: {getMessages: () => ({toArray: () => []})},
    SelectedChannelStore: {getChannelId: () => CHANNEL},
    RelationshipStore: {getFriendIDs: () => [FRIEND]},
    StreamerModeStore: {enabled: false, disableSounds: false},
    MediaEngineStore: {getOutputVolume: () => 100}
};

/* --------------------------------- BdApi ---------------------------------- */

const saved = {};
const toasts = [], alerts = [];
const registeredCommands = [], patchedMenus = [];

function BdApiCtor(name) { this.pluginName = name; }
BdApiCtor.prototype.Data = {
    save: (k, v) => { saved[k] = v; },
    load: (k) => saved[k]
};
BdApiCtor.prototype.Commands = {
    register(cmd) { registeredCommands.push(cmd); return () => { registeredCommands.splice(registeredCommands.indexOf(cmd), 1); }; }
};

const BdApi = BdApiCtor;
BdApi.Logger = {warn: () => {}, info: () => {}, stacktrace: (...a) => { console.log("  [stacktrace]", a[1], a[2]?.message ?? ""); }};
BdApi.UI = {
    showToast: (msg, o) => toasts.push({msg, ...o}),
    showNotice: () => () => {},
    showNotification: () => true,
    alert: (title, body) => alerts.push({title, body}),
    buildSettingsPanel: (props) => ({__panel: true, ...props})
};
BdApi.Webpack = {
    Filters: {byKeys: (...k) => k},
    getStore: (n) => stores[n] ?? null,
    getByKeys: (...args) => {
        const keys = args.filter(a => typeof a === "string");
        if (keys.includes("subscribe") && keys.includes("dispatch")) return dispatcher;
        if (keys.includes("sendMessage")) return messageActions;
        if (keys.includes("setBadge")) return {setBadge() {}};
        return null;
    },
    waitForModule: () => Promise.resolve(dispatcher)
};
BdApi.Commands = {
    Types: {OptionTypes: {STRING: 3, USER: 6}},
    register: BdApiCtor.prototype.Commands.register
};
BdApi.ContextMenu = {
    patch(navId, cb) { patchedMenus.push({navId, cb}); return () => { patchedMenus.splice(patchedMenus.findIndex(p => p.cb === cb), 1); }; },
    buildItem: (item) => item
};
const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sonar-plugins-"));
BdApi.Plugins = {folder: pluginsDir};

// Faux GitHub : plugin distant + listing du dossier sounds.
const remote = {version: "9.9.9", fetched: []};
const remotePlugin = () => `/**\n * @name Sonar\n * @version ${remote.version}\n */\nmodule.exports = class {};\n${"//".padEnd(12_000, "x")}\n`;
const response = (body) => ({
    ok: true, status: 200,
    text: async () => body,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer
});
BdApi.Net = {
    fetch: async (url, opts) => {
        remote.fetched.push(url);
        (remote.headers ??= {})[url] = opts?.headers ?? {};
        if (url.includes("Sonar.plugin.js")) return response(remotePlugin());
        if (url.includes("/contents/sounds")) return response(JSON.stringify([
            {type: "file", name: "meurs.ogg", size: 4, download_url: "https://x/meurs.ogg"},
            {type: "file", name: "inconnu.ogg", size: 4, download_url: "https://x/inconnu.ogg"},
            {type: "file", name: "README.md", size: 4, download_url: "https://x/README.md"}
        ]));
        return response("OggS");
    }
};
globalThis.BdApi = BdApi;

/* ------------------------- Chargement facon BetterDiscord ------------------ */

console.log("-- Chargement --");
const source = fs.readFileSync(PLUGIN, "utf8");
const mod = {filename: PLUGIN, exports: {}};
new Function("require", "module", "exports", "__filename", "__dirname", source)(
    require, mod, mod.exports, PLUGIN, path.dirname(PLUGIN)
);
const Sonar = mod.exports;
check("export est une fonction/classe", typeof Sonar === "function");

const plugin = new Sonar({name: "Sonar", version: "0.1.0"});
check("instanciation sans erreur", !!plugin);
check("start/stop presents", typeof plugin.start === "function" && typeof plugin.stop === "function");

console.log("-- Demarrage --");
plugin.start();
check("abonne a MESSAGE_CREATE", subs.MESSAGE_CREATE?.size === 1);
check("abonne a CONNECTION_OPEN", subs.CONNECTION_OPEN?.size === 1);
check("commandes enregistrees (/sonar, /sonar-ici)", registeredCommands.length === 2,
      `(${registeredCommands.map(c => c.name).join(", ")})`);
check("menus contextuels patches", patchedMenus.length === 2);

plugin.start(); // idempotence
check("start() idempotent (pas de double abonnement)", subs.MESSAGE_CREATE.size === 1);

console.log("-- Configuration --");
const userMenu = patchedMenus.find(p => p.navId instanceof RegExp);
check("menu utilisateur cible tous les navId 'user' (salon vocal, profil...)",
      ["user-context", "user-profile-actions"].every(n => userMenu?.navId.test(n)) && !userMenu.navId.test("channel-context"));
const openUserMenu = (user, children = [], extra = {}) => {
    const rv = {props: {children}};
    userMenu.cb(rv, {user, ...extra});
    return rv.props.children;
};
check("clic droit sans salon : entree visible et explicite",
      openUserMenu({id: FRIEND}).some(i => i.type === "item" && i.label.includes("salon à configurer")));

// Categorie : aucun message possible, refusee partout. Un salon vocal (chat integre) reste accepte.
const channelMenu = patchedMenus.find(p => p.navId === "channel-context");
const openChannelMenu = (channel) => { const rv = {props: {children: []}}; channelMenu.cb(rv, {channel}); return rv.props.children; };
check("clic droit sur une categorie : pas de « Definir comme salon Sonar »", openChannelMenu({id: CATEGORY, name: "categorie", type: 4}).length === 0);
check("clic droit sur un salon vocal (chat integre) : entree presente", openChannelMenu({id: "777777777777777777", name: "vocal", type: 2}).some(i => i.id === "sonar-set-channel"));
check("clic droit sur un salon texte : entree presente", openChannelMenu({id: CHANNEL, name: "sonar", type: 0}).some(i => i.id === "sonar-set-channel"));
stores.SelectedChannelStore.getChannelId = () => CATEGORY;
const setChannel = registeredCommands.find(c => c.name === "sonar-ici");
check("/sonar-ici refuse une categorie", setChannel.execute([], {}).content.includes("❌") && !plugin.settings.channelId);
stores.SelectedChannelStore.getChannelId = () => CHANNEL;
setChannel.execute([], {});
check("/sonar-ici definit le salon", plugin.settings.channelId === CHANNEL);
check("/sonar masquee sans salon devient visible", registeredCommands.find(c => c.name === "sonar").predicate() === true);

const menu = openUserMenu({id: FRIEND});
const submenu = menu.find(i => i.id === "sonar-send");
check("clic droit sur un ami : sous-menu Envoyer un Sonar",
      submenu?.type === "submenu" && submenu.items.length === 10 && submenu.items.every(i => typeof i.action === "function"));
check("clic droit : menu en element unique gere", openUserMenu({id: FRIEND}, {type: "group"}).length === 3);
check("clic droit sur soi-meme : rien", openUserMenu({id: ME}).length === 0);
check("clic droit sur un bot : rien", openUserMenu({id: FRIEND, bot: true}).length === 0);
check("menu avec seulement userId (ex. salon vocal)",
      openUserMenu(undefined, [], {userId: FRIEND}).some(i => i.id === "sonar-send"));
check("menu avec l'utilisateur sous une autre cle (participant vocal)",
      openUserMenu(undefined, [], {participant: {user: {id: FRIEND, username: "Alice"}}}).some(i => i.id === "sonar-send"));
check("menu sans utilisateur : rien", openUserMenu(undefined, [], {channel: {id: CHANNEL}}).length === 0);
// Repli DOM : l'action part au pointerdown et toute la sequence est avalee.
{
    let fired = 0, stopped = 0;
    const item = {sonarAction: () => { fired++; }};
    const ev = (type, button = 0, target = {closest: () => item}) => ({
        type, button, target,
        preventDefault() {}, stopPropagation() { stopped++; }, stopImmediatePropagation() {}
    });
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) plugin.menuInjector.handlePointer(ev(type));
    check("menu DOM : action declenchee une seule fois, au pointerdown", fired === 1, `(${fired})`);
    check("menu DOM : sequence souris avalee (Discord ne ferme pas le menu)", stopped === 5);
    plugin.menuInjector.handlePointer(ev("pointerdown", 2));
    check("menu DOM : clic droit ignore", fired === 1);
    const before = stopped;
    plugin.menuInjector.handlePointer(ev("pointerdown", 0, {closest: () => null}));
    check("menu DOM : clics ailleurs non interceptes", fired === 1 && stopped === before);
}
const nested = openUserMenu({id: FRIEND});
check("menus imbriques : une seule entree", openUserMenu({id: FRIEND}, nested).length === nested.length);

// Fichier son reel pour exercer SoundBank
const soundFile = path.join(os.tmpdir(), "sonar-test.wav");
fs.writeFileSync(soundFile, Buffer.from("RIFF$\0\0\0WAVEfmt ", "binary"));
plugin.settings.sounds.alarme = soundFile;
plugin.settings.allowlist = [FRIEND];

console.log("-- Reception d'un signal --");
let nonceSeq = 0;
const sig = (nonce) => `\u{1F50A} SONAR|1|<@${ME}>|alarme|${nonce}|Reveille-toi`;
const signal = sig("7f3a9c21");
// Chaque emit() utilise un nonce distinct : sinon la deduplication ecarte le
// signal avant les garde-fous, et on ne testerait pas ce qu'on croit tester.
const emit = (overrides = {}) => dispatcher.emit("MESSAGE_CREATE", {
    channelId: CHANNEL,
    message: {
        id: "m" + (++nonceSeq),
        content: sig(String(nonceSeq).padStart(8, "a")),
        author: {id: FRIEND, username: "Alice"}
    },
    ...overrides
});

emit();
check("son joue", played.length === 1, `(${played.length})`);
check("volume plafonne a 0.8 par defaut", played[0]?.volume === 0.8, `(${played[0]?.volume})`);
check("notification Windows emise", notifications.length === 1);
check("notification silencieuse (silent:true)", notifications[0]?.silent === true);
check("barre des taches clignote", flashed === 1);
check("compteur de recus incremente", plugin.settings.stats.received === 1);

console.log("-- Garde-fous --");
const before = played.length;
emit();
check("cooldown bloque le 2e signal immediat", played.length === before);
check("compteur de bloques incremente", plugin.settings.stats.blocked === 1);

// Un doublon est ecarte AVANT les garde-fous : le compteur ne doit pas bouger.
const blockedBefore = plugin.settings.stats.blocked;
dispatcher.emit("MESSAGE_CREATE", {channelId: CHANNEL, message: {id: "m1", content: sig("aaaaaaa1"), author: {id: FRIEND}}});
check("doublon ecarte avant les garde-fous", plugin.settings.stats.blocked === blockedBefore);

played.length = 0;
dispatcher.emit("MESSAGE_CREATE", {channelId: CHANNEL, message: {id: "x1", content: signal, author: {id: ME}}});
check("auto-ping ignore (auteur = moi)", played.length === 0);

dispatcher.emit("MESSAGE_CREATE", {channelId: "autre", message: {id: "x2", content: signal, author: {id: FRIEND}}});
check("autre salon ignore", played.length === 0);

dispatcher.emit("MESSAGE_CREATE", {channelId: CHANNEL, message: {id: "x3", content: "salut", author: {id: FRIEND}}});
check("message normal ignore", played.length === 0);

dispatcher.emit("MESSAGE_CREATE", {optimistic: true, channelId: CHANNEL, message: {id: "x4", content: signal, author: {id: FRIEND}}});
check("message optimiste ignore", played.length === 0);

const otherTarget = `\u{1F50A} SONAR|1|<@555555555555555555>|alarme|aaaaaaaa`;
dispatcher.emit("MESSAGE_CREATE", {channelId: CHANNEL, message: {id: "x5", content: otherTarget, author: {id: FRIEND}}});
check("signal destine a autrui ignore", played.length === 0);

console.log("-- Emission --");
const sonarCmd = registeredCommands.find(c => c.name === "sonar");
const res = sonarCmd.execute([{name: "ami", value: FRIEND}, {name: "son", value: "klaxon"}, {name: "message", value: "hop"}], {});
Promise.resolve(res).then(async (r) => {
    check("message envoye dans le bon salon", sent[0]?.channelId === CHANNEL);
    check("4 champs requis presents", sent[0] && ["content", "tts", "invalidEmojis", "validNonShortcutEmojis"].every(k => k in sent[0].data));
    check("contenu au format protocole", /^\u{1F50A} SONAR\|1\|<@\d+>\|klaxon\|[0-9a-f]{8}\|hop$/u.test(sent[0]?.data.content ?? ""));
    check("accuse de reception local", r?.content?.includes("✅"));

    check("suppression auto : rien avant le delai", deleted.length === 0);
    plugin.sender.flushDeletes(); // arret / rechargement : on supprime tout de suite
    check("suppression auto : le signal envoye est supprime",
          deleted.length === 1 && deleted[0].channelId === CHANNEL && deleted[0].messageId === "msg1", JSON.stringify(deleted));
    plugin.sender.flushDeletes();
    check("suppression auto : une seule fois", deleted.length === 1);

    console.log("-- Panneau de reglages --");
    const panel = plugin.getSettingsPanel();
    check("panneau construit", panel?.__panel === true);
    const cats = panel.settings.filter(s => s.type === "category").map(s => s.id);
    check("categories attendues", JSON.stringify(cats) === JSON.stringify(["general", "sounds", "visual", "guards"]), `(${cats})`);
    const soundsCat = panel.settings.find(s => s.id === "sounds");
    check("un reglage file par son", soundsCat.settings.filter(s => s.type === "file").length === 10);

    panel.onChange("sounds", "volume", 0.5);
    check("onChange ecrit le reglage", plugin.settings.volume === 0.5);

    // Regression : BetterDiscord rend les reglages "button" via son composant Button,
    // qui ignore onChange et n'ecoute que onClick. Un bouton sans onClick est mort.
    const allSettings = panel.settings.flatMap(s => s.type === "category" ? s.settings : [s]);
    const buttons = allSettings.filter(s => s.type === "button");
    check("des boutons sont declares", buttons.length === 14, `(${buttons.length})`);
    check("tout bouton a un onClick", buttons.every(b => typeof b.onClick === "function"),
          `(sans onClick: ${buttons.filter(b => typeof b.onClick !== "function").map(b => b.id).join(", ")})`);

    buttons.find(b => b.id === "importFriends").onClick();
    check("bouton Importer alimente l'allowlist", plugin.settings.allowlist.includes(FRIEND));

    buttons.find(b => b.id === "diag").onClick();
    check("bouton Diagnostic produit un rapport", alerts.length === 1 && alerts[0].body.includes("Dispatcher"));

    played.length = 0;
    buttons.find(b => b.id === "test_alarme").onClick();
    check("bouton Ecouter joue le son", played.length === 1);
    buttons.find(b => b.id === "test_klaxon").onClick();
    check("Ecouter sans fichier ne joue rien", played.length === 1);
    check("Ecouter sans fichier avertit", toasts.at(-1)?.msg.includes("aucun fichier"), `(${toasts.at(-1)?.msg})`);

    // Simulation : le cooldown de FRIEND/global est encore actif ici, elle doit passer quand meme.
    panel.onChange("general", "simSound", "alarme");
    check("choix du son a simuler enregistre", plugin.settings.simSound === "alarme");
    played.length = 0;
    const notifBefore = notifications.length;
    const statsBefore = JSON.stringify(plugin.settings.stats);
    buttons.find(b => b.id === "simulate").onClick();
    buttons.find(b => b.id === "simulate").onClick();
    check("Simuler joue le son malgre les cooldowns", played.length === 2, `(${played.length})`);
    check("Simuler emet l'alerte visuelle", notifications.length === notifBefore + 2);
    check("Simuler ne touche pas aux stats", JSON.stringify(plugin.settings.stats) === statsBefore);
    check("Simuler n'envoie rien", sent.length === 1, `(${sent.length})`);
    panel.onChange("general", "simSound", "klaxon");
    buttons.find(b => b.id === "simulate").onClick();
    check("Simuler sans fichier avertit", played.length === 2 && toasts.at(-1)?.msg.includes("aucun fichier"));

    // Le composant file renvoie une string quand `multiple` n'est pas vrai.
    const soundsCatSettings = panel.settings.find(s => s.id === "sounds").settings;
    check("note du fichier affiche le nom choisi",
          soundsCatSettings.find(s => s.id === "file_alarme").note.includes("sonar-test.wav"));
    panel.onChange("sounds", "file_klaxon", soundFile);
    check("choix d'un fichier enregistre le chemin", plugin.settings.sounds.klaxon === soundFile);
    check("choix d'un fichier donne un retour", toasts.at(-1)?.msg.includes("sonar-test.wav"));
    panel.onChange("sounds", "file_klaxon", "");
    check("effacement du fichier pris en compte", plugin.settings.sounds.klaxon === "");

    check("aucun enableWith dans une categorie (bug BD 1.14.1)",
          allSettings.every(s => !("enableWith" in s)));

    console.log("-- Mises a jour --");
    const installed = path.join(pluginsDir, "Sonar.plugin.js");
    await buttons.find(b => b.id === "checkUpdates").onClick();
    check("bouton Verifier installe la version distante",
          fs.existsSync(installed) && fs.readFileSync(installed, "utf8").includes("@version 9.9.9"));
    check("toast de mise a jour", toasts.some(t => t.msg.includes("mis à jour en 9.9.9")));
    // Le CDN raw.githubusercontent.com sert l'ancienne version plusieurs minutes : passer par l'API.
    const pluginUrl = remote.fetched.find(u => u.includes("Sonar.plugin.js"));
    check("plugin lu via l'API GitHub (pas le CDN raw)",
          pluginUrl?.startsWith("https://api.github.com/") && remote.headers[pluginUrl]?.Accept === "application/vnd.github.raw",
          `(${pluginUrl})`);

    remote.version = "0.1.0";
    await plugin.updater.checkPlugin({manual: true});
    check("meme version : rien a faire", toasts.at(-1)?.msg.includes("à jour (0.1.0)"));

    remote.version = "9.9.10";
    panel.onChange("general", "autoUpdate", false);
    fs.unlinkSync(installed);
    await plugin.updater.checkPlugin();
    check("auto desactive : rien d'installe sans clic", !fs.existsSync(installed));
    panel.onChange("general", "autoUpdate", true);

    const sounds = path.join(pluginsDir, "sounds");
    check("son du catalogue telecharge", fs.existsSync(path.join(sounds, "meurs.ogg")));
    check("fichiers hors catalogue ignores",
          !fs.existsSync(path.join(sounds, "inconnu.ogg")) && !fs.existsSync(path.join(sounds, "README.md")));
    const meursNote = plugin.getSettingsPanel().settings
        .find(s => s.id === "sounds").settings.find(s => s.id === "file_meurs").note;
    check("son telecharge trouve automatiquement", meursNote.includes("automatiquement"), `(${meursNote})`);
    const downloads = remote.fetched.filter(u => u.endsWith("/meurs.ogg")).length;
    await plugin.updater.syncSounds();
    check("son deja present non retelecharge", remote.fetched.filter(u => u.endsWith("/meurs.ogg")).length === downloads);

    console.log("-- Arret --");
    plugin.stop();
    check("desabonne de MESSAGE_CREATE", (subs.MESSAGE_CREATE?.size ?? 0) === 0);
    check("desabonne de CONNECTION_OPEN", (subs.CONNECTION_OPEN?.size ?? 0) === 0);
    check("commandes desenregistrees", registeredCommands.length === 0);
    check("menus depatches", patchedMenus.length === 0);
    check("reglages persistes sur disque", !!saved.settings && saved.settings.channelId === CHANNEL);

    try { fs.unlinkSync(soundFile); } catch {}
    try { fs.rmSync(pluginsDir, {recursive: true, force: true}); } catch {}
    console.log(`\n${pass} reussis, ${fail} echoues`);
    process.exit(fail ? 1 : 0);
});
