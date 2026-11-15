/** A readable summary of recorded facts. No predictions or invented deal details. */
export function plainBrief(kase: any, ctx: any, match: any) {
  const headline = kase?.event?.headline || null;
  const topics: string[] = kase?.event?.analysis?.topics ?? [];
  const company = kase?.identity?.name || kase?.symbol || 'This company';
  const wrong = match?.level === 'name_conflict';
  const why = wrong ? 'The news may concern a different company, so this case needs an identity check before it can be assessed.'
    : topics.includes('Merger or acquisition') ? `Sentinel noticed a report about a possible acquisition involving ${company}. Acquiring another business can change a company’s future sales and costs, but the result depends on the deal.`
    : topics.includes('Contract or customer') ? `Sentinel noticed a report about a contract or customer involving ${company}. A meaningful contract could affect future sales, depending on its size and terms.`
    : headline ? `Sentinel noticed a news report connected to ${company}. It may be worth a closer look if the development has a meaningful effect on the business.`
    : 'Sentinel has not recorded a headline explaining why this case appeared.';
  const positives: {text:string; detail:string}[] = [];
  if (!wrong) {
    const rows: any[] = ctx?.business ?? [];
    const revenue = rows.find(r => r.label === 'Revenue (quarter)' && r.changePct > 0) ?? rows.find(r => r.label === 'Revenue (year)' && r.changePct > 0);
    if (revenue && Number.isFinite(revenue.changePct)) positives.push({text:`Sales increased ${revenue.changePct.toFixed(1)}% compared with ${revenue.comparison === 'prior year' ? 'the previous year' : 'the same quarter a year earlier'}.`, detail:`Reported period ended ${revenue.latest?.period?.end ?? 'on an unknown date'}. Higher sales can be encouraging, although they do not necessarily mean higher profit.`});
    const earnings = rows.find(r => r.label === 'Net income (quarter)' && r.changePct > 0) ?? rows.find(r => r.label === 'Net income (year)' && r.changePct > 0);
    if (earnings && Number.isFinite(earnings.changePct)) positives.push({text:`Reported profit increased ${earnings.changePct.toFixed(1)}% compared with ${earnings.comparison === 'prior year' ? 'the previous year' : 'the same quarter a year earlier'}.`, detail:`Reported period ended ${earnings.latest?.period?.end ?? 'on an unknown date'}. One-off items may have contributed.`});
  }
  const pe = kase?.price;
  const price = pe?.status === 'indicative' && Number.isFinite(pe.ratio) && pe.ratio > 0
    ? `At the recorded price, the shares were valued at about ${pe.ratio.toFixed(1)} times the last reported annual earnings per share. This is one comparison, not proof the shares are cheap.`
    : 'Sentinel does not have a usable price-to-earnings comparison for this case.';
  return {headline, why, positives, price};
}
