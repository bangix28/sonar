/**
 * @name Sonar
 * @author kenol
 * @description Envoie une notification sonore ciblée à un ami, insensible à la sourdine et au Ne pas déranger.
 * @version 0.3.0
 * @source https://github.com/bangix28/sonar
 * @updateUrl https://raw.githubusercontent.com/bangix28/sonar/main/Sonar.plugin.js
 */

"use strict";

/* ====================================================================== *
 * §0  CONSTANTES
 * ====================================================================== */

const PROTOCOL_VERSION = 1;
const SCHEMA_VERSION = 1;

/** 🔊 — sentinelle mono-caractère, préfiltre O(1) sur le flux global de messages. */
const SENTINEL = 0x1f50a;
const SIGNAL_MAX_LEN = 320;
const MESSAGE_MAX_LEN = 200;

const DEDUPE_WINDOW_MS = 120_000;
const REPLAY_MAX_AGE_MS = 300_000;
const SAVE_DEBOUNCE_MS = 300;
const MAX_CONCURRENT_SOUNDS = 3;
const COOLDOWN_FLOOR_S = 5; // plancher non désactivable, cf. garde-fous produit

const SOUND_CATALOG = [
    {id: "ping", label: "Ping"},
    {id: "alarme", label: "Alarme"},
    {id: "klaxon", label: "Klaxon"},
    {id: "cloche", label: "Cloche"},
    {id: "urgence", label: "Urgence"},
    {id: "meurs", label: "Meurs"},
    {id: "cul", label: "Cul"},
    {id: "le-tue", label: "Le tue"},
    {id: "merde", label: "Merde"},
    {id: "recommence", label: "Recommence"}
];

