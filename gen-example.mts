// throwaway generator for the bundled example project (src/lib/assets/examples/)
// text <-> entries <-> catalog are produced in one pass, so they can never drift.
// run npx prettier --write on the two JSON outputs afterwards (the lint gate owns their formatting).
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const OUT = "src/lib/assets/examples";

// port of verify.ts (kept here so the generator runs without the app's deps)
function verifyEntry(
  sourceText: string,
  entry: { line: number; endLine?: number; range: [number, number]; excerpt: string },
): string | null {
  const lines = sourceText.split("\n");
  if (entry.line < 1 || entry.line > lines.length) return `line ${entry.line} out of range`;
  const endLine = entry.endLine ?? entry.line;
  const [start, end] = entry.range;
  const startLine = lines[entry.line - 1];
  const endLineText = lines[endLine - 1];
  if (start < 0 || start >= startLine.length) return `start ${start} invalid (line len ${startLine.length})`;
  if (end < 0 || end > endLineText.length) return `end ${end} invalid (line len ${endLineText.length})`;
  if (endLine === entry.line && end <= start) return `empty range on line ${entry.line}`;
  const span =
    endLine === entry.line
      ? startLine.slice(start, end)
      : [startLine.slice(start), ...lines.slice(entry.line, endLine - 1), endLineText.slice(0, end)].join("\n");
  const segments = entry.excerpt.split("[...]");
  if (segments.some((s) => s.length === 0)) return "bad ellipsis placement";
  if (segments.length === 1) return entry.excerpt === span ? null : "excerpt does not match span";
  let pos = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const idx = i === 0 ? (span.startsWith(seg) ? 0 : -1) : span.indexOf(seg, pos + 1);
    if (idx === -1) return `segment ${i + 1} not in order`;
    if (i === segments.length - 1 && idx + seg.length !== span.length) return "last segment does not end at range end";
    pos = idx + seg.length;
  }
  return null;
}

/* ---------- catalog ---------- */

type FrameDevice = {
  id: string;
  name: string;
  kind: "device" | "element";
  note?: string;
  rule?: string;
  examples: { text: string; source: string | null }[];
  children: FrameDevice[];
};

type Spec = {
  name: string;
  rule?: string;
  note?: string;
  kind?: "device" | "element";
  examples?: string[];
  children?: Spec[];
};

const el = (name: string, rule: string, examples?: string[]): Spec => ({ name, kind: "element", rule, examples });

