// Test isolé de la logique pure du plugin (§3 Protocol et §7 heures calmes).
const PROTOCOL_VERSION = 1;
const SENTINEL = 0x1f50a;
const SIGNAL_MAX_LEN = 320;
const MESSAGE_MAX_LEN = 200;

const Protocol = {
    RE: /^🔊 SONAR\|(\d{1,2})\|<@!?(\d{15,25})>\|([a-z0-9_-]{1,24})\|([0-9a-f]{8})(?:\|([\s\S]{0,200}))?$/,
    nonce() { return "7f3a9c21"; },
    encode({targetId, soundId, message}) {
        const clean = String(message ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, MESSAGE_MAX_LEN);
        const head = `\u{1F50A} SONAR|${PROTOCOL_VERSION}|<@${targetId}>|${soundId}|${this.nonce()}`;
        return clean ? `${head}|${clean}` : head;
    },
    parse(content) {
        if (typeof content !== "string") return null;
        if (content.codePointAt(0) !== SENTINEL) return null;
        if (content.length > SIGNAL_MAX_LEN) return null;
        const m = this.RE.exec(content.trim());
        if (!m) return null;
        const [, version, targetId, soundId, nonce, message] = m;
        if (Number(version) !== PROTOCOL_VERSION) return null;
        return {version: PROTOCOL_VERSION, targetId, soundId, nonce, message: message ?? ""};
    }
};

function parseHHMM(value) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}

function isQuiet(start, end, hhmm) {
    const s = parseHHMM(start), e = parseHHMM(end);
    if (s === null || e === null || s === e) return false;
    const cur = parseHHMM(hhmm);
    return s < e ? (cur >= s && cur < e) : (cur >= s || cur < e);
}

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) pass++; else { fail++; console.log(`  ECHEC ${label}\n    attendu: ${JSON.stringify(expected)}\n    obtenu : ${JSON.stringify(actual)}`); }
};

const ID = "287654321098765432";

console.log("-- Protocole : aller-retour --");
const enc = Protocol.encode({targetId: ID, soundId: "alarme", message: "Reveille-toi"});
check("encode produit le format attendu", enc, "\u{1F50A} SONAR|1|<@287654321098765432>|alarme|7f3a9c21|Reveille-toi");
check("parse round-trip", Protocol.parse(enc), {version: 1, targetId: ID, soundId: "alarme", nonce: "7f3a9c21", message: "Reveille-toi"});

const encNoMsg = Protocol.encode({targetId: ID, soundId: "ping", message: ""});
check("sans message", Protocol.parse(encNoMsg), {version: 1, targetId: ID, soundId: "ping", nonce: "7f3a9c21", message: ""});

console.log("-- Protocole : cas limites --");
check("message multiligne ecrase les sauts", Protocol.parse(Protocol.encode({targetId: ID, soundId: "ping", message: "a\nb\nc"}))?.message, "a b c");
check("pipe dans le message preserve", Protocol.parse(Protocol.encode({targetId: ID, soundId: "ping", message: "a|b|c"}))?.message, "a|b|c");
check("message tronque a 200", Protocol.parse(Protocol.encode({targetId: ID, soundId: "ping", message: "x".repeat(500)}))?.message.length, 200);
check("mention avec ! (ancien format)", Protocol.parse("\u{1F50A} SONAR|1|<@!287654321098765432>|ping|aaaaaaaa")?.targetId, ID);

console.log("-- Protocole : rejets --");
check("message normal", Protocol.parse("salut les amis"), null);
check("sentinelle seule", Protocol.parse("\u{1F50A} coucou"), null);
check("version future ignoree", Protocol.parse("\u{1F50A} SONAR|2|<@287654321098765432>|ping|aaaaaaaa"), null);
check("nonce invalide", Protocol.parse("\u{1F50A} SONAR|1|<@287654321098765432>|ping|ZZZZZZZZ"), null);
check("soundId majuscules", Protocol.parse("\u{1F50A} SONAR|1|<@287654321098765432>|PING|aaaaaaaa"), null);
check("id trop court", Protocol.parse("\u{1F50A} SONAR|1|<@123>|ping|aaaaaaaa"), null);
check("non-string", Protocol.parse(null), null);
check("prefixe different", Protocol.parse("X SONAR|1|<@287654321098765432>|ping|aaaaaaaa"), null);
check("signal trop long rejete", Protocol.parse("\u{1F50A} SONAR|1|<@287654321098765432>|ping|aaaaaaaa|" + "y".repeat(400)), null);

console.log("-- Heures calmes --");
check("plage normale, dedans", isQuiet("09:00", "17:00", "12:00"), true);
check("plage normale, dehors", isQuiet("09:00", "17:00", "20:00"), false);
check("plage normale, borne debut incluse", isQuiet("09:00", "17:00", "09:00"), true);
check("plage normale, borne fin exclue", isQuiet("09:00", "17:00", "17:00"), false);
check("franchit minuit, avant minuit", isQuiet("22:00", "07:00", "23:30"), true);
check("franchit minuit, apres minuit", isQuiet("22:00", "07:00", "03:00"), true);
check("franchit minuit, en journee", isQuiet("22:00", "07:00", "12:00"), false);
check("franchit minuit, borne fin exclue", isQuiet("22:00", "07:00", "07:00"), false);
check("plage nulle desactivee", isQuiet("08:00", "08:00", "08:00"), false);
check("valeur invalide", isQuiet("abc", "07:00", "03:00"), false);
check("heure hors bornes", parseHHMM("25:00"), null);

console.log(`\n${pass} reussis, ${fail} echoues`);
process.exit(fail ? 1 : 0);