const REPO = "bangix28/sonar";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main/`;
const UPDATE_CHECK_DELAY_MS = 15_000;
const UPDATE_INTERVAL_MS = 6 * 3600_000;

/** Sous-dossiers du dossier plugins où les sons sont cherchés quand aucun fichier n'est choisi. */
const DEFAULT_SOUNDS_DIRS = ["sonar-sounds", "sounds"];

const MIME_BY_EXT = {
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".webm": "audio/webm"
};

/** Nom de fichier seul, sans dépendre du polyfill `path`. */
function basename(filePath) {
    return String(filePath ?? "").split(/[\\/]/).pop() || "";
}

/** Buffer WAV silencieux, sert à « armer » le contexte audio après un refus d'autoplay. */
const SILENT_WAV =
    "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

const DEFAULTS = {
    schemaVersion: SCHEMA_VERSION,
    enabled: true,
    channelId: "",
    mentionOnSend: true,

    sounds: {},        // soundId -> chemin absolu
    soundVolumes: {},  // soundId -> 0..1
    volume: 0.8,
    maxVolume: 1,
    followDiscordVolume: true,
    overlap: "stop",   // "stop" | "queue" | "allow"

    visualToast: true,
    visualNative: true,
    visualFlash: true,

    allowAnyone: false,
    allowlist: [],
    cooldownPerSender: 30,
    cooldownGlobal: 5,
    quietHoursEnabled: false,
    quietStart: "22:00",
    quietEnd: "07:00",
    respectStreamerMode: true,
    replayOnReconnect: true,

    simSound: "ping",  // son choisi pour le bouton « Simuler une réception »
    autoUpdate: true,

    stats: {received: 0, blocked: 0, sent: 0}
};

/* ====================================================================== *
 * §1  MODULES — le SEUL endroit du fichier qui touche BdApi.Webpack.
 *     Résolution paresseuse : rien ne doit être résolu au chargement du
 *     fichier, les chunks lazy de Discord n'existent pas encore.
 * ====================================================================== */

class Modules {
    static #cache = {};

    static #get(key, resolver) {
        if (!(key in this.#cache)) {
            try {
                this.#cache[key] = resolver() ?? null;
            } catch (err) {
                BdApi.Logger.stacktrace("Sonar", `Résolution du module « ${key} » échouée`, err);
                this.#cache[key] = null;
            }
        }
        return this.#cache[key];
    }

    static invalidate(key) {
        if (key) delete this.#cache[key];
        else this.#cache = {};
    }

    /** Cascade de 3 replis — c'est le module le plus critique du plugin. */
    static get dispatcher() {
        return this.#get("dispatcher", () =>
            BdApi.Webpack.getByKeys("dispatch", "subscribe", "register", {searchExports: true})
            ?? BdApi.Webpack.getByKeys("actionLogger")
            ?? BdApi.Webpack.getStore("UserStore")?._dispatcher
        );
    }

    static get messageActions() {
        return this.#get("messageActions", () =>
            BdApi.Webpack.getByKeys("sendMessage", "editMessage")
            ?? BdApi.Webpack.getByKeys("sendMessage", "receiveMessage")
        );
    }

    static get userStore() {
        return this.#get("userStore", () => BdApi.Webpack.getStore("UserStore"));
    }

    static get channelStore() {
        return this.#get("channelStore", () => BdApi.Webpack.getStore("ChannelStore"));
    }

    static get messageStore() {
        return this.#get("messageStore", () => BdApi.Webpack.getStore("MessageStore"));
    }

    static get selectedChannelStore() {
        return this.#get("selectedChannelStore", () => BdApi.Webpack.getStore("SelectedChannelStore"));
    }

    static get relationshipStore() {
        return this.#get("relationshipStore", () => BdApi.Webpack.getStore("RelationshipStore"));
    }

    static get streamerModeStore() {
        return this.#get("streamerModeStore", () => BdApi.Webpack.getStore("StreamerModeStore"));
    }

    static get mediaEngineStore() {
        return this.#get("mediaEngineStore", () => BdApi.Webpack.getStore("MediaEngineStore"));
    }

    /** Module natif qui pilote le badge de la barre des tâches — voisin probable de flashFrame. */
    static get remoteModule() {
        return this.#get("remoteModule", () => BdApi.Webpack.getByKeys("setBadge"));
    }

    static get currentUserId() {
        // JAMAIS mis en cache : getCurrentUser() rend null tant que la session n'est pas établie,
        // et un cache à undefined garantirait l'auto-ping.
        return this.userStore?.getCurrentUser?.()?.id ?? null;
    }

    static health() {
        return {
            "Dispatcher (réception)": !!this.dispatcher?.subscribe,
            "MessageActions (émission)": typeof this.messageActions?.sendMessage === "function",
            "UserStore": !!this.userStore?.getCurrentUser,
            "ChannelStore": !!this.channelStore?.getChannel,
            "MessageStore (rejeu)": !!this.messageStore?.getMessages,
            "RelationshipStore (amis)": !!this.relationshipStore?.getFriendIDs,
            "StreamerModeStore": !!this.streamerModeStore,
            "MediaEngineStore (volume)": !!this.mediaEngineStore?.getOutputVolume,
            "Commandes slash": typeof BdApi.Commands?.register === "function",
            "Menu contextuel": typeof BdApi.ContextMenu?.patch === "function"
        };
    }
}

/* ====================================================================== *
 * §2  STORE — chargement, migration, sauvegarde debouncée.
 * ====================================================================== */

function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(base, override) {
    const out = Array.isArray(base) ? [...base] : {...base};
    if (!isPlainObject(override)) return out;
    for (const [key, value] of Object.entries(override)) {
        out[key] = isPlainObject(value) && isPlainObject(base?.[key])
            ? deepMerge(base[key], value)
            : value;
    }
    return out;
}

class Store {
    #api;
    #data;
    #timer = null;

    constructor(api) {
        this.#api = api;
        this.#data = this.#migrate(this.#api.Data.load("settings"));
    }

    get data() {
        return this.#data;
    }

    #migrate(loaded) {
        // Fusion systématique avec les défauts : sans ça, chaque réglage ajouté
        // dans une version ultérieure vaut undefined chez les utilisateurs existants.
        const merged = deepMerge(DEFAULTS, loaded ?? {});
        merged.schemaVersion = SCHEMA_VERSION;
        if (!Array.isArray(merged.allowlist)) merged.allowlist = [];
        return merged;
    }

    set(path, value) {
        const keys = path.split(".");
        let node = this.#data;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!isPlainObject(node[keys[i]])) node[keys[i]] = {};
            node = node[keys[i]];
        }
        node[keys.at(-1)] = value;
        this.save();
    }

    bump(statKey) {
        this.#data.stats[statKey] = (this.#data.stats[statKey] ?? 0) + 1;
        this.save();
    }

    /** Un slider émet onChange à chaque pixel : sans debounce, une écriture disque par pixel. */
    save() {
        clearTimeout(this.#timer);
        this.#timer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
    }

    flush() {
        clearTimeout(this.#timer);
        this.#timer = null;
        try {
            this.#api.Data.save("settings", this.#data);
        } catch (err) {
            BdApi.Logger.stacktrace("Sonar", "Sauvegarde des réglages échouée", err);
        }
    }
}

/* ====================================================================== *
 * §3  PROTOCOL — pur, sans dépendance. Copiable tel quel en console DevTools.
 *
 *     🔊 SONAR|1|<@287654321098765432>|alarme|7f3a9c21|Réveille-toi
 * ====================================================================== */

const Protocol = {
    // Regex ancrée, une seule alternance, quantificateurs bornés : pas de
    // backtracking catastrophique possible sur un flux de messages non fiable.
    RE: /^🔊 SONAR\|(\d{1,2})\|<@!?(\d{15,25})>\|([a-z0-9_-]{1,24})\|([0-9a-f]{8})(?:\|([\s\S]{0,200}))?$/,

    nonce() {
        const n = globalThis.crypto?.getRandomValues?.(new Uint32Array(1))?.[0]
            ?? Math.floor(Math.random() * 0xffffffff);
        return n.toString(16).padStart(8, "0").slice(0, 8);
    },

    encode({targetId, soundId, message}) {
        const clean = String(message ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, MESSAGE_MAX_LEN);
        const head = `\u{1F50A} SONAR|${PROTOCOL_VERSION}|<@${targetId}>|${soundId}|${this.nonce()}`;
        return clean ? `${head}|${clean}` : head;
    },

    parse(content) {
        if (typeof content !== "string") return null;
        if (content.codePointAt(0) !== SENTINEL) return null;   // préfiltre O(1)
        if (content.length > SIGNAL_MAX_LEN) return null;
        const m = this.RE.exec(content.trim());
        if (!m) return null;
        const [, version, targetId, soundId, nonce, message] = m;
        if (Number(version) !== PROTOCOL_VERSION) return null;  // version future : ignorée proprement
        return {version: PROTOCOL_VERSION, targetId, soundId, nonce, message: message ?? ""};
    }
};

/* ====================================================================== *
 * §4  SOUNDBANK — fichier local → Blob → objectURL, cache invalidé au mtime.
 *
 *     new Audio("file:///…") NE MARCHE PAS : Chromium interdit le chargement
 *     d'une sous-ressource file:// depuis une page https://.
 * ====================================================================== */

class SoundBank {
    #cache = new Map(); // filePath -> {url, mtimeMs}
    #fs = null;
    #path = null;

    #node() {
        if (!this.#fs) {
            try {
                this.#fs = require("fs");
                this.#path = require("path");
            } catch (err) {
                BdApi.Logger.stacktrace("Sonar", "Polyfill fs/path indisponible", err);
            }
        }
        return this.#fs && this.#path;
    }

    /** Renvoie une objectURL jouable, ou null. Synchrone (IPC bloquant) : appeler au préchargement. */
    load(filePath) {
        if (!filePath || !this.#node()) return null;
        const hit = this.#cache.get(filePath);
        try {
            const stat = this.#fs.statSync(filePath);
            if (hit && hit.mtimeMs === stat.mtimeMs) return hit.url;

            // "base64" explicite : le polyfill fs de BetterDiscord a "utf-8" comme
            // encodage par défaut (pas null), un readFileSync nu rend une string corrompue.
            const b64 = this.#fs.readFileSync(filePath, "base64");
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

            const ext = this.#path.extname(filePath).toLowerCase();
            const url = URL.createObjectURL(new Blob([bytes], {type: MIME_BY_EXT[ext] ?? "audio/mpeg"}));

            if (hit) URL.revokeObjectURL(hit.url);
            this.#cache.set(filePath, {url, mtimeMs: stat.mtimeMs});
            return url;
        } catch (err) {
            BdApi.Logger.warn("Sonar", `Son illisible : ${filePath} (${err?.message ?? err})`);
            if (hit) {
                URL.revokeObjectURL(hit.url);
                this.#cache.delete(filePath);
            }
            return null;
        }
    }

    preload(soundMap) {
        for (const filePath of Object.values(soundMap ?? {})) {
            if (filePath) this.load(filePath);
        }
    }

    /**
     * Repli quand aucun fichier n'est choisi : `<soundId>.<ext>` dans un dossier de
     * sons posé à côté du plugin. Permet de distribuer plugin + dossier de sons sans
     * que chaque destinataire ait à cliquer « Parcourir » pour chaque son.
     */
    findDefault(soundId) {
        const folder = BdApi.Plugins?.folder;
        if (!soundId || !folder || !this.#node()) return "";
        for (const dir of DEFAULT_SOUNDS_DIRS) {
            for (const ext of Object.keys(MIME_BY_EXT)) {
                const candidate = this.#path.join(folder, dir, `${soundId}${ext}`);
                if (this.exists(candidate)) return candidate;
            }
        }
        return "";
    }

    exists(filePath) {
        if (!filePath || !this.#node()) return false;
        try {
            return this.#fs.statSync(filePath).size > 0;
        } catch {
            return false;
        }
    }

    dispose() {
        for (const {url} of this.#cache.values()) URL.revokeObjectURL(url);
        this.#cache.clear();
    }
}

/* ====================================================================== *
 * §5  PLAYER — lecture, plafond de volume, anti-superposition.
 * ====================================================================== */

class Player {
    #playing = new Set();
    #queue = [];
    #unlockNeeded = false;
    #unlockHandler = null;

    constructor(settings) {
        this.settings = settings;
    }

    #effectiveVolume(soundId) {
        const s = this.settings();
        const perSound = s.soundVolumes?.[soundId] ?? 1;
        const discord = s.followDiscordVolume
            ? (Modules.mediaEngineStore?.getOutputVolume?.() ?? 100) / 100
            : 1;
        // Le plafond est une protection auditive : appliqué en dernier.
        return Math.max(0, Math.min(s.volume * perSound * discord, s.maxVolume, 1));
    }

    async play(url, soundId) {
        if (!url) return false;
        const mode = this.settings().overlap;

        if (mode === "stop") this.stopAll();
        if (this.#playing.size >= MAX_CONCURRENT_SOUNDS) {
            if (mode !== "queue") return false;
            this.#queue.push({url, soundId});
            return false;
        }

        const audio = new Audio(url);
        audio.volume = this.#effectiveVolume(soundId);
        audio.onended = audio.onerror = () => {
            this.#playing.delete(audio);
            const next = this.#queue.shift();
            if (next) this.play(next.url, next.soundId);
        };
        this.#playing.add(audio);

        try {
            await audio.play();
            return true;
        } catch (err) {
            // Autoplay refusé : Chromium exige une interaction utilisateur préalable.
            this.#playing.delete(audio);
            BdApi.Logger.warn("Sonar", "Lecture audio bloquée (autoplay)", err);
            this.#armUnlock();
            return false;
        }
    }

    #armUnlock() {
        if (this.#unlockNeeded) return;
        this.#unlockNeeded = true;
        BdApi.UI.showNotice(
            "Sonar : lecture audio bloquée par le navigateur. Clique n'importe où dans Discord pour la débloquer.",
            {type: "warning", timeout: 0}
        );
    }

    /** Joue un buffer silencieux au premier clic pour armer le contexte audio. */
    installUnlockListener() {
        this.#unlockHandler = () => {
            const a = new Audio(SILENT_WAV);
            a.volume = 0;
            a.play().then(() => {
                this.#unlockNeeded = false;
            }).catch(() => {});
        };
        document.addEventListener("pointerdown", this.#unlockHandler, {once: true, capture: true});
    }

    removeUnlockListener() {
        if (this.#unlockHandler) {
            document.removeEventListener("pointerdown", this.#unlockHandler, {capture: true});
            this.#unlockHandler = null;
        }
    }

    stopAll() {
        for (const audio of this.#playing) {
            try {
                audio.pause();
                audio.src = "";
            } catch { /* rien à faire */ }
        }
        this.#playing.clear();
        this.#queue.length = 0;
    }
}

/* ====================================================================== *
 * §6  ALERTER — notification BD, toast Windows, flash de la barre des tâches.
 * ====================================================================== */

class Alerter {
    #blinkTimer = null;
    #originalTitle = null;
    #focusHandler = null;

    constructor(settings) {
        this.settings = settings;
    }

    notify({senderName, soundLabel, message, nonce}) {
        const s = this.settings();
        if (!s.visualToast && !s.visualNative && !s.visualFlash) return;

        const title = `Sonar — ${senderName}`;
        const body = message || `${soundLabel} de ${senderName}`;

        if (s.visualToast) this.#inDiscord(title, body, nonce);
        if (s.visualNative) this.#windows(title, body, nonce);
        if (s.visualFlash) this.flash();
    }

    #inDiscord(title, body, nonce) {
        try {
            // showNotification rend undefined si les notifications BD sont désactivées
            // globalement — on double toujours par un toast dans ce cas.
            const shown = BdApi.UI.showNotification?.({
                id: `sonar-${nonce}`,
                title,
                content: body,
                type: "warning",
                duration: 10_000
            });
            if (!shown) BdApi.UI.showToast(`🔊 ${title} — ${body}`, {type: "warning", timeout: 6000, forceShow: true});
        } catch (err) {
            BdApi.Logger.warn("Sonar", "Notification interne échouée", err);
        }
    }

    #windows(title, body, nonce) {
        try {
            if (!window.Notification || Notification.permission !== "granted") return;
            // silent: true — on joue NOTRE son, pas celui de Windows par-dessus.
            const n = new Notification(title, {body, silent: true, tag: `sonar-${nonce}`});
            n.onclick = () => {
                try {
                    window.focus();
                    n.close();
                } catch { /* rien à faire */ }
            };
        } catch (err) {
            BdApi.Logger.warn("Sonar", "Notification Windows échouée", err);
        }
    }

    /** Cascade : natif si disponible, sinon clignotement du titre (marche partout). */
    flash() {
        const native = window.DiscordNative?.window;
        if (typeof native?.flashFrame === "function") {
            try {
                native.flashFrame(true);
                return "native";
            } catch { /* on descend d'un cran */ }
        }

        const remote = Modules.remoteModule;
        if (typeof remote?.flashFrame === "function") {
            try {
                remote.flashFrame(true);
                return "webpack";
            } catch { /* on descend d'un cran */ }
        }

        this.#blinkTitle();
        return "fallback";
    }

    #blinkTitle() {
        if (this.#blinkTimer) return;
        this.#originalTitle = document.title;
        let on = false;
        this.#blinkTimer = setInterval(() => {
            document.title = (on = !on) ? "🔊 SONAR" : this.#originalTitle;
        }, 800);

        this.#focusHandler = () => this.stopBlink();
        window.addEventListener("focus", this.#focusHandler, {once: true});
        setTimeout(() => this.stopBlink(), 30_000); // filet de sécurité
    }

    stopBlink() {
        if (!this.#blinkTimer) return;
        clearInterval(this.#blinkTimer);
        this.#blinkTimer = null;
        if (this.#originalTitle !== null) document.title = this.#originalTitle;
        this.#originalTitle = null;
        if (this.#focusHandler) {
            window.removeEventListener("focus", this.#focusHandler);
            this.#focusHandler = null;
        }
    }

    dispose() {
        this.stopBlink();
    }
}

/* ====================================================================== *
 * §7  GUARDS — allowlist, cooldowns, heures calmes, Streamer Mode.
 * ====================================================================== */

function parseHHMM(value) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}

class Guards {
    #lastBySender = new Map();
    #lastGlobal = 0;

    constructor(settings) {
        this.settings = settings;
    }

    /** @returns {null} si autorisé, sinon la raison du blocage. */
    check(senderId) {
        const s = this.settings();
        const now = Date.now();

        if (!s.enabled) return "plugin désactivé";

        if (!s.allowAnyone && !s.allowlist.includes(senderId)) return "émetteur hors allowlist";

        if (s.respectStreamerMode) {
            const sm = Modules.streamerModeStore;
            if (sm?.enabled && sm?.disableSounds) return "mode Streamer actif";
        }

        if (this.#isQuietHours(s, new Date())) return "heures calmes";

        const globalCooldown = Math.max(s.cooldownGlobal, COOLDOWN_FLOOR_S) * 1000;
        if (now - this.#lastGlobal < globalCooldown) return "cooldown global";

        const senderCooldown = Math.max(s.cooldownPerSender, COOLDOWN_FLOOR_S) * 1000;
        const last = this.#lastBySender.get(senderId) ?? 0;
        if (now - last < senderCooldown) return "cooldown émetteur";

        return null;
    }

    commit(senderId) {
        const now = Date.now();
        this.#lastGlobal = now;
        this.#lastBySender.set(senderId, now);
    }

    /** Gère correctement une plage qui franchit minuit (22:00 → 07:00). */
    #isQuietHours(s, date) {
        if (!s.quietHoursEnabled) return false;
        const start = parseHHMM(s.quietStart);
        const end = parseHHMM(s.quietEnd);
        if (start === null || end === null || start === end) return false;
        const current = date.getHours() * 60 + date.getMinutes();
        return start < end
            ? current >= start && current < end
            : current >= start || current < end;
    }

    reset() {
        this.#lastBySender.clear();
        this.#lastGlobal = 0;
    }
}

/* ====================================================================== *
 * §8  RECEIVER — abonnement MESSAGE_CREATE, filtrage, déduplication.
 * ====================================================================== */

class Receiver {
    #seen = new Map();
    #subscribed = false;

    constructor({settings, onSignal}) {
        this.settings = settings;
        this.onSignal = onSignal;
        this.handleMessageCreate = this.handleMessageCreate.bind(this);
        this.handleConnectionOpen = this.handleConnectionOpen.bind(this);
    }

    subscribe() {
        if (this.#subscribed) return false;
        const dispatcher = Modules.dispatcher;
        if (!dispatcher?.subscribe) return false;
        dispatcher.subscribe("MESSAGE_CREATE", this.handleMessageCreate);
        dispatcher.subscribe("CONNECTION_OPEN", this.handleConnectionOpen);
        this.#subscribed = true;
        return true;
    }

    unsubscribe() {
        if (!this.#subscribed) return;
        const dispatcher = Modules.dispatcher;
        // unsubscribe compare par identité : les handlers sont bindés une seule
        // fois dans le constructeur, jamais au moment de l'abonnement.
        dispatcher?.unsubscribe?.("MESSAGE_CREATE", this.handleMessageCreate);
        dispatcher?.unsubscribe?.("CONNECTION_OPEN", this.handleConnectionOpen);
        this.#subscribed = false;
    }

    handleMessageCreate(payload) {
        try {
            if (payload?.optimistic) return; // notre propre écho local avant ACK serveur
            const message = payload?.message;
            if (!message) return;
            // payload.channelId est en camelCase, message.channel_id en snake_case.
            const channelId = payload.channelId ?? message.channel_id;
            this.#consider(message, channelId, Date.now());
        } catch (err) {
            // Ne jamais laisser une exception remonter dans le dispatcher Flux.
            BdApi.Logger.stacktrace("Sonar", "Handler MESSAGE_CREATE", err);
        }
    }

    #consider(message, channelId, receivedAt) {
        const s = this.settings();
        if (!s.channelId || channelId !== s.channelId) return;

        const content = message.content;
        if (typeof content !== "string" || content.codePointAt(0) !== SENTINEL) return;

        const me = Modules.currentUserId;
        if (!me) return; // session pas encore établie : on ignore plutôt que de deviner

        const authorId = message.author?.id;
        if (!authorId || authorId === me) return;   // 1. jamais réagir à nos propres messages
        if (message.author?.bot) return;            // 2. pas de bot en V1

        const signal = Protocol.parse(content);
        if (!signal) return;
        if (signal.targetId !== me) return;         // 3. le signal ne nous est pas destiné

        if (this.#isDuplicate(message.id ?? signal.nonce)) return;
        if (this.#isDuplicate(signal.nonce)) return;

        this.onSignal({signal, authorId, message, receivedAt});
    }

    #isDuplicate(key) {
        if (!key) return false;
        const now = Date.now();
        for (const [k, t] of this.#seen) {
            if (now - t > DEDUPE_WINDOW_MS) this.#seen.delete(k);
        }
        if (this.#seen.has(key)) return true;
        this.#seen.set(key, now);
        return false;
    }

    /**
     * Rejeu best-effort après reconnexion. Discord ne redispatche jamais les
     * MESSAGE_CREATE manqués : on refetch le salon et on rejoue les signaux récents.
     */
    handleConnectionOpen() {
        const s = this.settings();
        if (!s.replayOnReconnect || !s.channelId) return;

        setTimeout(async () => {
            // Le plugin a pu être arrêté pendant le différé.
            if (!this.#subscribed) return;
            try {
                const actions = Modules.messageActions;
                if (typeof actions?.fetchMessages === "function") {
                    await actions.fetchMessages({channelId: s.channelId, limit: 20});
                }
                const stored = Modules.messageStore?.getMessages?.(s.channelId);
                const list = stored?.toArray?.() ?? [];
                const cutoff = Date.now() - REPLAY_MAX_AGE_MS;

                for (const m of list) {
                    if (!this.#subscribed) return;
                    const ts = typeof m.timestamp?.valueOf === "function" ? m.timestamp.valueOf() : 0;
                    if (ts < cutoff) continue;
                    // Les messages du store sont des records camelCase : on les
                    // normalise vers la forme attendue par #consider.
                    this.#consider(
                        {id: m.id, content: m.content, author: m.author},
                        s.channelId,
                        ts
                    );
                }
            } catch (err) {
                BdApi.Logger.warn("Sonar", "Rejeu après reconnexion échoué", err);
            }
        }, 3000);
    }

    reset() {
        this.#seen.clear();
    }
}

/* ====================================================================== *
 * §9  SENDER — envoi défensif. C'est le point le plus exposé aux MAJ Discord.
 * ====================================================================== */

class Sender {
    constructor(settings) {
        this.settings = settings;
    }

    async ping(targetId, soundId, message) {
        const s = this.settings();

        if (!s.channelId) {
            BdApi.UI.showToast("Sonar : aucun salon configuré (utilise /sonar-ici).", {type: "error"});
            return false;
        }
        if (!/^\d{15,25}$/.test(String(targetId))) {
            BdApi.UI.showToast("Sonar : destinataire invalide.", {type: "error"});
            return false;
        }
        if (targetId === Modules.currentUserId) {
            BdApi.UI.showToast("Sonar : tu ne peux pas te pinger toi-même.", {type: "warning"});
            return false;
        }

        const actions = Modules.messageActions;
        if (typeof actions?.sendMessage !== "function") {
            Modules.invalidate("messageActions");
            BdApi.UI.showToast("Sonar : module d'envoi introuvable (mise à jour Discord ?).", {type: "error"});
            return false;
        }

        const content = Protocol.encode({targetId, soundId, message});

        try {
            await actions.sendMessage(
                s.channelId,
                // Les 4 champs sont requis : en omettre un fait throw le pipeline émoji.
                {content, tts: false, invalidEmojis: [], validNonShortcutEmojis: []},
                true,
                {
                    allowedMentions: {parse: s.mentionOnSend ? ["users"] : [], repliedUser: false}
                }
            );
            return true;
        } catch (err) {
            BdApi.Logger.stacktrace("Sonar", "sendMessage a échoué", err);
            Modules.invalidate("messageActions"); // force une re-résolution au prochain envoi
            BdApi.UI.showToast("Sonar : envoi échoué.", {type: "error"});
            return false;
        }
    }
}

/* ====================================================================== *
 * §12 UPDATER — mise à jour du plugin et des sons depuis GitHub.
 *     L'updater de BetterDiscord ignore @updateUrl : il ne suit que les
 *     addons de sa boutique. Sonar se met donc à jour lui-même.
 * ====================================================================== */

/** Compare deux versions `x.y.z` numériquement. NaN si l'une est invalide. */
function compareVersions(a, b) {
    const parse = (v) => /^\d+\.\d+\.\d+$/.test(String(v ?? "").trim())
        ? String(v).trim().split(".").map(Number)
        : null;
    const pa = parse(a), pb = parse(b);
    if (!pa || !pb) return NaN;
    for (let i = 0; i < 3; i++) {
        if (pa.at(i) !== pb.at(i)) return pa.at(i) < pb.at(i) ? -1 : 1;
    }
    return 0;
}

class Updater {
    #fs = null;
    #path = null;

    constructor({settings, currentVersion, onSoundsAdded}) {
        this.settings = settings;
        this.currentVersion = currentVersion;
        this.onSoundsAdded = onSoundsAdded;
    }

    #node() {
        if (!this.#fs) {
            try {
                this.#fs = require("fs");
                this.#path = require("path");
            } catch (err) {
                BdApi.Logger.stacktrace("Sonar", "Polyfill fs/path indisponible", err);
            }
        }
        return this.#fs && this.#path;
    }

    async #fetch(url) {
        const res = await BdApi.Net.fetch(url, {headers: {"User-Agent": "Sonar-BetterDiscord"}, timeout: 15_000});
        if (!res?.ok) throw new Error(`HTTP ${res?.status} sur ${url}`);
        return res;
    }

    /** Plugin puis sons. `manual` = clic sur le bouton : on donne toujours un retour. */
    async run({manual = false} = {}) {
        await this.checkPlugin({manual});
        await this.syncSounds({manual});
    }

    async checkPlugin({manual = false} = {}) {
        try {
            const text = await (await this.#fetch(`${RAW_BASE}Sonar.plugin.js?t=${Date.now()}`)).text();

            const valid = text.startsWith("/**") && /@name\s+Sonar\b/.test(text)
                && text.includes("module.exports") && text.length > 10_000 && text.length < 1_000_000;
            if (!valid) throw new Error("fichier distant invalide");

            const remote = /@version\s+(\S+)/.exec(text)?.[1];
            if (!(compareVersions(remote, this.currentVersion) > 0)) {
                if (manual) BdApi.UI.showToast(`Sonar est à jour (${this.currentVersion}).`, {type: "success"});
                return;
            }

            if (!manual && !this.settings().autoUpdate) {
                BdApi.UI.showNotice(`Sonar ${remote} est disponible.`, {
                    type: "info",
                    buttons: [{label: "Mettre à jour", onClick: () => this.#install(text, remote)}]
                });
                return;
            }
            this.#install(text, remote);
        } catch (err) {
            BdApi.Logger.warn("Sonar", `Vérification de mise à jour échouée : ${err?.message ?? err}`);
            if (manual) BdApi.UI.showToast("Sonar : impossible de vérifier les mises à jour.", {type: "error"});
        }
    }

    #install(text, version) {
        if (!this.#node()) return;
        const target = this.#path.join(BdApi.Plugins.folder, "Sonar.plugin.js");

        // Lien symbolique (scripts/dev-link.ps1) : ne jamais écraser le dépôt de dev.
        // lstatSync du polyfill BD suit les liens, d'où la comparaison des chemins réels.
        let real = target;
        try {
            real = this.#fs.realpathSync(target);
        } catch { /* fichier absent : on l'écrit */ }
        const norm = (p) => String(p).replace(/\\/g, "/").toLowerCase();
        if (norm(real) !== norm(target)) {
            BdApi.UI.showToast(`Sonar ${version} disponible (mode dev : non installée).`, {type: "info"});
            return;
        }

        try {
            this.#fs.writeFileSync(target, text, "utf8");
            // BetterDiscord surveille le dossier plugins et recharge le plugin tout seul.
            BdApi.UI.showToast(`Sonar mis à jour en ${version}.`, {type: "success"});
        } catch (err) {
            BdApi.Logger.stacktrace("Sonar", "Écriture de la mise à jour échouée", err);
            BdApi.UI.showToast("Sonar : mise à jour échouée.", {type: "error"});
        }
    }

    /** Télécharge dans plugins\sounds les sons du dépôt absents (ou de taille différente) en local. */
    async syncSounds({manual = false} = {}) {
        if (!this.#node()) return;
        try {
            const listing = await (await this.#fetch(`https://api.github.com/repos/${REPO}/contents/sounds`)).json();
            const ids = new Set(SOUND_CATALOG.map((s) => s.id));
            const dir = this.#path.join(BdApi.Plugins.folder, DEFAULT_SOUNDS_DIRS.at(1));

            const wanted = (Array.isArray(listing) ? listing : []).filter((f) => {
                const ext = this.#path.extname(f?.name ?? "").toLowerCase();
                return f?.type === "file" && f.download_url && ext in MIME_BY_EXT
                    && ids.has(this.#path.basename(f.name, ext));
            });

            let added = 0;
            for (const file of wanted) {
                const local = this.#path.join(dir, file.name);
                let size = -1;
                try {
                    size = this.#fs.statSync(local).size;
                } catch { /* absent */ }
                if (size === file.size) continue;

                const bytes = new Uint8Array(await (await this.#fetch(file.download_url)).arrayBuffer());
                let bin = "";
                for (let i = 0; i < bytes.length; i += 0x8000) {
                    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                }
                this.#fs.mkdirSync(dir, {recursive: true});
                this.#fs.writeFileSync(local, btoa(bin), "base64");
                added++;
            }

            if (added) {
                this.onSoundsAdded?.();
                BdApi.UI.showToast(`Sonar : ${added} son(s) ajouté(s).`, {type: "success"});
            } else if (manual) {
                BdApi.UI.showToast("Sonar : sons à jour.", {type: "info"});
            }
        } catch (err) {
            BdApi.Logger.warn("Sonar", `Synchronisation des sons échouée : ${err?.message ?? err}`);
            if (manual) BdApi.UI.showToast("Sonar : impossible de télécharger les sons.", {type: "error"});
        }
    }
}