const spec: Spec[] = [
  {
    name: "Problemdefinition",
    note: "Eine Problemdefinition wird codiert, wenn der Text benennt, **was an der Drachenpost am Greifenpass problematisch ist**.",
    children: [
      {
        name: "Die Drachenpost gefährdet die Dörfer am Greifenpass",
        rule: "Immer dann codieren, wenn die Drachenpost oder ihre Tiefflüge als Gefahr für Höfe, Felder und Menschen dargestellt werden.",
      },
    ],
  },
  {
    name: "Ursachenzuschreibung",
    note: "Eine Ursachenzuschreibung wird codiert, wenn im Text erklärt wird, **warum die Feuerflieger tiefer über die Dörfer fliegen und warum es zu den Bränden kommt**.",
    children: [
      {
        name: "Verklärung der Drachenpost als heile Welt der Bergtäler",
        rule: "Immer dann codieren, wenn die Drachenpost als heile, idyllische oder unveränderliche Welt verklärt wird und diese Verklärung selbst als Grund dafür gilt, dass die Gefahr ignoriert wird.",
      },
      {
        name: "Geldgier der Gilde",
        rule: "Immer dann codieren, wenn finanzielle Interessen (Zollgold, Flugrechte, Preise) als Ursache der Tiefflüge und Brände dargestellt werden.",
      },
      {
        name: "Übermut und mangelnde Aufsicht der Reiterknappen",
        rule: "Immer dann codieren, wenn junge oder unerfahrene Reiter und Jungdrachen allein, zu früh oder ohne Begleitung auf die Strecke geschickt werden.",
      },
      {
        name: "Überalterte Flugkorridore",
        rule: "Immer dann codieren, wenn veraltete Regeln, Routen oder Karten als Ursache der Misere genannt werden.",
      },
      {
        name: "Versäumte Vermessung der Korridore",
        rule: "Immer dann codieren, wenn unterlassenes Nachmessen oder Nichtanpassen nach dem Tunnel-Einsturz als Ursache genannt wird.",
      },
      {
        name: "Tourismus und Schaulust als Treiber",
        rule: "Immer dann codieren, wenn Schaulust, Hype und Tourismus den Flugbetrieb und damit die Gefahr anfachen.",
      },
      {
        name: "Nachlässigkeit der Drachenreitergilde",
        rule: "Immer dann codieren, wenn Versäumnisse der Gilde selbst (Aufsicht, Auswahl, Sold) als Ursache dargestellt werden.",
      },
      {
        name: "Angst und Mythen vernebeln die Tatsachen",
        rule: "Immer dann codieren, wenn Angst, Sagen und Mythen als Ursache dafür gelten, dass die Verhältnisse nicht mehr sachlich gesehen werden.",
      },
    ],
  },
  {
    name: "Verantwortungszuschreibung",
    note: "Eine Verantwortungszuschreibung wird codiert, wenn im Text benannt wird, **wer für die Brände und die Misere am Greifenpass haftbar gemacht wird**.",
    children: [
      {
        name: "Der Stadtrat",
        rule: "Codieren, wenn der Rat für unterlassene Schutzmaßnahmen oder untätige Beschlüsse verantwortlich gemacht wird.",
      },
      {
        name: "Die Drachenreitergilde",
        rule: "Codieren, wenn die Gilde für Betrieb, Aufsicht oder Verschweigen der Gefahr verantwortlich gemacht wird.",
      },
      {
        name: "Die Postmeisterin",
        rule: "Codieren, wenn die Postmeisterin persönlich für Abwehr, Trostsprüche oder Nichtstun verantwortlich gemacht wird.",
      },
      {
        name: "Die Bergwacht",
        rule: "Codieren, wenn die Bergwacht für Unterbesetzung, Verfall oder Stummheit ihrer Türme verantwortlich gemacht wird.",
      },
      {
        name: "Die Kartographenzunft",
        rule: "Codieren, wenn die Kartographenzunft für falsche oder nie erneuerte Karten verantwortlich gemacht wird.",
      },
      {
        name: "Die Wirte am Pass",
        rule: "Codieren, wenn Krüge und Wirte profitieren und deshalb kein Interesse an einem Ende des Tieffugs haben.",
      },
      {
        name: "Die Schulmeister",
        rule: "Codieren, wenn die Schulmeister für falsche oder unvollständige Bildung (Sagen statt Drachenkunde) verantwortlich gemacht werden.",
      },
      {
        name: "Die Bauern selbst",
        rule: "Codieren, wenn den Höfen selbst angelastet wird, mutwillig im Flugkorridor gebaut zu haben.",
      },
      {
        name: "Die Runenwirte",
        rule: "Codieren, wenn die Runenwirte für den Tunnel-Einsturz und seine Folgen haftbar gemacht werden.",
      },
    ],
  },
  {
    name: "(Moralische) Bewertung",
    note: "Eine moralische Bewertung wird codiert, wenn Personen, Tieren, Einrichtungen oder Handlungen im Text **wertende Eigenschaften zugeschrieben werden**.",
    children: [
      {
        name: "Gefährlich und bedrohlich",
        rule: "Codieren, wenn Feuerpost, Drachen oder ihr Flug als gefährlich, bedrohlich oder flammend beschrieben werden.",
      },
      {
        name: "Verklärt und romantisch",
        rule: "Codieren, wenn etwas als romantisches Gemälde, Fest, Sehnsucht oder heile Welt beschrieben wird.",
      },
      {
        name: "Rückständig und von gestern",
        rule: "Codieren, wenn Personen oder Einrichtungen als rückständig, von gestern oder überholt beschrieben werden.",
      },
      {
        name: "Mutig und tapfer",
        rule: "Codieren, wenn Reiterknappen, Rittern oder Tieren Mut und Tapferkeit zugeschrieben wird.",
      },
      { name: "Gierig", rule: "Codieren, wenn Habgier und Gewinnsucht zugeschrieben werden." },
      {
        name: "Weitsichtig",
        rule: "Codieren, wenn Maßnahmen oder Personen als weitsichtig, fortschrittlich oder klug beschrieben werden.",
      },
      {
        name: "Kurzsichtig und unüberlegt",
        rule: "Codieren, wenn Pläne, Ankündigungen oder Handlungen als kurzsichtig, golden verhängt oder unüberlegt beschrieben werden.",
      },
      {
        name: "Wild und unzuverlässig",
        rule: "Codieren, wenn Drachen als ungezähmt, wild, unbändig oder unberechenbar beschrieben werden.",
      },
      {
        name: "Ehrwürdig",
        rule: "Codieren, wenn Tradition, Handwerk oder Geschäfte als ehrwürdig, bewährt oder ehrenwert beschrieben werden.",
      },
      {
        name: "Skandalös und unerhört",
        rule: "Codieren, wenn Zustände, Zahlen oder Entscheidungen als unerhört oder skandalös bezeichnet werden.",
      },
      {
        name: "Sentimentalisch und nostalgisch",
        rule: "Codieren, wenn Haltungen als sentimental, nostalgisch oder rührend beschrieben werden.",
      },
    ],
  },
  {
    name: "Lösungsvorschläge",
    note: "Ein Lösungsvorschlag wird codiert, wenn im Text **Maßnahmen gefordert, empfohlen, angekündigt oder abgelehnt werden**.",
    children: [
      {
        name: "Bau der Runenfaserlinie Regenbogen",
        rule: "Codieren, wenn die Runenfaserlinie (der Regenbogen) als Lösung gefordert, gepriesen oder angekündigt wird.",
      },
      {
        name: "Nachtflugverbot und Tiefflugbeschränkung",
        rule: "Codieren, wenn Flugbeschränkungen für die Feuerflieger gefordert, vorbereitet oder ignoriert werden.",
      },
      {
        name: "Schadensausgleich für die Höfe",
        rule: "Codieren, wenn Schadensausgleich, Brandschatz oder Geld für die Höfe gefordert, bewilligt oder verweigert werden.",
      },
      {
        name: "Drachenschule für junge Feuerflieger",
        rule: "Codieren, wenn Erziehung, Zähmung oder Schulung der Jungdrachen als Lösung gefordert oder angekündigt wird.",
      },
    ],
  },
  {
    name: "Weitere Frame-Elemente",
    kind: "element",
    rule: "Frame-Elemente sind wiederkehrende Symbole, Bildfelder und Chiffren, die den Frame tragen, ohne selbst Behauptungen zu sein.",
    children: [
      el(
        "Drache",
        "Codieren, wenn der Drache selbst (als Tier, Frachttier, Ungeheuer oder Sagenwesen) das Bildfeld trägt.",
      ),
      el("Asche", "Codieren, wenn Asche, Glut und Brandspuren als Bildfeld erscheinen."),
      el("Gold", "Codieren, wenn Gold, Münzen, Zoll und Wechsel das Bildfeld des Gewinns tragen."),
      el("Runenfaser", "Codieren, wenn Runenfaser und Faserkabel als Chiffre für Fortschritt und neue Post stehen."),
      el(
        "Greifenpass",
        "Codieren, wenn der Greifenpass selbst als Ort, Schicksalslinie oder Grenze das Bildfeld trägt.",
      ),
      el("Feuerflieger", "Codieren, wenn das Blattleitungswort Feuerflieger (die Postdrachen) das Bildfeld prägt."),
      el("Tunnel", "Codieren, wenn der unter dem Sattelweg eingestürzte Tunnel als Wendedatum und Chiffre erscheint."),
      el("Sturmglocke", "Codieren, wenn Glocken und Türme als Signal der Warnung (oder ihres Fehlens) erscheinen."),
      el(
        "Regenbogen",
        "Codieren, wenn der Regenbogen als Chiffre erscheint — meist doppeldeutig zwischen Naturbild und Name der neuen Runenfaserlinie.",
        [
          "„Über dem Greifenpass zieht **ein Streifen Regenbogen** quer über die Fassade von Marderbach.“",
          "„**Der Regenbogen** sei billiger als jeder Schadensersatz, sagt die Runenwartin.“",
        ],
      ),
    ],
  },
];

