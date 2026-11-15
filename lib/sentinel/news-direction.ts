// News direction (`news-direction-v1`): is a report good news, bad news, mixed or neutral for the company, judged
// only from the words in its stored headline (and, when the headline says nothing either way, the provider summary).
// Pure and deterministic: fixed word lists, no model. Every label carries the words that produced it.
//
// It describes the wording of the report, not the future: good news does not guarantee gains and bad news does
// not guarantee losses. The outcome record will show how useful the split is.

export const NEWS_DIRECTION_VERSION = 'news-direction-v1';
export type Direction = 'positive' | 'negative' | 'mixed' | 'neutral';

// Scandal and solvency: always bad news, whatever else the headline says.
const SCANDAL: [RegExp, string][] = [
  [/\bfraud\w*/i, 'fraud'], [/\b(investigation|investigated|investigating|probe[sd]?)\b/i, 'investigation'], [/\bsubpoena\w*/i, 'subpoena'],
  [/\b(sec|doj|ftc) (charges?|sues?|sued|fines?|fined)\b/i, 'regulator charges'], [/\b(charged|indicted|indictment)\b/i, 'criminal charges'],
  [/\bclass[- ]action\b/i, 'class action'], [/\b(sued|lawsuit (?:filed )?against|securities (?:lawsuit|litigation))\b/i, 'lawsuit against the company'],
  [/\brestate(?:s|d|ment)?\b/i, 'restatement'], [/\baccounting (?:irregularit\w+|errors?|issues?)\b/i, 'accounting problems'], [/\bwhistle-?blower\b/i, 'whistleblower'],
  [/\bshort[- ]sell(?:er|ing)? report|\bshort report\b|\bshort seller\b/i, 'short-seller report'], [/\b(bribery|misconduct|embezzle\w*|money laundering)\b/i, 'misconduct'],
  [/\b(data breach|cyber-?attack|hack(?:ed)?)\b/i, 'breach or cyberattack'], [/\brecalls?\b/i, 'recall'], [/\bwarning letter\b/i, 'regulatory warning letter'],
  [/\bgoing[- ]concern\b/i, 'going-concern doubt'], [/\b(delist\w*|deficiency notice|non-?compliance notice)\b/i, 'listing problem'],
  [/\b(bankrupt\w*|chapter 11|insolven\w*|defaults? on)\b/i, 'bankruptcy or default'],
];
// Bad for the business, but not a scandal.
const NEGATIVE: [RegExp, string][] = [
  [/\b(miss(?:es|ed)?|falls? short|fell short|below (?:expectations|estimates|forecasts?))\b/i, 'missed expectations'],
  [/\b(cuts?|lowers?|lowered|slashes|trims|withdraws?|withdrawn|suspends?) (?:its |full-year |annual |\d{4} )?(guidance|outlook|forecasts?|dividend)\b/i, 'cut guidance or dividend'],
  [/\bprofit warning\b/i, 'profit warning'], [/\b(lay(?:s|ing)? off|layoffs?|job cuts?|cuts? jobs)\b/i, 'job cuts'],
  [/\b(revenue|sales|profit|earnings|income) (?:falls?|fell|declines?|declined|drops?|dropped|slumps?|plunges?|shrinks?)\b/i, 'falling results'],
  [/\b(net )?loss(?:es)? widen\w*/i, 'wider loss'], [/\b(impairment|write-?downs?|write-?offs?)\b/i, 'write-down'],
  [/\b(terminat\w+|call(?:s|ed)? off|abandon\w*|scrap(?:s|ped)?|cancel\w*)\b/i, 'deal or plan cancelled'],
  [/\b(withdraws?|drops?) (?:its )?(bid|offer|proposal)\b/i, 'bid withdrawn'],
  [/\b(ceo|cfo|chief executive|chief financial officer|chairman|founder)\b[^.]{0,30}\b(resigns?|resigned|steps? down|stepping down|departs?|ousted|fired|exits?)\b/i, 'leadership exit'],
  [/\b(rejected|denied|denies|blocks?|blocked|fails? to|failed to)\b/i, 'rejection or failure'], [/\b(delays?|delayed|halts?|halted|suspends?|suspended)\b/i, 'delay or halt'],
  [/\b(plunges?|tumbles?|sinks?|slumps?|crashes?|sell-?off)\b/i, 'share price slump'], [/\bdowngrade[sd]?\b/i, 'downgrade'],
  [/\b(public|stock|share|equity) offering\b|\bdilut\w+/i, 'share sale (dilution)'],
];
const POSITIVE: [RegExp, string][] = [
  [/\b(acquires?|acquired|acquiring|to acquire|acquisition of|buys?|to buy)\b/i, 'acquisition'], [/\b(merger|merges?|to merge|combination)\b/i, 'merger'],
  [/\b(agreement|partnership|partners? with|collaborat\w+|joint venture|strategic alliance)\b/i, 'agreement or partnership'],
  [/\b(wins?|won|awarded|secures?|secured|lands?|selected by|chosen by)\b/i, 'contract or award win'], [/\b(receives?|received|books?|booked) (?:a |an |new )?(orders?|contract)\b/i, 'new order'],
  [/\b(beats?|tops?|topped|exceeds?|exceeded|surpass\w*|ahead of) (?:analyst |wall street |consensus )?(estimates|expectations|forecasts?|guidance|outlook)\b/i, 'beat expectations'],
  [/\brecord (?:[a-z-]+ )?(revenue|sales|quarter|year|profit|earnings|results|backlog|orders)\b/i, 'record results'],
  [/\b(raises?|raised|lifts?|lifted|boosts?|increases?|increased|hikes?) (?:its |full-year |annual |\d{4} )?(guidance|outlook|forecasts?|dividend)\b/i, 'raised guidance or dividend'],
  [/\b(revenue|sales|profit|earnings|income|eps|backlog)\b[^.]{0,40}\b(rises?|rose|grows?|grew|jumps?|jumped|surges?|surged|soars?|soared|climbs?|climbed|up \d|increase[sd]? \d|increased by)/i, 'growing results'],
  [/\b(fda |regulatory )?(approval|approves|approved|clearance|cleared|authori[sz]ation|authori[sz]ed)\b/i, 'approval'], [/\bpatent (?:granted|awarded)\b/i, 'patent granted'],
  [/\b(buyback|share repurchase|repurchase program)\b/i, 'buyback'], [/\b(expands?|expansion|launches?|launched|opens? new)\b/i, 'expansion or launch'],
];