/* ====================================================================== *
 * §10 / §11  CLASSE EXPORTÉE — lifecycle, câblage, UI.
 * ====================================================================== */

module.exports = class Sonar {
    #started = false;
    #unregisterCommands = [];
    #unpatchMenus = [];
    #abort = null;
    #updateTimeout = null;
    #updateInterval = null;

    constructor(meta) {
        this.meta = meta;
        this.api = new BdApi(meta.name);

        this.store = new Store(this.api);
        const settings = () => this.store.data;

        this.bank = new SoundBank();
        this.player = new Player(settings);
        this.alerter = new Alerter(settings);
        this.guards = new Guards(settings);
        this.sender = new Sender(settings);
        this.receiver = new Receiver({settings, onSignal: (e) => this.onSignal(e)});
        this.updater = new Updater({
            settings,
            currentVersion: meta.version,
            onSoundsAdded: () => this.bank.preload(Object.fromEntries(SOUND_CATALOG.map((s) => [s.id, this.#soundPath(s.id)])))
        });
    }

    get settings() {
        return this.store.data;
    }

    /* ------------------------------- Lifecycle ------------------------------ */

    start() {
        if (this.#started) return; // idempotent : BD recharge le plugin à chaque sauvegarde
        this.#started = true;

        this.bank.preload(Object.fromEntries(SOUND_CATALOG.map((s) => [s.id, this.#soundPath(s.id)])));
        this.player.installUnlockListener();

        if (!this.receiver.subscribe()) {
            // Les chunks lazy de Discord n'existent peut-être pas encore.
            this.#waitForDispatcher();
        }

        this.#registerCommands();
        this.#patchContextMenus();

        // Différé : ne pas ralentir le démarrage de Discord.
        this.#updateTimeout = setTimeout(() => this.updater.run(), UPDATE_CHECK_DELAY_MS);
        this.#updateInterval = setInterval(() => this.updater.run(), UPDATE_INTERVAL_MS);
    }

    stop() {
        this.#started = false;

        clearTimeout(this.#updateTimeout);
        clearInterval(this.#updateInterval);

        this.#abort?.abort();
        this.#abort = null;

        this.receiver.unsubscribe();
        this.receiver.reset();

        for (const unregister of this.#unregisterCommands) {
            try {
                unregister?.();
            } catch { /* rien à faire */ }
        }
        this.#unregisterCommands = [];

        for (const unpatch of this.#unpatchMenus) {
            try {
                unpatch?.();
            } catch { /* rien à faire */ }
        }
        this.#unpatchMenus = [];

        this.player.stopAll();
        this.player.removeUnlockListener();
        this.alerter.dispose();
        this.bank.dispose();
        this.guards.reset();
        this.store.flush();
        Modules.invalidate();
    }

    async #waitForDispatcher() {
        const controller = new AbortController();
        this.#abort = controller;
        try {
            await BdApi.Webpack.waitForModule(
                BdApi.Webpack.Filters.byKeys("dispatch", "subscribe", "register"),
                {searchExports: true, signal: controller.signal}
            );
            if (controller.signal.aborted || !this.#started) return;
            Modules.invalidate("dispatcher");
            if (!this.receiver.subscribe()) {
                BdApi.UI.showToast("Sonar : impossible de s'abonner aux messages. Voir Diagnostic.", {type: "error"});
            }
        } catch {
            // abort() pendant stop(), ou timeout : rien à signaler.
        }
    }

    /* ------------------------------- Réception ------------------------------ */

    onSignal({signal, authorId, message}) {
        const reason = this.guards.check(authorId);
        if (reason) {
            this.store.bump("blocked");
            BdApi.Logger.info("Sonar", `Signal bloqué (${reason}) de ${authorId}`);
            return;
        }
        this.guards.commit(authorId);
        this.store.bump("received");
        this.#deliver(signal, message.author ?? {});
    }

    /** Son + alerte visuelle. Commun à la vraie réception et à la simulation. */
    #deliver(signal, author) {
        const filePath = this.#soundPath(signal.soundId);
        const url = this.bank.load(filePath);
        if (url) {
            this.player.play(url, signal.soundId);
        } else if (filePath) {
            BdApi.Logger.warn("Sonar", `Fichier son introuvable pour « ${signal.soundId} » : ${filePath}`);
        }

        // L'alerte visuelle part même si le son a échoué : c'est tout l'intérêt du doublon.
        this.alerter.notify({
            senderName: author.global_name || author.globalName || author.username || "Inconnu",
            soundLabel: SOUND_CATALOG.find((s) => s.id === signal.soundId)?.label ?? signal.soundId,
            message: signal.message,
            nonce: signal.nonce
        });
    }

    /** Fichier choisi dans les réglages, sinon celui trouvé dans le dossier de sons à côté du plugin. */
    #soundPath(soundId) {
        return this.settings.sounds?.[soundId] || this.bank.findDefault(soundId);
    }

    /* -------------------------------- Émission ------------------------------ */

    async #send(targetId, soundId, message) {
        const ok = await this.sender.ping(targetId, soundId, message);
        if (ok) this.store.bump("sent");
        return ok;
    }

    #registerCommands() {
        const Types = BdApi.Commands?.Types?.OptionTypes;
        if (!Types) return;

        this.#unregisterCommands.push(this.api.Commands.register({
            id: "sonar",
            name: "sonar",
            description: "Envoyer une notification sonore à un ami",
            // La commande reste masquée tant que le salon n'est pas configuré.
            predicate: () => !!this.settings.channelId,
            options: [
                {type: Types.USER, name: "ami", description: "Qui notifier", required: true},
                {
                    type: Types.STRING,
                    name: "son",
                    description: "Quel son jouer",
                    required: false,
                    choices: SOUND_CATALOG.map((s) => ({name: s.label, value: s.id}))
                },
                {
                    type: Types.STRING,
                    name: "message",
                    description: "Message optionnel",
                    required: false,
                    maxLength: MESSAGE_MAX_LEN
                }
            ],
            execute: async (data) => {
                const get = (name) => data?.find((o) => o.name === name)?.value;
                const ok = await this.#send(get("ami"), get("son") ?? "ping", get("message"));
                return {content: ok ? "✅ Sonar envoyé." : "❌ Sonar non envoyé."};
            }
        }));

        this.#unregisterCommands.push(this.api.Commands.register({
            id: "sonar-ici",
            name: "sonar-ici",
            description: "Définir le salon courant comme salon Sonar",
            execute: () => {
                const channelId = Modules.selectedChannelStore?.getChannelId?.();
                if (!channelId) return {content: "❌ Salon courant introuvable."};
                this.store.set("channelId", channelId);
                return {content: `✅ Salon Sonar défini sur <#${channelId}>.`};
            }
        }));
    }

    #patchContextMenus() {
        if (typeof BdApi.ContextMenu?.patch !== "function") return;

        this.#unpatchMenus.push(BdApi.ContextMenu.patch("user-context", (returnValue, props) => {
            const user = props?.user;
            if (!user || user.bot || user.id === Modules.currentUserId) return;
            if (!this.settings.channelId) return;

            returnValue.props.children.push(
                BdApi.ContextMenu.buildItem({type: "separator"}),
                BdApi.ContextMenu.buildItem({
                    type: "submenu",
                    id: "sonar-send",
                    label: "Envoyer un Sonar",
                    items: SOUND_CATALOG.map((sound) => ({
                        id: `sonar-send-${sound.id}`,
                        label: sound.label,
                        action: () => this.#send(user.id, sound.id, "")
                    }))
                })
            );
        }));

        this.#unpatchMenus.push(BdApi.ContextMenu.patch("channel-context", (returnValue, props) => {
            const channel = props?.channel;
            if (!channel?.id) return;

            returnValue.props.children.push(
                BdApi.ContextMenu.buildItem({type: "separator"}),
                BdApi.ContextMenu.buildItem({
                    type: "item",
                    id: "sonar-set-channel",
                    label: "Définir comme salon Sonar",
                    action: () => {
                        this.store.set("channelId", channel.id);
                        BdApi.UI.showToast(`Sonar : salon défini sur #${channel.name ?? channel.id}.`, {type: "success"});
                    }
                })
            );
        }));
    }

    /* ------------------------------- Diagnostic ----------------------------- */

    #runDiagnostic() {
        const lines = Object.entries(Modules.health())
            .map(([label, ok]) => `${ok ? "✅" : "❌"}  ${label}`);

        const s = this.settings;
        lines.push("", "— Configuration —", `ℹ️  Version : ${this.meta.version}`);

        if (!s.channelId) {
            lines.push("❌  Aucun salon Sonar configuré");
        } else {
            const channel = Modules.channelStore?.getChannel?.(s.channelId);
            lines.push(channel
                ? `✅  Salon : #${channel.name ?? s.channelId}`
                : `❌  Salon ${s.channelId} introuvable ou inaccessible`);
        }

        const mapped = SOUND_CATALOG.filter((sound) => this.bank.exists(this.#soundPath(sound.id)));
        lines.push(`${mapped.length ? "✅" : "❌"}  Sons mappés : ${mapped.length}/${SOUND_CATALOG.length}`);
        for (const sound of SOUND_CATALOG) {
            const file = s.sounds?.[sound.id];
            if (file && !this.bank.exists(file)) lines.push(`   ⚠️  « ${sound.label} » : fichier illisible`);
        }

        lines.push(
            `${s.allowAnyone || s.allowlist.length ? "✅" : "⚠️"}  Allowlist : ` +
            (s.allowAnyone ? "tout le monde" : `${s.allowlist.length} personne(s)`)
        );
        lines.push("", `Reçus : ${s.stats.received} · Bloqués : ${s.stats.blocked} · Envoyés : ${s.stats.sent}`);

        BdApi.UI.alert("Sonar — Diagnostic", lines.join("\n"));
    }

    /* --------------------------------- UI ----------------------------------- */

    getSettingsPanel() {
        return BdApi.UI.buildSettingsPanel({
            settings: this.#buildSchema(),
            onChange: (categoryId, settingId, value) => this.#applyChange(settingId, value)
        });
    }

    /**
     * Les réglages de type "button" ne passent JAMAIS par ici : BetterDiscord leur
     * injecte un `onChange` que le composant Button ignore — il n'écoute que
     * `onClick`. Les boutons sont donc câblés directement dans #buildSchema().
     */
    #applyChange(settingId, value) {
        if (settingId.startsWith("file_")) {
            this.#setSoundFile(settingId.slice(5), value);
            return;
        }
        if (settingId.startsWith("vol_")) {
            this.store.set(`soundVolumes.${settingId.slice(4)}`, value);
            return;
        }

        switch (settingId) {
            case "allowlist":
                this.store.set("allowlist", String(value).split(/[\s,;]+/).filter((id) => /^\d{15,25}$/.test(id)));
                return;
            case "channelId":
                this.store.set("channelId", String(value).trim());
                return;
            default:
                this.store.set(settingId, value);
        }
    }

    /** Le composant `file` de BetterDiscord n'affiche jamais le chemin choisi : on donne le retour nous-mêmes. */
    #setSoundFile(soundId, value) {
        const filePath = Array.isArray(value) ? value[0] ?? "" : value ?? "";
        const label = SOUND_CATALOG.find((s) => s.id === soundId)?.label ?? soundId;

        this.store.set(`sounds.${soundId}`, filePath);

        if (!filePath) {
            BdApi.UI.showToast(`Sonar : son « ${label} » retiré.`, {type: "info"});
            return;
        }
        if (this.bank.load(filePath)) {
            BdApi.UI.showToast(`Sonar : « ${label} » → ${basename(filePath)}`, {type: "success"});
        } else {
            BdApi.UI.showToast(`Sonar : fichier illisible pour « ${label} ».`, {type: "error"});
        }
    }

    #testSound(soundId) {
        const filePath = this.#soundPath(soundId);
        if (!filePath) {
            BdApi.UI.showToast(`Sonar : aucun fichier pour ce son (choisis-en un, ou mets ${soundId}.ogg dans plugins\\sounds).`, {type: "warning"});
            return;
        }
        const url = this.bank.load(filePath);
        if (!url) {
            BdApi.UI.showToast(`Sonar : fichier illisible (${basename(filePath)}).`, {type: "error"});
            return;
        }
        this.player.play(url, soundId);
    }

    /**
     * Test en solo : le plugin ignore nos propres messages, on ne peut donc pas
     * s'auto-sonner. On encode/décode un vrai signal puis on le livre localement,
     * sans réseau, sans garde-fous (cooldowns, allowlist) et sans toucher aux stats.
     */
    #simulateReception() {
        const soundId = this.settings.simSound;
        if (!this.#soundPath(soundId)) {
            BdApi.UI.showToast(`Sonar : aucun fichier pour ce son (choisis-en un, ou mets ${soundId}.ogg dans plugins\\sounds).`, {type: "warning"});
            return;
        }
        const me = Modules.currentUserId ?? "000000000000000000";
        const signal = Protocol.parse(Protocol.encode({targetId: me, soundId, message: "Simulation"}));
        if (!signal) {
            BdApi.UI.showToast(`Sonar : identifiant de son invalide (${soundId}).`, {type: "error"});
            return;
        }
        this.#deliver(signal, {username: "Simulation Sonar"});
    }

    #importFriends() {
        const ids = Modules.relationshipStore?.getFriendIDs?.() ?? [];
        if (!ids.length) {
            BdApi.UI.showToast("Sonar : aucun ami trouvé.", {type: "warning"});
            return;
        }
        const merged = [...new Set([...this.settings.allowlist, ...ids])];
        this.store.set("allowlist", merged);
        BdApi.UI.showToast(
            `Sonar : ${merged.length} personne(s) autorisée(s). Rouvre les réglages pour voir la liste.`,
            {type: "success"}
        );
    }

    #buildSchema() {
        const s = this.settings;

        return [
            {
                type: "switch",
                id: "enabled",
                name: "Activer Sonar",
                note: "Interrupteur global. Désactivé, aucun son ni alerte ne se déclenche.",
                value: s.enabled
            },
            {
                type: "category",
                id: "general",
                name: "Général",
                collapsible: true,
                shown: true,
                settings: [
                    {
                        type: "text",
                        id: "channelId",
                        name: "ID du salon Sonar",
                        note: "Clic droit sur le salon → « Définir comme salon Sonar », ou /sonar-ici.",
                        placeholder: "123456789012345678",
                        value: s.channelId
                    },
                    {
                        type: "switch",
                        id: "mentionOnSend",
                        name: "Mentionner le destinataire",
                        note: "Ajoute le ping Discord natif en secours, au cas où la personne n'a pas le plugin.",
                        value: s.mentionOnSend
                    },
                    {
                        type: "switch",
                        id: "replayOnReconnect",
                        name: "Rattraper les Sonars manqués",
                        note: "À la reconnexion, rejoue les signaux de moins de 5 minutes. Ne rattrape rien si Discord était fermé.",
                        value: s.replayOnReconnect
                    },
                    {
                        type: "button",
                        id: "diag",
                        name: "Diagnostic",
                        note: "Vérifie les modules internes, le salon et les fichiers son.",
                        children: "Lancer",
                        onClick: () => this.#runDiagnostic()
                    },
                    {
                        type: "dropdown",
                        id: "simSound",
                        name: "Son à simuler",
                        value: s.simSound,
                        options: SOUND_CATALOG.map((sound) => ({label: sound.label, value: sound.id}))
                    },
                    {
                        type: "button",
                        id: "simulate",
                        name: "Simuler une réception",
                        note: "Joue le son et l'alerte comme si un ami t'envoyait un Sonar. Rien n'est envoyé, cooldowns et allowlist ignorés.",
                        children: "Simuler",
                        onClick: () => this.#simulateReception()
                    },
                    {
                        type: "switch",
                        id: "autoUpdate",
                        name: "Mises à jour automatiques",
                        note: "Installe les nouvelles versions et les nouveaux sons depuis GitHub au démarrage de Discord.",
                        value: s.autoUpdate
                    },
                    {
                        type: "button",
                        id: "checkUpdates",
                        name: "Vérifier les mises à jour",
                        note: `Version installée : ${this.meta.version}`,
                        children: "Vérifier",
                        onClick: () => this.updater.run({manual: true})
                    }
                ]
            },
            {
                type: "category",
                id: "sounds",
                name: "Sons",
                collapsible: true,
                shown: true,
                settings: [
                    {
                        type: "slider",
                        id: "volume",
                        name: "Volume général",
                        min: 0, max: 1, step: 0.05, value: s.volume,
                        markers: [0, 0.25, 0.5, 0.75, 1]
                    },
                    {
                        type: "slider",
                        id: "maxVolume",
                        name: "Volume maximum",
                        note: "Protection auditive : plafond appliqué en dernier, après tous les autres réglages.",
                        min: 0.1, max: 1, step: 0.05, value: s.maxVolume
                    },
                    {
                        type: "switch",
                        id: "followDiscordVolume",
                        name: "Suivre le volume de sortie Discord",
                        value: s.followDiscordVolume
                    },
                    {
                        type: "dropdown",
                        id: "overlap",
                        name: "Si un son est déjà en cours",
                        value: s.overlap,
                        options: [
                            {label: "Couper le son en cours", value: "stop"},
                            {label: "Mettre en file d'attente", value: "queue"},
                            {label: "Superposer", value: "allow"}
                        ]
                    },
                    ...SOUND_CATALOG.flatMap((sound) => {
                        const file = s.sounds?.[sound.id];
                        const auto = file ? "" : this.bank.findDefault(sound.id);
                        return [
                            {
                                type: "file",
                                id: `file_${sound.id}`,
                                name: `Son « ${sound.label} »`,
                                // Le composant file n'affiche pas le chemin choisi : on le rappelle ici.
                                note: file
                                    ? `Fichier actuel : ${basename(file)}`
                                    : auto ? `Trouvé automatiquement : ${basename(auto)}` : "Aucun fichier choisi",
                                accept: "audio/*",
                                clearable: true,
                                value: file ?? ""
                            },
                            {
                                type: "slider",
                                id: `vol_${sound.id}`,
                                name: `Volume de « ${sound.label} »`,
                                min: 0, max: 1, step: 0.05,
                                value: s.soundVolumes?.[sound.id] ?? 1,
                                inline: true
                            },
                            {
                                type: "button",
                                id: `test_${sound.id}`,
                                name: `Tester « ${sound.label} »`,
                                children: "Écouter",
                                inline: true,
                                onClick: () => this.#testSound(sound.id)
                            }
                        ];
                    })
                ]
            },
            {
                type: "category",
                id: "visual",
                name: "Alerte visuelle",
                collapsible: true,
                shown: false,
                settings: [
                    {type: "switch", id: "visualToast", name: "Notification dans Discord", value: s.visualToast},
                    {
                        type: "switch",
                        id: "visualNative",
                        name: "Notification Windows",
                        note: "Peut être étouffée par l'Assistant de concentration de Windows — le son, lui, passe toujours.",
                        value: s.visualNative
                    },
                    {type: "switch", id: "visualFlash", name: "Faire clignoter la barre des tâches", value: s.visualFlash}
                ]
            },
            {
                type: "category",
                id: "guards",
                name: "Garde-fous",
                collapsible: true,
                shown: false,
                settings: [
                    {
                        type: "switch",
                        id: "allowAnyone",
                        name: "Accepter tout le monde",
                        note: "Déconseillé. Sans ça, seules les personnes de l'allowlist peuvent te faire sonner.",
                        value: s.allowAnyone
                    },
                    {
                        type: "text",
                        id: "allowlist",
                        name: "Allowlist (IDs Discord)",
                        note: "Séparés par des espaces ou des virgules. Mode développeur requis pour copier un ID.",
                        value: s.allowlist.join(", ")
                    },
                    {
                        type: "button",
                        id: "importFriends",
                        name: "Importer mes amis Discord",
                        children: "Importer",
                        onClick: () => this.#importFriends()
                    },
                    {
                        type: "number",
                        id: "cooldownPerSender",
                        name: "Cooldown par émetteur (secondes)",
                        note: `Plancher non désactivable : ${COOLDOWN_FLOOR_S} s.`,
                        min: COOLDOWN_FLOOR_S, max: 3600,
                        value: s.cooldownPerSender
                    },
                    {
                        type: "number",
                        id: "cooldownGlobal",
                        name: "Cooldown global (secondes)",
                        note: "Empêche plusieurs personnes de contourner le cooldown individuel.",
                        min: COOLDOWN_FLOOR_S, max: 3600,
                        value: s.cooldownGlobal
                    },
                    {
                        type: "switch",
                        id: "quietHoursEnabled",
                        name: "Heures calmes",
                        note: "Sonar reste silencieux sur la plage ci-dessous. Gère le passage par minuit.",
                        value: s.quietHoursEnabled
                    },
                    // Pas d'enableWith ici : dans une catégorie, BetterDiscord 1.14.1 applique
                    // `disabled = valeur` au lieu de `disabled = !valeur` (la branche racine, elle,
                    // négocie correctement). S'appuyer dessus griserait les champs à l'envers.
                    {type: "text", id: "quietStart", name: "Début (HH:MM)", value: s.quietStart, inline: true},
                    {type: "text", id: "quietEnd", name: "Fin (HH:MM)", value: s.quietEnd, inline: true},
                    {
                        type: "switch",
                        id: "respectStreamerMode",
                        name: "Respecter le mode Streamer",
                        value: s.respectStreamerMode
                    }
                ]
            }
        ];
    }
};