const mk = (s: Spec, kind: "device" | "element"): FrameDevice => ({
  id: randomUUID(),
  name: s.name,
  kind: s.kind ?? kind,
  ...(s.note ? { note: s.note } : {}),
  ...(s.rule ? { rule: s.rule } : {}),
  examples: (s.examples ?? []).map((text) => ({ text, source: null })),
  children: (s.children ?? []).map((c) => mk(c, s.kind ?? kind)),
});

const instr = { version: 1 as const, title: "Kodieranweisungen", devices: spec.map((s) => mk(s, "device")) };
const codeIndexOf = (ds: FrameDevice[], prefix = "", out: Map<string, string> = new Map()): Map<string, string> => {
  ds.forEach((d, i) => {
    const code = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
    out.set(d.id, code);
    codeIndexOf(d.children, code, out);
  });
  return out;
};
const codeToId = new Map([...codeIndexOf(instr.devices)].map(([id, code]) => [code, id] as const));

/* ---------- marked article text ----------
   {{code|verbatim span}} and {{code|span with ‹elided› middle|note}}
   marks are linear (never nested) and word-aligned. */

const blocks: string[] = [
  "22/2247 vom 20. Aschmond",
  "S. 7 THEMA",
  "Der lange Schatten der Drachenpost",
  "Am {{6.5|Greifenpass}} streiten Drachenreiter und Runenwirte um die Zukunft:\nDie {{6.6|Feuerflieger}} der Post fliegen tiefer über die Dörfer, seit der {{6.7|Tunnel}} gesperrt ist.\n{{6.2|Asche}} brennt die Ernten, die Höfe klagen, die {{3.2|Gilde}} schweigt.\nWarum schützt der {{3.1|Rat}} die Bauern nicht vor den eigenen {{6.1|Drachen}}?",
  "Alrik Aschenbrand",
  "Als der alte Postmeister Huldric Ferngut an diesem Morgen zum {{6.5|Greifenpass}} hinaufsah, erkannte er seine Welt nicht wieder. Ein {{6.1|junger Drache}} der Post flog so tief über die Scheunen von Marderbach, daß die Lehmfassade zitterte, und aus seiner {{6.2|Aschewolke}} fielen Gluttröpfchen auf das frisch gemähte Heu. „{{4.1|Das ist kein Postverkehr mehr, das ist ein flammendes Ungeheuer über unseren Dächern}}“, sagt Ferngut. {{1.1|Seit die Feuerpost tiefer über die Dörfer fliegt|Tiefflug seit dem Tunnel-Einsturz}}, sei der alte Flugkorridor zu einer {{4.1|„brennenden Straße“}} geworden. {{6.8|Die Sturmglocke von Marderbach}} habe in diesem Aschmond schon elf Mal geläutet.",
  "Bauer Tarell Wiesenblick aus Marderbach zeigt auf die {{6.2|schwarzen Flecken}} in seinem Gerstenfeld. {{1.1|Drei Höfe haben binnen einer Woche gebrannt|Binnen einer Woche drei Höfe gebrannt}}, und immer sei {{4.1|derselbe Feuerflieger}} darüber hinweggezogen: ein {{4.8|ungezähmter, unzuverlässiger}} Jungdrache der Gilde, {{2.3|ohne erfahrenen Reiter auf die Strecke geschickt|Unerfahrener Knappe allein auf der Strecke}}. {{3.2|Die Drachenreitergilde weiß um die Gefahr, aber sie redet sie klein|Gilde weiß, redet klein}}, seit Jahren.",
  "{{3.3|Postmeisterin Elara Flugstolz weist die Vorwürfe zurück|Postmeisterin weist Vorwürfe zurück}}. {{4.9|Seit elfhundert Jahren}} trage die {{6.1|Drachenpost}} Botschaften, Wechsel und Medizin über den {{6.5|Greifenpass}} — {{4.9|ehrwürdig, bewährt und unverzichtbar}}. {{2.1|Wer die Feuerpost angreife, greife die heile Welt der Bergtäler an}}, {{4.2|als wäre sie ein verklärtes Gemälde aus alter Zeit}}. {{5.4|Zum Herbstdanktag hat die Gilde eine Drachenschule angekündigt|Drachenschule angekündigt}}, um junge {{6.6|Feuerflieger}} zu {{4.4|tapferen}}, verlässlichen Boten zu erziehen; die Bauern nennen das {{4.7|Kurzsichtigkeit in goldenen Ketten|Versprechen in goldenen Ketten}}.",
  "In der {{6.8|Alten Glocke}} am Fuß des {{6.5|Greifenpasses}} singen Knappe Lieder über {{4.4|die Mutigsten des Tals}}, die {{4.2|Helden des Drachenspiels}}. {{2.6|Jeden Aschmondtag strömen Schaulustige aus den Märkten herbei, um die Landung der Feuerflieger zu bejubeln|Schaulustige strömen zum Pass}}. Wirtin Griet Kranich {{3.6|verdient am Spektakel und will das Ende des Tieffugs nicht hören|Krüge verdienen am Tiefflug}}: {{2.6|Die Schaulust der Fremden treibe die Reiter erst recht an}}, {{4.2|und wer zuhöre, halte den Pass für ein Fest statt für eine Brandstatt}}.",
  "Im Stadtrat ist die Rede scharf. {{3.1|Der Rat selbst hält sich seit Wochen aus der Debatte|Der Rat schweigt}}. {{3.9|Runenwartin Ilva Tiefgraben: Der Einsturz des Tunnels sei Nachlässigkeit, nicht Schicksal|Runenwartin: Tunnelursache}}. Sie verlange {{5.1|den Bau der Runenfaserlinie Regenbogen|Runenfaserlinie Regenbogen}}: {{6.4|ein Faserkabel aus Spinnenglas}}, das die Korrespondenz {{4.6|ohne Rauch und Ruß}} über den {{6.5|Pass}} ziehe. {{5.1|Der Regenbogen sei billiger als jeder Schadensersatz}}. {{4.3|Die Drachenpost von gestern}} nütze allein {{2.2|der Gilde, die an jedem Flügelschlag Gold verdient|Gilde verdient am Flügelschlag}}. {{4.10|Unerhört‹, daß die Brandschatzliste der Gilde seit drei Sommern keinen einzigen Branthalm ausweist,›während die Höfe ihre Asche zählen|Brandschatzliste ohne Branthalm}}.",
  "Die Drachenkundlerin Frauke Brandherd kennt die Zahlen. {{6.7|Der Einsturz des Tunnels}} habe die Karten überholt: {{2.5|seitdem habe niemand die Flugkorridore neu vermessen|Niemand vermaß die Korridore neu}}. {{2.4|Die Korridore stammen aus Karten von vor zweihundert Jahren|Korridore von vor zweihundert Jahren}}. {{2.7|Weil die Post billige Fahrten verspricht, nimmt die Gilde unbändige Jünglinge in die Pflicht|Billige Postfahrten mit Jünglingen}} — {{4.8|wild und unberechenbar würden die Tiere, wenn sie früh allein fliegen}}, meldet die Kammer; {{1.1|vier von fünf Bränden gingen auf unbegleitete Jungtiere zurück|Vier von fünf Bränden: Jungtiere}}. {{3.7|Die Schulmeister lehren die Knappen alles über Berge, aber nichts über Drachen|Schulmeister ohne Drachenkunde}}.",
  "{{3.1|Der Rat hat seit Jahrzehnten keine Feuerstraße und keine Wasserleitung am Pass gebaut|Keine Feuerstraße, keine Wasserleitung}}; {{3.4|die Bergwacht ist unterbesetzt, ihre Türme verfallen|Bergwacht unterbesetzt}}; {{3.5|die Kartographenzunft malt seit Menschengedenken dieselben falschen Karten|Kartographenzunft malt falsche Karten}}; {{3.6|die Krüge am Pass verdienen am Spektakel|Krüge verdienen am Spektakel}}. Und doch {{3.8|mancher Hof wurde mutwillig mitten im alten Flugkorridor errichtet|Hof im alten Flugkorridor}} — {{4.7|kurzsichtig|Bauen im Flugkorridor}}, {{4.1|im Schatten der Feuerflieger|Im Schatten der Feuerflieger}}.",
  "Die {{6.3|Gold}}frage ziehe sich durch alles. {{2.2|Für die Gilde wiege das Zollgold schwerer als die Asche der Höfe|Zollgold vor Asche}}; {{4.5|gierig nennen die Bauern die Pächter der Flugrechte|Pächter der Flugrechte}}; {{4.10|unerhört, daß die Flugrechte meist an auswärtige Häuser verpachtet sind|Flugrechte auswärtiger Häuser}}. {{5.3|Die Kammer verlangt einen Schadensausgleich für die Höfe|Schadensausgleich gefordert}}, {{3.1|und der Rat vertrage die Forderung mit Geduld|Der Rat vertröstet}}.",
  "{{5.2|Ein Nachtflugverbot für Feuerflieger|Nachtflugverbot}}, {{5.2|der Vorschlag der Feuerwacht liegt seit dem Vorjahr im Rat}}, {{3.1|wird nicht einmal aufgerufen|Nachtflugverbot nicht aufgerufen}}. {{5.4|Zähmung statt Eile: die Forderung nach einer Drachenschule}}, {{5.1|Faser statt Federn: der Regenbogen in jeder Debatte}}, {{5.3|Ausgleich statt Aussitzen}} — {{1.1|die Vorschläge liegen alle auf dem Tisch, keiner wird beschlossen|Alle Vorschläge, kein Beschluß}}.",
  "Und die {{2.8|Angst}}? {{2.8|Mythen‹, die am Wirtshaustisch erzählt werden,›überblenden die Tatsachen|Mythen überblenden die Tatsachen}}: {{2.8|kein Drache verbrenne einen Menschen aus Bosheit, sagen die Alten|Mythos vom bösen Drachen}}, {{2.8|und doch zähle man im Tal bald mehr Asche als Ernte|Mehr Asche als Ernte}}. {{4.1|Bedrohung}} nennen die einen die {{6.6|Feuerflieger}}, {{4.2|Sehnsucht}} die anderen.",
  "{{4.11|Nur der alte Postmeister steht abseits und rechnet in einer anderen Währung|Der Postmeister rechnet anders}}. {{4.11|Sein Handwerk, sagt er, habe aus Asche und Treue bestanden|Asche und Treue}}. {{4.11|Sentimentalität}} nennen die Runenwirte das, {{4.6|Weitsicht}} nennen es die Schulmeister, {{4.3|rückständig nennen ihn beide den Pass|Der Pass: rückständig}}, solange die Drachen fliegen.",
  "Am Markttag {{6.3|wandert Gold für Wechsel und Zoll durch die Hallen des Greifenpasses|Gold für Wechsel und Zoll}}, {{6.1|die Drachen der Post setzen Fracht um Fracht}} — {{6.6|Feuerflieger über Feuerfliegern}}, {{3.2|die Gilde zählt die Sätze und schweigt über die Asche|Gilde zählt, schweigt}}. {{4.5|Habgier}}, {{4.9|Ehrenwert}} — je nach Krug.",
  "Die Witwe Greta Bachmann hat {{1.1|ihren Hof zweimal in einem einzigen Aschmond verloren|Hof zweimal im selben Monat}}. {{4.10|Unerhört}}, {{3.1|der Rat habe ihr keinen Branthalm bewilligt|Kein Branthalm für die Witwe}}, {{3.3|die Postmeisterin schicke ihr ein Trostgedicht|Postmeisterin: Trostgedicht}}. {{4.11|Rührend}}, {{4.10|unerhört}}.",
  "Die Reiterknappen {{4.4|verteidigen die Post mit Leib und Leben und gelten als die Tapfersten des Tals|Knappen verteidigen die Post}}, {{2.6|und jeder von ihnen träumt davon, eines Tages der Held des Drachenspiels zu sein|Träumende Knappen}}. {{3.2|Die Gilde lobe ihren Mut, wo sie Aufsicht üben könnte|Gilde lobt statt beaufsichtigt}}, {{2.7|denn ein Reiter weniger koste weniger Sold|Sold statt Aufsicht}}.",
  "{{3.4|Von der Turmserie der Bergwacht am Hang steht nur noch einer mit einer Glocke|Nur ein Turm steht noch}}; {{6.8|wann die Glocke je ein Feuer gemeldet hat|Glocke warnt nicht}}, {{3.4|weiß in Marderbach niemand mehr}} — {{1.1|Asche fällt, und niemand löscht|Asche fällt, niemand löscht}}.",
  "In der Schule von Marderbach {{3.7|lernen die Kinder die Sagen vom guten Drachen und vom bösen Faserwurm|Kinder lernen Sagen}}, {{2.8|und wer nachzähle, finde mehr Mythen als Messungen|Mythen statt Messungen}}. {{4.2|Verklärt}}, {{4.6|glücklich}}, {{2.6|am Aschmondtag stehen sie alle am Feldrain und winken|Kinder winken den Feuerfliegern}}.",
  "{{6.8|Die Sturmglocke}} läutet wieder. Über dem {{6.5|Greifenpass}} ziehe {{6.9|ein Streifen Regenbogen|Regenbogen über dem Pass}} quer über die Fassade von Marderbach: {{6.4|nicht von Drachenfeuer, sondern von Runenfaser}}, {{3.9|gewirkt von Runenwirten aus dem Tiefland|Runenwirte wirken}}, {{4.2|ein verklärtes Band}} über den {{6.2|Aschefeldern}}. {{5.1|Der Regenbogen kommt}}, {{4.6|heißt es}}, {{5.2|bis dahin fliegen die Feuerflieger tief}}, {{1.1|und die Höfe zählen Asche|Die Höfe zählen Asche}}.",
];