const hits = (text: string, list: [RegExp, string][]) => [...new Set(list.filter(([re]) => re.test(text)).map(([, label]) => label))];

export function newsDirection(input: { headline?: string | null; summary?: string | null }) {
  // A cancelled or withdrawn deal is bad news even though it names the deal: drop the deal words in that case.
  const DEAL = ['acquisition', 'merger', 'agreement or partnership'];
  const read = (text: string) => { const negative = hits(text, NEGATIVE), cancelled = negative.includes('deal or plan cancelled') || negative.includes('bid withdrawn');
    return { scandal: hits(text, SCANDAL), negative, positive: hits(text, POSITIVE).filter(p => !(cancelled && DEAL.includes(p))) }; };
  const h = read(String(input.headline ?? '')), s = read(String(input.summary ?? ''));
  const headlineSays = h.scandal.length + h.negative.length + h.positive.length > 0;
  const use = headlineSays ? h : s, basis = headlineSays ? 'headline' : (s.scandal.length + s.negative.length + s.positive.length > 0 ? 'summary' : 'none');
  const bad = [...use.scandal, ...use.negative];
  const direction: Direction = use.scandal.length ? 'negative' : bad.length && use.positive.length ? 'mixed' : bad.length ? 'negative' : use.positive.length ? 'positive' : 'neutral';
  const label = { positive: 'Good news', negative: use.scandal.length ? 'Bad news: scandal or solvency' : 'Bad news', mixed: 'Mixed news', neutral: 'Neutral news' }[direction];
  const words = direction === 'positive' ? use.positive : direction === 'neutral' ? [] : [...bad, ...(direction === 'mixed' ? use.positive : [])];
  return {
    version: NEWS_DIRECTION_VERSION, direction, label, scandal: use.scandal.length > 0, basis,
    positive: use.positive, negative: bad,
    text: direction === 'neutral' ? 'The wording says nothing clearly good or bad.' : `${basis === 'summary' ? 'From the provider summary' : 'From the headline'}: ${words.join(', ')}.`,
    note: 'Judged from the wording only. Good news does not guarantee gains; bad news does not guarantee losses.',
  };
}

/** A case's direction: the stored label if it was recorded with this version, otherwise computed from the stored text. */
export function caseNewsDirection(kase: any) {
  const stored = kase?.newsDirection;
  if (stored?.version === NEWS_DIRECTION_VERSION && stored.direction) return stored;
  return newsDirection({ headline: kase?.event?.headline, summary: kase?.event?.providerSummary });
}
/** Whether a report may be shown as an idea at all. Bad and mixed news never are; they are still recorded and measured. */
export const showableAsIdea = (d: { direction: Direction }) => d.direction === 'positive' || d.direction === 'neutral';