// one parse pass: collect marks with plain-text offsets; plain text keeps all span chars
interface Mark {
  start: number;
  len: number; // span length in plain text (elision chars stay in the span)
  seg1: number; // first-segment length (0 = verbatim excerpt)
  omit: number; // elided middle length (0 = verbatim excerpt)
  device: string;
  note?: string;
}
const SEP = "\n\n";
const marks: Mark[] = [];
const blockMarks: Mark[][] = [];
const plainBlocks = blocks.map((block) => {
  let out = "";
  let pos = 0;
  const local: Mark[] = [];
  for (const m of block.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const gap = block.slice(pos, m.index);
    const [code, text, note] = m[1].split("|");
    if (!codeToId.has(code)) throw new Error(`unknown code ${code} in mark "${text}"`);
    const a = text.indexOf("‹");
    const b = text.indexOf("›");
    if ((a === -1) !== (b === -1) || /[{}]/.test(text)) throw new Error(`bad marker in "${text}"`);
    if (a !== -1 && !(a > 0 && a < b && b < text.length - 1 && b - a > 1)) throw new Error(`bad elision in "${text}"`);
    const stripped = text.replace(/[‹›]/g, "");
    out += gap;
    local.push({
      start: out.length,
      len: stripped.length,
      seg1: a === -1 ? 0 : a,
      omit: a === -1 ? 0 : b - a - 1,
      device: codeToId.get(code)!,
      note,
    });
    out += stripped;
    pos = m.index + m[0].length;
  }
  blockMarks.push(local);
  return out + block.slice(pos);
});
{
  let base = 0;
  plainBlocks.forEach((p, i) => {
    blockMarks[i].forEach((m) => marks.push({ ...m, start: m.start + base }));
    base += p.length + SEP.length;
  });
}

// join; wrap plain single-line paragraphs by replacing spaces with "\n" (1:1, so mark offsets stay valid)
let finalText = plainBlocks.join(SEP);
let offset = 0;
for (const p of plainBlocks) {
  if (!p.includes("\n")) {
    let col = 0;
    for (let j = 0; j < p.length; j++) {
      if (p[j] === " " && col >= 92) {
        finalText = finalText.slice(0, offset + j) + "\n" + finalText.slice(offset + j + 1);
        col = 0;
      } else col += p[j] === " " ? 1 : 1;
    }
  }
  offset += p.length + SEP.length;
}
offset -= SEP.length;
finalText = finalText.slice(0, offset).trimEnd(); // drop the trailing separator's leftovers
if (/[{}‹›]/.test(finalText)) throw new Error("marker characters leaked into the article text");

const lineStarts = [0];
for (let i = 0; i < finalText.length; i++) if (finalText[i] === "\n") lineStarts.push(i + 1);
const posOf = (off: number): { line: number; col: number } => {
  let lo = 0,
    hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: off - lineStarts[lo] };
};

const codes = marks
  .sort((x, y) => x.start - y.start)
  .map((m) => {
    const spanEnd = m.start + m.len;
    const s = posOf(m.start);
    const e = posOf(spanEnd);
    const sameLine = s.line === e.line;
    const excerpt =
      m.seg1 === 0
        ? finalText.slice(m.start, spanEnd)
        : finalText.slice(m.start, m.start + m.seg1) + "[...]" + finalText.slice(m.start + m.seg1 + m.omit, spanEnd);
    return {
      device: m.device,
      line: s.line,
      ...(sameLine ? {} : { endLine: e.line }),
      range: [s.col, e.col] as [number, number],
      excerpt,
      ...(m.note ? { note: m.note } : {}),
    };
  });

const coding = { source: "example/Greifenbote 22", codes };

/* verify: every entry against the final text, ids are UUIDs, then write */
const errors: string[] = [];
codes.forEach((c, i) => {
  const msg = verifyEntry(finalText, c);
  if (msg) errors.push(`#${i} line ${c.line} "${c.excerpt.slice(0, 40)}": ${msg}`);
});
if (!codes.every((c) => /^[0-9a-f-]{36}$/.test(c.device))) errors.push("entry device id is not a UUID");
if (errors.length) {
  for (const er of errors.slice(0, 8)) console.error(er);
  throw new Error(`${errors.length} verification errors`);
}

const ids = new Set(codes.map((c) => c.device));
const byId = codeIndexOf(instr.devices);
console.log("entries:", codes.length, "coded devices:", ids.size, "/", byId.size);
for (const [id, code] of byId) if (!ids.has(id)) console.log("uncoded:", code);

writeFileSync(`${OUT}/Greifenbote 22.txt`, finalText.trimEnd() + "\n");
writeFileSync(`${OUT}/frame-devices.json`, JSON.stringify(instr, null, 2) + "\n");
writeFileSync(`${OUT}/example-coding.json`, JSON.stringify(coding, null, 2) + "\n");
console.log("written to", OUT);
